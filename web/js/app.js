/*
 * F27 Energy Quest, élő térkép: a G3 jelenet + Supabase (bejelentkezés, mentett
 * elrendezések, élő eszközállapot), visszavonás/újra, értesítések.
 *
 * Supabase nélkül (nincs config.js vagy nincs bejelentkezve) a térkép demó módban fut:
 * minden működik, csak a mentés nem.
 */
(function () {
  'use strict';

  var PIN_IDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', 'P', 'k5', 'k7', 'k8', 'k9', 'G'];
  var PIN_TO_DB = { k5: 'X5', k7: 'X7', k8: 'X8', k9: 'X9' };   // devices.pink a Supabase-ben
  var CONTACTS = ['5', '6', '7', '8', '9', '10'];
  var ROLE = {
    owner: { label: 'TULAJ', color: '#2f6fe4' },
    cleaner: { label: 'TAKARÍTÓ', color: '#3fae6a' },
    viewer: { label: 'MEGTEKINTŐ', color: '#7a6fb0' }
  };
  var HISTORY_MAX = 60;
  var LIVE_REFRESH_MS = 60000;

  // ---- segédfüggvények -------------------------------------------------------------

  function r1(n) { return Math.round(n * 10) / 10; }
  function dbPink(pin) { return PIN_TO_DB[pin] || pin; }
  function hhmm(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d)) return '';
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function dateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + ('0' + d.getDate()).slice(-2) + ' ' + hhmm(iso);
  }

  // A pozíciók kanonikus szöveges alakja (rendezett kulcsok, 0,1 pontosság): ezzel
  // vetjük össze a mentett és a jelenlegi állapotot, és ezt tárolja a visszavonás.
  function posKey(pos) {
    var keys = Object.keys(pos || {}).sort(), out = {};
    keys.forEach(function (k) {
      var v = pos[k];
      if (!v || (Math.abs(v[0]) < 0.05 && Math.abs(v[1]) < 0.05)) return;
      out[k] = [r1(v[0]), r1(v[1])];
    });
    return JSON.stringify(out);
  }

  function layoutFromPos(pos) {
    var data = { version: 1, pieces: {}, pins: {} }, p = JSON.parse(posKey(pos));
    Object.keys(p).forEach(function (k) {
      if (k.charAt(0) === 'd' && PIN_IDS.indexOf(k.slice(1)) >= 0) data.pins[k.slice(1)] = p[k];
      else data.pieces[k] = p[k];
    });
    return data;
  }

  function posFromLayout(data, pieceIds) {
    var pos = {};
    function ok(v) { return Array.isArray(v) && v.length === 2 && isFinite(v[0]) && isFinite(v[1]); }
    function clamp(v, m) { return Math.max(-m, Math.min(m, Number(v))); }
    if (!data || typeof data !== 'object') return pos;
    Object.keys(data.pieces || {}).forEach(function (k) {
      if (pieceIds[k] && ok(data.pieces[k])) pos[k] = [clamp(data.pieces[k][0], 700), clamp(data.pieces[k][1], 700)];
    });
    Object.keys(data.pins || {}).forEach(function (k) {
      if (PIN_IDS.indexOf(k) >= 0 && ok(data.pins[k])) pos['d' + k] = [clamp(data.pins[k][0], 560), clamp(data.pins[k][1], 500)];
    });
    return pos;
  }

  // ---- élő értékek a Tuya státuszból (public.device_latest) ------------------------------

  // A Tuya specifikáció skálája (public.devices.meta, csak a tulaj látja): érték / 10^scale.
  function metaScale(meta, code) {
    var m = meta && meta[code];
    return m && typeof m.scale === 'number' && isFinite(m.scale) ? m.scale : null;
  }
  function liveTemp(st, meta) {
    var codes = ['va_temperature', 'temp_current', 'temperature'];
    for (var i = 0; i < codes.length; i++) {
      var v = st[codes[i]];
      if (typeof v !== 'number') continue;
      var sc = metaScale(meta, codes[i]);
      if (sc != null) return v / Math.pow(10, sc);
      return Number.isInteger(v) && Math.abs(v) > 60 ? v / 10 : v;
    }
    return null;
  }
  function liveOpen(st) {
    var v = st.doorcontact_state != null ? st.doorcontact_state : st.contact_state;
    return v == null ? null : !!v;
  }
  // Okos kismegszakító teljesítménye wattban. A skála a specifikációból jön (devices.meta);
  // ha az nem elérhető, a szokásos dlq skála: cur_power 0,1 W egységben (scale 1).
  // Ha csak phase_a van, a base64 csomag 6-8. bájtja a teljesítmény (W).
  function livePower(st, meta) {
    if (typeof st.cur_power === 'number') {
      var sc = metaScale(meta, 'cur_power');
      return st.cur_power / Math.pow(10, sc != null ? sc : 1);
    }
    if (typeof st.phase_a === 'string') {
      try {
        var b = atob(st.phase_a);
        if (b.length >= 8) return (b.charCodeAt(5) << 16) | (b.charCodeAt(6) << 8) | b.charCodeAt(7);
      } catch (e) { /* hibás csomag: nincs érték */ }
    }
    return null;
  }
  function liveStage(st) {
    var n = 0, any = false;
    ['switch_1', 'switch_2', 'switch_3'].forEach(function (c) { if (c in st) { any = true; if (st[c] === true) n++; } });
    return any ? n : null;
  }
  function fmtTemp(t) { return t.toFixed(1).replace('.', ',') + '°'; }

  // ---- az alkalmazás ---------------------------------------------------------------------

  class G3App extends window.G3Scene {
    constructor(props) {
      super(props);
      this.sb = null;
      this.undoStack = [];
      this.redoStack = [];
      this.toastSeq = 0;
      this.liveTimer = 0;
      this.state = {
        pos: {}, sel: null, drag: null,
        drawer: false, saveAs: false, confirmId: null, busy: false,
        user: null, role: null, layouts: [], current: null,
        savedKey: '{}', savedAt: null, live: null, toasts: []
      };
    }

    // -- jelenet-kiegészítések -----------------------------------------------------------

    pieceIds() {
      if (!this._pieceIds) {
        var ids = {};
        this.scene().pieces.forEach(function (p) { if (p.drag) ids[p.id] = true; });
        this._pieceIds = ids;
      }
      return this._pieceIds;
    }

    // A szintek (napszak, időjárás) maradnak; ha van élő adat, a mért értékek felülírják
    // a szint demó értékeit.
    levels() {
      var LV = super.levels(), live = this.state && this.state.live;
      if (!live) return LV;
      return LV.map(function (L0) {
        var L = Object.assign({}, L0), t = L0.t.slice();
        ['1', '2', '3', '4'].forEach(function (p, i) {
          var d = live[p];
          if (!d) return;
          if (d.online === false) { t[i] = 'offline'; return; }
          var v = liveTemp(d.status || {}, d.meta);
          if (v != null) t[i] = fmtTemp(v);
        });
        L.t = t;
        ['k5', 'k7', 'k8', 'k9'].forEach(function (k) {
          var d = live[dbPink(k)];
          if (!d) return;
          var w = d.online === false ? null : livePower(d.status || {}, d.meta);
          L[k] = w == null ? 'offline' : Math.round(w) + ' W';
        });
        if (live.P) {
          var n = live.P.online === false ? null : liveStage(live.P.status || {});
          L.stage = n == null ? 'offline' : n + '/3 kW';
        }
        if (live['8']) {
          var o = liveOpen(live['8'].status || {});
          if (o != null) L.open8 = o;
        }
        return L;
      });
    }

    startDrag(e, id, kind) {
      this._before = posKey(this.state.pos);
      this._beforePos = Object.assign({}, this.state.pos || {});
      super.startDrag(e, id, kind);
    }

    // Megszakított húzás (pl. a második ujj csippentést kezd): a tárgy visszaáll, nincs visszavonási lépés.
    cancelDrag() {
      if (!this._drag) return;
      super.endDrag();
      this.setState({ pos: this._beforePos || {} });
    }

    endDrag() {
      var dragging = !!this._drag;
      super.endDrag();
      if (dragging) this.recordChange(this._before);
    }

    renderVals() {
      var v = super.renderVals(), self = this, st = this.state, live = st.live, demo = !live;
      var valued = { '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1, '9': 1, '10': 1, 'P': 1, 'k5': 1, 'k7': 1, 'k8': 1, 'k9': 1, 'G': 1 };

      v.pins.forEach(function (m) {
        var d = live && live[dbPink(m.id)];
        if (live && !d && valued[m.id]) demo = true;
        if (!d) return;
        if (CONTACTS.indexOf(m.id) >= 0 && m.id !== '8') {
          var open = d.online === false ? null : liveOpen(d.status || {});
          m.val = d.online === false ? 'offline' : open ? 'NYITVA!' : 'zárva';
          if (open) {
            m.showVal = true;
            m.vcls = 'val bad';
            m.fill = '#ff5a3c';
            if (m.cls.indexOf(' alert') < 0) m.cls += ' alert';
          }
        } else if (m.id === 'G') {
          m.val = d.online === false ? 'offline' : 'online';
        }
        if (d.online === false) { m.showVal = true; m.vcls = 'val'; }
        m.aria = m.id + ': ' + m.name + ', ' + m.val + '. Húzható.';
      });
      if (live && live.__any && v.pins.some(function (m) { return m.id === '11'; })) {
        v.pins.forEach(function (m) { if (m.id === '11') { m.val = 'IR vezérelt'; m.aria = m.id + ': ' + m.name + ', ' + m.val + '. Húzható.'; } });
      }
      if (st.sel && st.sel.charAt(0) === 'd') {
        v.pins.forEach(function (m) { if ('d' + m.id === st.sel) v.selText = m.id + ' ' + m.name + ': ' + m.val; });
      }

      v.reset = function () { self.resetLayout(); };
      v.ui = this.uiVals(demo);
      return v;
    }

    // -- felület -----------------------------------------------------------------------------

    uiVals(demo) {
      var self = this, st = this.state, cur = posKey(st.pos);
      var dirty = cur !== st.savedKey;
      var owner = st.role === 'owner';
      var loggedIn = !!st.user;
      var chip, chipCls;
      if (dirty) { chip = 'Nem mentett változás'; chipCls = 'stchip dirty'; }
      else if (st.savedAt) { chip = 'Mentve ' + hhmm(st.savedAt); chipCls = 'stchip saved'; }
      else { chip = 'Alap elrendezés'; chipCls = 'stchip'; }

      var saveHint = '';
      if (!this.sb) saveHint = 'A felhős mentés ezen az oldalon nincs beállítva.';
      else if (!loggedIn) saveHint = 'Mentéshez jelentkezz be';
      else if (!st.role) saveHint = 'A fiókod még nincs jogosultsági listán, ezért csak demó módban látod a térképet.';
      else if (!owner) saveHint = 'Csak olvasás: menteni és törölni a tulaj tud.';

      var layouts = st.layouts.map(function (l) {
        var confirm = st.confirmId === l.id;
        return {
          name: l.name, isDefault: !!l.is_default, time: 'Módosítva: ' + dateTime(l.updated_at),
          cls: 'lrow' + (st.current && st.current.id === l.id ? ' cur' : ''),
          confirm: confirm, actions: !confirm, canEdit: owner, canDefault: owner && !l.is_default,
          delAria: l.name + ' törlése',
          load: function () { self.loadLayout(l); },
          makeDefault: function () { self.makeDefault(l); },
          askDelete: function () { self.setState({ confirmId: l.id }); },
          cancelDelete: function () { self.setState({ confirmId: null }); },
          doDelete: function () { self.deleteLayout(l); }
        };
      });

      var role = ROLE[st.role] || { label: 'NINCS JOG', color: '#8a8f9c' };
      return {
        showDemo: demo,
        acctLabel: loggedIn ? (role.label === 'TULAJ' ? 'Fiók és mentés' : 'Fiók') : 'Belépés',
        drawerOpen: st.drawer,
        drawerOpenAttr: st.drawer ? 'true' : 'false',
        toggleDrawer: function () { self.setState({ drawer: !st.drawer, saveAs: false, confirmId: null }); },
        openDrawer: function () { self.setState({ drawer: true }); },
        closeDrawer: function () { self.setState({ drawer: false, saveAs: false, confirmId: null }); },
        noConfig: !this.sb,
        showLogin: !!this.sb && !loggedIn,
        loggedIn: loggedIn,
        email: st.user ? st.user.email : '',
        roleLabel: role.label, roleColor: role.color,
        busy: st.busy,
        login: function (e) { e.preventDefault(); self.login(); },
        logout: function () { self.logout(); },
        currentName: st.current ? st.current.name : 'nincs mentve',
        chip: chip, chipCls: chipCls,
        chipTitle: st.current ? 'Elrendezés: ' + st.current.name : 'Mentett elrendezések megnyitása',
        saveHint: saveHint,
        saveDisabled: !owner || st.busy,
        saveAsDisabled: !owner || st.busy,
        saveAsShown: owner && st.saveAs,
        save: function () { self.saveLayout(); },
        saveAsOpen: function () {
          self.setState({ saveAs: true });
          setTimeout(function () { var i = document.getElementById('f27-newname'); if (i) i.focus(); }, 60);
        },
        saveAsCancel: function () { self.setState({ saveAs: false }); },
        saveAs: function (e) { e.preventDefault(); self.saveAsLayout(); },
        noLayouts: loggedIn && !!st.role && st.layouts.length === 0,
        layouts: layouts,
        undo: function () { self.undo(); },
        redo: function () { self.redo(); },
        undoDisabled: this.undoStack.length === 0,
        redoDisabled: this.redoStack.length === 0,
        toasts: st.toasts.map(function (t) { return { text: t.text, cls: 'toast ' + t.kind }; })
      };
    }

    toast(text, kind) {
      var id = ++this.toastSeq, self = this;
      this.setState({ toasts: this.state.toasts.concat([{ id: id, text: text, kind: kind || 'info' }]).slice(-2) });
      setTimeout(function () { self.setState({ toasts: self.state.toasts.filter(function (t) { return t.id !== id; }) }); }, kind === 'err' ? 6500 : 4000);
    }

    errText(error, fallback) {
      var msg = (error && (error.message || error.error_description)) || '';
      var code = error && error.code;
      if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Nincs jogosultságod ehhez: menteni és törölni csak a tulaj tud.';
      if (code === '23505' || /duplicate key/i.test(msg)) return 'Ilyen nevű elrendezés már van.';
      if (/invalid login credentials/i.test(msg) || code === 'invalid_credentials') return 'Hibás e-mail vagy jelszó.';
      if (/failed to fetch|network|load failed/i.test(msg) || (error && error.name === 'TypeError')) return 'Hálózati hiba, próbáld újra.';
      return fallback + (msg ? ' (' + msg + ')' : '');
    }

    // -- elrendezés-történet -------------------------------------------------------------------

    recordChange(beforeKey) {
      var after = posKey(this.state.pos);
      if (beforeKey === after) return;
      this.undoStack.push(beforeKey);
      if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
      this.redoStack = [];
      this.forceUpdate();
    }

    applyKey(key) { this._drag = null; this.setState({ pos: JSON.parse(key), drag: null }); }

    undo() {
      if (!this.undoStack.length) return;
      this.redoStack.push(posKey(this.state.pos));
      this.applyKey(this.undoStack.pop());
    }

    redo() {
      if (!this.redoStack.length) return;
      this.undoStack.push(posKey(this.state.pos));
      this.applyKey(this.redoStack.pop());
    }

    resetLayout() {
      var before = posKey(this.state.pos);
      this._drag = null;
      this.state.pos = {};
      this.recordChange(before);
      this.setState({ pos: {}, sel: null, drag: null });
    }

    // -- Supabase ------------------------------------------------------------------------------

    initSupabase() {
      var cfg = window.F27_CONFIG || {};
      if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase || !window.supabase.createClient) return;
      var self = this;
      try {
        this.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
      } catch (e) {
        this.sb = null;
        return;
      }
      this.sb.auth.onAuthStateChange(function (event, session) {
        // A Supabase ajánlása szerint a visszahívásból ne indítsunk közvetlenül új kérést.
        setTimeout(function () {
          if (session && session.user) {
            if (!self.state.user || self.state.user.id !== session.user.id) self.afterLogin(session.user);
          } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && self.state.user)) {
            self.afterLogout();
          }
        }, 0);
      });
    }

    login() {
      var email = (document.getElementById('f27-email') || {}).value || '';
      var pass = (document.getElementById('f27-pass') || {}).value || '';
      if (!email.trim() || !pass) { this.toast('Add meg az e-mail címet és a jelszót.', 'err'); return; }
      var self = this;
      this.setState({ busy: true });
      this.sb.auth.signInWithPassword({ email: email.trim(), password: pass }).then(function (res) {
        self.setState({ busy: false });
        if (res.error) { self.toast(self.errText(res.error, 'Sikertelen belépés.'), 'err'); return; }
        var p = document.getElementById('f27-pass');
        if (p) p.value = '';
      }, function (err) {
        self.setState({ busy: false });
        self.toast(self.errText(err, 'Sikertelen belépés.'), 'err');
      });
    }

    logout() {
      var self = this;
      this.sb.auth.signOut().then(function () { self.afterLogout(); }, function (err) { self.toast(self.errText(err, 'Sikertelen kilépés.'), 'err'); });
    }

    afterLogin(user) {
      var self = this;
      this.setState({ user: { id: user.id, email: user.email || '' }, role: null, layouts: [], live: null });
      this.sb.from('app_users').select('role').eq('user_id', user.id).maybeSingle().then(function (res) {
        if (res.error) { self.toast(self.errText(res.error, 'A jogosultság lekérése nem sikerült.'), 'err'); return; }
        var role = res.data ? res.data.role : null;
        self.setState({ role: role });
        if (!role) { self.toast('Belépve, de a fiókod nincs a jogosultsági listán.', 'err'); return; }
        self.toast('Belépve: ' + (ROLE[role] ? ROLE[role].label.toLowerCase() : role) + '.', 'ok');
        self.refreshLayouts(true);
        self.refreshLive();
        clearInterval(self.liveTimer);
        self.liveTimer = setInterval(function () { self.refreshLive(); }, LIVE_REFRESH_MS);
      }, function (err) { self.toast(self.errText(err, 'A jogosultság lekérése nem sikerült.'), 'err'); });
    }

    afterLogout() {
      clearInterval(this.liveTimer);
      this.setState({ user: null, role: null, layouts: [], current: null, live: null, saveAs: false, confirmId: null, savedAt: null, savedKey: '{}' });
      this.toast('Kiléptél. A térkép demó módban fut.', 'info');
    }

    refreshLayouts(autoLoadDefault) {
      var self = this;
      return this.sb.from('layouts').select('id,name,data,is_default,updated_at').order('name', { ascending: true }).then(function (res) {
        if (res.error) { self.toast(self.errText(res.error, 'Az elrendezések betöltése nem sikerült.'), 'err'); return; }
        var rows = res.data || [];
        var cur = self.state.current && rows.filter(function (r) { return r.id === self.state.current.id; })[0];
        self.setState({ layouts: rows, current: cur || null });
        if (autoLoadDefault) {
          var def = rows.filter(function (r) { return r.is_default; })[0];
          if (def) self.loadLayout(def, true);
        }
      }, function (err) { self.toast(self.errText(err, 'Az elrendezések betöltése nem sikerült.'), 'err'); });
    }

    refreshLive() {
      var self = this;
      if (!this.sb || !this.state.user || !this.state.role) return;
      this.sb.from('device_latest').select('pink,ts,online,status').then(function (res) {
        if (res.error) { self.toast(self.errText(res.error, 'Az élő adatok lekérése nem sikerült.'), 'err'); return; }
        var rows = res.data || [];
        if (!rows.length) { self.setState({ live: null }); return; }
        var live = { __any: true };
        rows.forEach(function (r) { live[r.pink] = { ts: r.ts, online: r.online, status: r.status || {}, meta: null }; });
        self.setState({ live: live });
        // A skálák (devices.meta) csak a tulajnak olvashatók; ha nincs meg (pl. nem futott
        // a 002-es migráció), csendben marad a feltételezett skála.
        if (self.state.role !== 'owner') return;
        self.sb.from('devices').select('pink,meta').then(function (r2) {
          if (r2.error || !r2.data || self.state.live !== live) return;
          var next = Object.assign({}, live);
          r2.data.forEach(function (d) { if (next[d.pink] && d.meta) next[d.pink] = Object.assign({}, next[d.pink], { meta: d.meta }); });
          self.setState({ live: next });
        }, function () { /* skála nélkül is működik */ });
      }, function (err) { self.toast(self.errText(err, 'Az élő adatok lekérése nem sikerült.'), 'err'); });
    }

    loadLayout(row, isDefault) {
      var before = posKey(this.state.pos);
      var pos = posFromLayout(row.data, this.pieceIds());
      this._drag = null;
      this.state.pos = pos;
      this.recordChange(before);
      this.setState({ pos: pos, drag: null, sel: null, current: { id: row.id, name: row.name }, savedKey: posKey(pos), savedAt: row.updated_at, confirmId: null });
      this.toast('Betöltve: ' + row.name + (isDefault ? ' (alapértelmezett)' : '') + '.', 'ok');
    }

    saveLayout() {
      if (this.state.role !== 'owner') return;
      if (!this.state.current) { this.setState({ saveAs: true }); return; }
      var self = this, key = posKey(this.state.pos), cur = this.state.current;
      this.setState({ busy: true });
      this.sb.from('layouts').update({ data: layoutFromPos(this.state.pos) }).eq('id', cur.id).select('id,name,data,is_default,updated_at').then(function (res) {
        self.setState({ busy: false });
        if (res.error) { self.toast(self.errText(res.error, 'A mentés nem sikerült.'), 'err'); return; }
        var row = (res.data || [])[0];
        if (!row) { self.toast('A mentés nem sikerült: nincs jogosultságod, vagy az elrendezést közben törölték.', 'err'); return; }
        self.setState({ savedKey: key, savedAt: row.updated_at || new Date().toISOString() });
        self.toast('Mentve: ' + row.name + '.', 'ok');
        self.refreshLayouts(false);
      }, function (err) { self.setState({ busy: false }); self.toast(self.errText(err, 'A mentés nem sikerült.'), 'err'); });
    }

    saveAsLayout() {
      if (this.state.role !== 'owner') return;
      var input = document.getElementById('f27-newname');
      var name = ((input && input.value) || '').trim();
      if (!name) { this.toast('Adj nevet az elrendezésnek.', 'err'); return; }
      if (name.length > 80) { this.toast('A név legfeljebb 80 karakter lehet.', 'err'); return; }
      var dup = this.state.layouts.some(function (l) { return l.name.toLowerCase() === name.toLowerCase(); });
      if (dup) { this.toast('Ilyen nevű elrendezés már van.', 'err'); return; }
      var self = this, key = posKey(this.state.pos);
      this.setState({ busy: true });
      this.sb.from('layouts').insert({ name: name, data: layoutFromPos(this.state.pos) }).select('id,name,data,is_default,updated_at').single().then(function (res) {
        self.setState({ busy: false });
        if (res.error) { self.toast(self.errText(res.error, 'A mentés nem sikerült.'), 'err'); return; }
        var row = res.data;
        self.setState({ saveAs: false, current: { id: row.id, name: row.name }, savedKey: key, savedAt: row.updated_at || new Date().toISOString() });
        self.toast('Elmentve új névvel: ' + row.name + '.', 'ok');
        self.refreshLayouts(false);
      }, function (err) { self.setState({ busy: false }); self.toast(self.errText(err, 'A mentés nem sikerült.'), 'err'); });
    }

    makeDefault(row) {
      if (this.state.role !== 'owner') return;
      var self = this, sb = this.sb;
      this.setState({ busy: true });
      // Előbb a régi alapértelmezettet kapcsoljuk ki (egyedi index: csak egy lehet).
      sb.from('layouts').update({ is_default: false }).eq('is_default', true).select('id').then(function (res) {
        if (res.error) throw res.error;
        return sb.from('layouts').update({ is_default: true }).eq('id', row.id).select('id');
      }).then(function (res) {
        self.setState({ busy: false });
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) { self.toast('Nem sikerült: nincs jogosultságod, vagy az elrendezést közben törölték.', 'err'); return; }
        self.toast(row.name + ' lett az alapértelmezett elrendezés.', 'ok');
        self.refreshLayouts(false);
      }).catch(function (err) {
        self.setState({ busy: false });
        self.toast(self.errText(err, 'Az alapértelmezés beállítása nem sikerült.'), 'err');
        self.refreshLayouts(false);
      });
    }

    deleteLayout(row) {
      if (this.state.role !== 'owner') return;
      var self = this;
      this.setState({ busy: true });
      this.sb.from('layouts').delete().eq('id', row.id).select('id').then(function (res) {
        self.setState({ busy: false, confirmId: null });
        if (res.error) { self.toast(self.errText(res.error, 'A törlés nem sikerült.'), 'err'); return; }
        if (!res.data || !res.data.length) { self.toast('A törlés nem sikerült: nincs jogosultságod.', 'err'); return; }
        if (self.state.current && self.state.current.id === row.id) self.setState({ current: null, savedKey: '{}', savedAt: null });
        self.toast('Törölve: ' + row.name + '.', 'ok');
        self.refreshLayouts(false);
      }, function (err) { self.setState({ busy: false }); self.toast(self.errText(err, 'A törlés nem sikerült.'), 'err'); });
    }
  }

  // ---- indítás ----------------------------------------------------------------------------------

  // ---- nézet: illesztés + nagyítás + mozgatás -----------------------------------------------------
  // A színpad mindig 1440x900; az illesztett lépték fölött z-szeresre nagyítható (1-4x).
  // Nagyítás: Ctrl/Cmd + görgő, touchpad-csippentés, érintőképernyős csippentés, +/- gombok,
  // billentyűk (Ctrl/Cmd + plusz/mínusz/0, vagy csak +, -, 0). Nagyítva: görgő vagy húzás mozgat.
  var ZMIN = 1, ZMAX = 4;
  var view = { z: 1, tx: 0, ty: 0 };
  var stageEl = null, zoomLabel = null, zoomOutBtn = null, zoomInBtn = null;

  // Ha a színpad alatt vagy mellett nincs elég szabad perem a nagyítósávnak, alul helyet hagyunk neki,
  // hogy ne takarja a térkép jobb alsó sarkát (érmek). Ilyenkor a térkép kicsit kisebb.
  var BAR_H = 56, BAR_W = 220;
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = Math.min(vw / 1440, vh / 900);
    var freeV = vh - 900 * s, freeH = vw - 1440 * s;
    if (freeV >= BAR_H || freeH / 2 >= BAR_W) return { s: s, h: vh };
    return { s: Math.min(vw / 1440, (vh - BAR_H) / 900), h: vh - BAR_H };
  }
  function baseScale() { return layout().s; }

  function clampView() {
    var lay = layout(), s = lay.s * view.z, W = 1440 * s, H = 900 * s, vw = window.innerWidth, vh = lay.h;
    view.tx = W <= vw ? (vw - W) / 2 : Math.min(0, Math.max(vw - W, view.tx));
    view.ty = H <= vh ? (vh - H) / 2 : Math.min(0, Math.max(vh - H, view.ty));
  }

  function applyView() {
    clampView();
    var s = baseScale() * view.z;
    stageEl.style.transform = 'translate(' + Math.round(view.tx) + 'px,' + Math.round(view.ty) + 'px) scale(' + s + ')';
    document.body.classList.toggle('zoomed', view.z > 1.001);
    if (zoomLabel) zoomLabel.textContent = Math.round(view.z * 100) + '%';
    if (zoomOutBtn) zoomOutBtn.disabled = view.z <= ZMIN + 0.001;
    if (zoomInBtn) zoomInBtn.disabled = view.z >= ZMAX - 0.001;
  }

  // Nagyítás egy képernyőpont körül: a pont alatti tartalom a helyén marad.
  function zoomTo(z, cx, cy) {
    var nz = Math.min(ZMAX, Math.max(ZMIN, z));
    if (cx == null) { cx = window.innerWidth / 2; cy = window.innerHeight / 2; }
    var f = nz / view.z;
    view.tx = cx - (cx - view.tx) * f;
    view.ty = cy - (cy - view.ty) * f;
    view.z = nz;
    applyView();
  }
  function zoomBy(factor, cx, cy) { zoomTo(view.z * factor, cx, cy); }
  function resetView() { view.z = 1; applyView(); }
  function panBy(dx, dy) { view.tx += dx; view.ty += dy; applyView(); }

  function editableTarget(t) {
    var tag = t && t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
  }
  // Görgethető elem a célpont felett (pl. a Fiók és mentés panel listája): annak hagyjuk a görgőt.
  function scrollableAncestor(t, dy) {
    for (var el = t; el && el !== stageEl && el.nodeType === 1; el = el.parentElement) {
      var cs = window.getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        if ((dy < 0 && el.scrollTop > 0) || (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return el;
      }
    }
    return null;
  }

  function buildZoomBar() {
    var bar = document.createElement('div');
    bar.className = 'zoombar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Nagyítás');
    function mk(label, title, onClick, html) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'zb'; b.title = title; b.setAttribute('aria-label', title);
      if (html) b.innerHTML = html; else b.textContent = label;
      b.addEventListener('click', onClick);
      bar.appendChild(b);
      return b;
    }
    zoomOutBtn = mk('−', 'Kicsinyítés (Ctrl + görgő vagy -)', function () { zoomBy(1 / 1.25); });
    zoomLabel = document.createElement('span');
    zoomLabel.className = 'zl';
    zoomLabel.setAttribute('aria-live', 'polite');
    bar.appendChild(zoomLabel);
    zoomInBtn = mk('+', 'Nagyítás (Ctrl + görgő vagy +)', function () { zoomBy(1.25); });
    mk('', 'Teljes nézet (0)', resetView,
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>');
    document.body.appendChild(bar);
  }

  function initViewControls(app) {
    stageEl = document.getElementById('stage');
    buildZoomBar();
    applyView();
    window.addEventListener('resize', applyView);

    // Ctrl/Cmd + görgő és touchpad-csippentés (a Chrome ctrlKey-es wheel eseményként küldi).
    window.addEventListener('wheel', function (e) {
      var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      var dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomBy(Math.exp(-dy * 0.0025), e.clientX, e.clientY);
        return;
      }
      if (view.z > 1.001 && !scrollableAncestor(e.target, dy)) {
        e.preventDefault();
        if (e.shiftKey && !dx) { dx = dy; dy = 0; }
        panBy(-dx, -dy);
      }
    }, { passive: false });

    // Safari touchpad-csippentés.
    var g0 = null;
    window.addEventListener('gesturestart', function (e) { e.preventDefault(); g0 = view.z; }, { passive: false });
    window.addEventListener('gesturechange', function (e) { e.preventDefault(); if (g0 != null) zoomTo(g0 * e.scale, e.clientX, e.clientY); }, { passive: false });
    window.addEventListener('gestureend', function (e) { e.preventDefault(); g0 = null; }, { passive: false });

    // Érintés: két ujj = csippentés (és közben mozgatás), egy ujj vagy egér az üres részen = mozgatás nagyítva.
    var touches = {}, pinch = null, pan = null;
    function tcount() { return Object.keys(touches).length; }
    function pinchGeo() {
      var ids = Object.keys(touches), a = touches[ids[0]], b = touches[ids[1]];
      return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
    window.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch') return;
      touches[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (tcount() === 2) {
        app.cancelDrag();             // a két ujj csippentés, nem bútorhúzás
        pan = null;
        var g = pinchGeo();
        pinch = { d0: g.d, z0: view.z, cx0: g.cx, cy0: g.cy, tx0: view.tx, ty0: view.ty };
      }
    }, true);
    window.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch' && touches[e.pointerId]) {
        touches[e.pointerId] = { x: e.clientX, y: e.clientY };
        if (pinch && tcount() >= 2) {
          var g = pinchGeo();
          var nz = Math.min(ZMAX, Math.max(ZMIN, pinch.z0 * g.d / pinch.d0)), f = nz / pinch.z0;
          view.z = nz;
          view.tx = g.cx - (pinch.cx0 - pinch.tx0) * f;
          view.ty = g.cy - (pinch.cy0 - pinch.ty0) * f;
          applyView();
          return;
        }
      }
      if (pan && e.pointerId === pan.id) {
        view.tx = pan.tx0 + (e.clientX - pan.x0);
        view.ty = pan.ty0 + (e.clientY - pan.y0);
        applyView();
      }
    }, true);
    function lift(e) {
      if (e.pointerType === 'touch') { delete touches[e.pointerId]; if (tcount() < 2) pinch = null; }
      if (pan && e.pointerId === pan.id) { pan = null; document.body.classList.remove('panning'); }
    }
    window.addEventListener('pointerup', lift, true);
    window.addEventListener('pointercancel', lift, true);

    // Mozgatás nagyítva: a bútorok és tűk saját húzása (stopPropagation) és a gombok/mezők kivételével
    // bárhol a színpadon; középső egérgombbal mindenhol.
    stageEl.addEventListener('pointerdown', function (e) {
      if (view.z <= 1.001 || pinch) return;
      var t = e.target;
      var middle = e.button === 1;
      if (!middle) {
        if (e.button > 0) return;
        if (editableTarget(t) || (t.closest && t.closest('button, a, label, select, .drawer'))) return;
      }
      e.preventDefault();
      pan = { id: e.pointerId, x0: e.clientX, y0: e.clientY, tx0: view.tx, ty0: view.ty };
      document.body.classList.add('panning');
    });

    document.addEventListener('keydown', function (e) {
      if (editableTarget(e.target)) return;
      var k = e.key, mod = e.ctrlKey || e.metaKey;
      if (k === '+' || k === '=' || (mod && k === 'Add')) { if (mod || !e.altKey) { e.preventDefault(); zoomBy(1.25); } return; }
      if (k === '-' || k === '_' || (mod && k === 'Subtract')) { if (mod || !e.altKey) { e.preventDefault(); zoomBy(1 / 1.25); } return; }
      if (k === '0' && !e.altKey) { e.preventDefault(); resetView(); return; }
      if (!mod && view.z > 1.001) {
        var step = 60;
        if (k === 'ArrowLeft') { e.preventDefault(); panBy(step, 0); }
        else if (k === 'ArrowRight') { e.preventDefault(); panBy(-step, 0); }
        else if (k === 'ArrowUp') { e.preventDefault(); panBy(0, step); }
        else if (k === 'ArrowDown') { e.preventDefault(); panBy(0, -step); }
      }
    });
  }

  function start() {
    var app = new G3App({ showPath: true, showMarkers: true, snap: true });
    app.initSupabase();
    window.MiniDC.mount(document.getElementById('stage'), document.getElementById('g3-template'), app);
    initViewControls(app);
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (e.key === 'Escape' && app.state.drawer) { app.setState({ drawer: false, saveAs: false, confirmId: null }); return; }
      if (editableTarget(t)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); app.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); app.redo(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
