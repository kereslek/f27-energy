/* Hozzáférések minden dashboardon (F27, O2B és a jövőbeliek).

   1. Ideiglenes bemutató link (59:59): a címben "#s=<token>". A token azonnal kikerül a címsorból
      (a böngésző fülén belül sessionStorage őrzi, így egy frissítés nem dobja ki a nézőt), a Supabase
      felé csak az "x-share-token" fejlécben megy. A jogosultságot és a lejáratot az adatbázis dönti el
      (011_access.sql, RLS); a visszaszámláló itt csak megmutatja, és lejáratkor elsötétíti az oldalt.
   2. A tulaj Hozzáférések panelje: bemutató link készítése, élő linkek visszavonása, felhasználók
      (név, szerepkör, jelszó; a "users" Supabase-függvényen át), és mindenkinek a saját jelszava.

   F27Access.shareToken(key)                         -> token | null
   F27Access.shareClient(cfg, token)                 -> Supabase kliens (munkamenet nélkül, a fejléccel)
   F27Access.startShare({ sb, site, onReady, onExpire, calendar, phoneTop })   phoneTop: a sáv helye telefonon (px felülről)
   F27Access.openPanel({ sb, cfg, site, role, userId, roles, link })                                         */
(function (root) {
  'use strict';
  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  var ROLE_TXT = {
    owner: ['TULAJ', 'mindent lát és állít'],
    member: ['CSALÁDTAG', 'mindent lát, és kapcsolhat, időzíthet'],
    viewer: ['MEGTEKINTŐ', 'csak lát, semmit nem kapcsol'],
    cleaner: ['TAKARÍTÓ', 'lát, és a foglalásokat is látja']
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function mmss(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return pad(Math.floor(s / 60)) + ':' + pad(s % 60); }
  function hm(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var t = d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Budapest' });
    var today = new Date().toLocaleDateString('hu-HU', { timeZone: 'Europe/Budapest' });
    var day = d.toLocaleDateString('hu-HU', { timeZone: 'Europe/Budapest' });
    return (day === today ? 'ma ' : d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric', timeZone: 'Europe/Budapest' }) + ' ') + t;
  }

  var CSS = '' +
    '.f27a-ov{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(20,28,48,.55);backdrop-filter:blur(3px)}' +
    '.f27a-card{position:relative;max-width:440px;width:100%;max-height:calc(100% - 24px);overflow:auto;background:#fffaf0;border:3px solid #1e2a44;border-radius:22px;box-shadow:0 8px 0 #1e2a44,0 18px 40px rgba(0,0,0,.35);padding:20px 20px 18px;font:600 15px/1.45 Nunito,system-ui,sans-serif;color:#1e2a44}' +
    '.f27a-card h2{font:400 26px/1.1 "Lilita One",Nunito,sans-serif;margin:0 0 8px;letter-spacing:.5px}' +
    '.f27a-card p{margin:6px 0}.f27a-card ul{margin:8px 0 4px;padding-left:20px}.f27a-card li{margin:3px 0}' +
    '.f27a-big{font:400 64px/1 "Lilita One",Nunito,sans-serif;text-align:center;margin:10px 0 4px;color:#e0569b;text-shadow:0 3px 0 #1e2a44;font-variant-numeric:tabular-nums}' +
    '.f27a-btn{appearance:none;border:2.5px solid #1e2a44;border-radius:14px;background:#ffd23f;color:#1e2a44;font:800 15px Nunito,sans-serif;padding:9px 16px;cursor:pointer;box-shadow:0 3px 0 #1e2a44;margin:4px 6px 4px 0}' +
    '.f27a-btn:active{transform:translateY(2px);box-shadow:0 1px 0 #1e2a44}.f27a-btn.sec{background:#fff}.f27a-btn.red{background:#ff8a7a}.f27a-btn.sm{font-size:13px;padding:5px 10px;border-radius:11px}' +
    '.f27a-btn[disabled]{opacity:.5;cursor:default}' +
    '.f27a-x{position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:50%;border:2.5px solid #1e2a44;background:#fff;font:900 18px Nunito,sans-serif;cursor:pointer}' +
    '#f27a-bar{position:fixed;left:50%;bottom:calc(10px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:8000;display:flex;align-items:center;gap:8px;max-width:calc(100% - 20px);' +
      'background:#1e2a44;color:#fff;border-radius:999px;padding:6px 6px 6px 14px;font:800 13px Nunito,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3);overflow:hidden}' +
    '#f27a-bar .t{font:400 20px "Lilita One",Nunito,sans-serif;color:#ffd23f;font-variant-numeric:tabular-nums;letter-spacing:.5px}' +
    '#f27a-bar .lbl{color:#ff9ccc;letter-spacing:.5px}#f27a-bar .txt{opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#f27a-bar button{appearance:none;border:0;border-radius:999px;background:#fff;color:#1e2a44;font:800 12px Nunito,sans-serif;padding:6px 10px;cursor:pointer;flex:none}' +
    '#f27a-bar i{position:absolute;left:0;bottom:0;height:3px;background:#ffd23f;transition:width 1s linear}' +
    '#f27a-bar.low .t{color:#ff8a7a}' +
    '@media (max-width:520px){#f27a-bar .txt{display:none}}' +
    // telefonon a térképek alsó eszközsora fölé
    '@media (max-width:899px){#f27a-bar{top:calc(var(--f27a-top,10px) + env(safe-area-inset-top,0px));bottom:auto;padding:3px 3px 3px 10px;font-size:12px;gap:6px}#f27a-bar .t{font-size:17px}#f27a-bar .lbl,#f27a-bar>span:first-child{display:none}#f27a-bar button{padding:5px 9px}#f27a-bar.left{left:var(--f27a-left);transform:none}}' +
    '.f27a-tabs{display:flex;gap:6px;margin:4px 0 12px;flex-wrap:wrap}.f27a-tabs button{appearance:none;border:2.5px solid #1e2a44;border-radius:999px;background:#fff;font:800 13px Nunito,sans-serif;padding:6px 12px;cursor:pointer;color:#1e2a44}' +
    '.f27a-tabs button[aria-selected="true"]{background:#1e2a44;color:#fff}' +
    '.f27a-f{display:block;margin:8px 0}.f27a-f span{display:block;font-size:12px;font-weight:900;letter-spacing:.4px;margin-bottom:3px}' +
    '.f27a-f input,.f27a-f select{width:100%;box-sizing:border-box;border:2.5px solid #1e2a44;border-radius:11px;padding:8px 10px;font:700 15px Nunito,sans-serif;background:#fff;color:#1e2a44}' +
    '.f27a-row{display:flex;gap:6px;align-items:center}.f27a-row input{flex:1;min-width:0}' +
    '.f27a-note{font-size:13px;opacity:.8}.f27a-ok{background:#e4f7e9;border:2px solid #3fae6a;border-radius:12px;padding:10px;margin:10px 0}.f27a-err{color:#c4361f;font-weight:800;min-height:1em}' +
    '.f27a-list{list-style:none;padding:0;margin:8px 0}.f27a-list li{border:2px solid #1e2a44;border-radius:13px;padding:8px 10px;margin:6px 0;background:#fff}' +
    '.f27a-list .h{display:flex;justify-content:space-between;gap:8px;align-items:center}.f27a-list .s{font-size:12.5px;opacity:.85}' +
    '.f27a-badge{display:inline-block;font:900 11px Nunito,sans-serif;letter-spacing:.5px;border-radius:999px;padding:2px 8px;background:#e8e2f6;color:#4d3f86}' +
    '.f27a-badge.live{background:#ffe3ef;color:#b0306c}.f27a-badge.off{background:#eee;color:#666}.f27a-badge.owner{background:#dbe7ff;color:#1f4fb0}.f27a-badge.member{background:#e4f7e9;color:#256b40}' +
    '.f27a-roles label{display:flex;gap:8px;align-items:flex-start;border:2px solid #1e2a44;border-radius:12px;padding:7px 9px;margin:5px 0;background:#fff;cursor:pointer}' +
    '.f27a-roles input{margin-top:4px}.f27a-roles b{display:block;font-size:13px}.f27a-roles small{font-size:12.5px;opacity:.85}' +
    '.f27a-end{text-align:center}.f27a-end .e{font-size:56px;line-height:1}';
  function css() {
    if (document.getElementById('f27a-css')) return;
    var s = document.createElement('style'); s.id = 'f27a-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  function overlay(html, cls) {
    css();
    var ov = document.createElement('div'); ov.className = 'f27a-ov' + (cls ? ' ' + cls : '');
    ov.innerHTML = '<div class="f27a-card" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(ov);
    return ov;
  }

  // ---- 1. bemutató link -----------------------------------------------------------------------------
  function shareToken(key) {
    var sk = 'f27-share:' + (key || location.pathname);
    var m = /(?:^#|[#&])s=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash || '');
    var t = m ? m[1] : null;
    try { if (t) sessionStorage.setItem(sk, t); else t = sessionStorage.getItem(sk); } catch (e) { /* privát mód: csak a cím */ }
    // a token ne maradjon a címsorban, a böngésző előzményében és egy továbbküldött címben
    if (m) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* nem baj */ } }
    return t && TOKEN_RE.test(t) ? t : null;
  }
  function forget(key) { try { sessionStorage.removeItem('f27-share:' + (key || location.pathname)); } catch (e) { /* nem baj */ } }
  function shareClient(cfg, token) {
    return root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'f27-share-' + Math.random().toString(36).slice(2) },
      global: { headers: { 'x-share-token': token } }
    });
  }

  function startShare(o) {
    var site = o.site || 'a lakás', key = o.key, ended = false, off = 0, exp = 0, bar = null, timer = 0, ping = 0;
    function end(reason) {
      if (ended) return; ended = true;
      clearInterval(timer); clearInterval(ping); forget(key);
      if (bar) bar.remove();
      [].forEach.call(document.querySelectorAll('.f27a-ov'), function (x) { x.remove(); });
      var txt = reason === 'revoked' ? 'A tulaj lezárta ezt a bemutatót.' :
        reason === 'invalid' ? 'Ez a link érvénytelen. Lehet, hogy elírás van benne, vagy már nem él.' :
        'Lejárt az 59 perc 59 másodperc, a hozzáférés megszűnt.';
      overlay('<div class="f27a-end"><div class="e" aria-hidden="true">⏰</div><h2>Vége a bemutatónak</h2><p>' + esc(txt) + '</p>' +
        '<p class="f27a-note">Köszönjük, hogy benéztél ' + esc(site) + ' életébe! Ha még kíváncsi vagy, kérj új linket.</p></div>', 'f27a-dead');
      if (o.onExpire) o.onExpire(reason || 'expired');
    }
    function left() { return exp - (Date.now() + off); }
    function tick() {
      var l = left();
      if (l <= 0) { end('expired'); return; }
      if (bar) {
        bar.querySelector('.t').textContent = mmss(l);
        bar.querySelector('i').style.width = (100 * l / 3599000).toFixed(2) + '%';
        bar.classList.toggle('low', l < 5 * 60000);
      }
      var w = document.querySelector('.f27a-hi .f27a-big'); if (w) w.textContent = mmss(l);
    }
    function showBar() {
      css();
      bar = document.createElement('div'); bar.id = 'f27a-bar';
      if (o.phoneTop != null) bar.style.setProperty('--f27a-top', o.phoneTop + 'px');
      if (o.phoneLeft != null) { bar.classList.add('left'); bar.style.setProperty('--f27a-left', o.phoneLeft + 'px'); } bar.setAttribute('role', 'timer'); bar.setAttribute('aria-live', 'off');
      bar.innerHTML = '<span aria-hidden="true">👀</span><span class="lbl">BEMUTATÓ</span><span class="t">--:--</span>' +
        '<span class="txt">csak nézelődés, kapcsolni nem lehet</span><button type="button">Kilépés</button><i></i>';
      bar.querySelector('button').addEventListener('click', function () { end('left'); });
      document.body.appendChild(bar);
    }
    o.sb.rpc('share_open').then(function (res) {
      var d = res && res.data;
      if (res.error || !d || !d.ok) { end(d && d.reason ? d.reason : 'invalid'); return; }
      off = Date.parse(d.now) - Date.now(); exp = Date.parse(d.expires_at);
      var fresh = Date.now() + off - Date.parse(d.started) < 60000;
      showBar(); tick();
      timer = setInterval(tick, 1000);
      // a tulaj bármikor visszavonhatja: kétpercenként rákérdezünk (nem számít új megnyitásnak)
      ping = setInterval(function () {
        o.sb.rpc('share_open', { p_ping: true }).then(function (r) { var x = r && r.data; if (!r.error && x && !x.ok) end(x.reason); }, function () {});
      }, 120000);
      if (fresh) {
        var ov = overlay('<div class="f27a-hi"><h2>Szia! Körbenézel ' + esc(site) + '-ben?</h2>' +
          '<p>Ez egy <b>ideiglenes bemutató link</b>. Ennyi időd van:</p><div class="f27a-big">' + mmss(left()) + '</div>' +
          '<ul><li>Élőben látod, mi történik: hőmérséklet, fogyasztás, ajtók, ablakok' + (o.calendar ? ', a foglalási naptár' : '') + '.</li>' +
          '<li>Csak nézni tudsz: semmit nem kapcsolsz és nem állítasz át.</li>' +
          '<li>A visszaszámláló végén a link magától lejár.</li></ul>' +
          '<button class="f27a-btn" type="button">Nézzük!</button></div>');
        ov.querySelector('button').addEventListener('click', function () { ov.remove(); });
        ov.querySelector('button').focus();
      }
      if (o.onReady) o.onReady(d);
    }, function () { end('invalid'); });
    return { end: end, left: left };
  }

  // ---- 2. a tulaj panelje -------------------------------------------------------------------------
  function genPass() {
    var a = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = new Uint32Array(14), s = '';
    (root.crypto || root.msCrypto).getRandomValues(b);
    for (var i = 0; i < b.length; i++) { s += a[b[i] % a.length]; if (i === 4 || i === 9) s += '-'; }
    return s;
  }
  function copy(text, btn) {
    var done = function () { if (btn) { var t = btn.textContent; btn.textContent = 'Másolva ✓'; setTimeout(function () { btn.textContent = t; }, 1600); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { /* nem baj */ } ta.remove(); }
  }

  function openPanel(o) {
    var owner = o.role === 'owner', tab = owner ? 'share' : 'pass', listT = 0;
    var roles = o.roles || ['member', 'viewer'];
    var ov = overlay('<button class="f27a-x" type="button" aria-label="Bezárás">✕</button><h2>Hozzáférések</h2>' +
      '<div class="f27a-tabs" role="tablist">' +
      (owner ? '<button role="tab" data-t="share">Bemutató link</button><button role="tab" data-t="users">Felhasználók</button>' : '') +
      '<button role="tab" data-t="pass">Jelszavam</button></div><div class="f27a-body"></div>');
    var body = ov.querySelector('.f27a-body');
    function close() { clearInterval(listT); ov.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    ov.querySelector('.f27a-x').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    [].forEach.call(ov.querySelectorAll('.f27a-tabs button'), function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-t')); }); });

    function call(payload) {
      return o.sb.auth.getSession().then(function (r) {
        var t = r && r.data && r.data.session && r.data.session.access_token;
        if (!t) throw new Error('Lépj be újra.');
        return fetch(o.cfg.supabaseUrl + '/functions/v1/users', {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: o.cfg.supabaseKey, Authorization: 'Bearer ' + t },
          body: JSON.stringify(payload)
        });
      }).then(function (r) {
        if (r.status === 404) throw new Error('A felhasználókezelés még nincs telepítve: Actions > „Hozzáférés telepítése”.');
        return r.json().then(function (j) { if (!j.ok) throw new Error(j.error || 'Hiba.'); return j; });
      });
    }

    function show(t) {
      tab = t; clearInterval(listT);
      [].forEach.call(ov.querySelectorAll('.f27a-tabs button'), function (b) { b.setAttribute('aria-selected', b.getAttribute('data-t') === t ? 'true' : 'false'); });
      if (t === 'share') shareTab(); else if (t === 'users') usersTab(); else passTab();
    }

    // -- bemutató link
    function shareTab() {
      body.innerHTML = '<p>Ideiglenes link külsősöknek (barátok, rokonok): <b>csak nézni</b> tudnak, kapcsolni semmit.</p>' +
        '<ul class="f27a-note"><li>Az első megnyitástól <b>59:59</b>-ig él, utána magától lejár.</li><li>Ha 24 órán belül nem nyitják meg, akkor is lejár.</li>' +
        '<li>Bármikor visszavonhatod. A címet nem tároljuk: csak most látod.</li></ul>' +
        '<label class="f27a-f"><span>KINEK? (nem kötelező, csak neked)</span><input id="f27a-note" maxlength="60" placeholder="pl. Péter, Kati néni"></label>' +
        '<button class="f27a-btn" type="button" id="f27a-mk">Új bemutató link (59:59)</button><div class="f27a-err" id="f27a-e1"></div>' +
        '<div id="f27a-new"></div><h3 style="margin:14px 0 4px;font:400 18px \'Lilita One\',sans-serif">Az elmúlt 7 nap linkjei</h3><ul class="f27a-list" id="f27a-links"><li class="s">Betöltés…</li></ul>';
      body.querySelector('#f27a-mk').addEventListener('click', function () {
        var btn = this, note = body.querySelector('#f27a-note').value;
        btn.disabled = true; body.querySelector('#f27a-e1').textContent = '';
        o.sb.rpc('share_create', { p_note: note || null }).then(function (r) {
          btn.disabled = false;
          if (r.error || !r.data || !r.data.token) {
            var m = r.error && r.error.message || '';
            body.querySelector('#f27a-e1').textContent = /share_create|function/i.test(m) && !/tulaj|20/.test(m) ? 'A bemutató link még nincs telepítve: Actions > „Hozzáférés telepítése”.' : (m || 'Nem sikerült.');
            return;
          }
          var url = o.link + '#s=' + r.data.token;
          var nb = body.querySelector('#f27a-new');
          nb.innerHTML = '<div class="f27a-ok"><b>Kész a link' + (r.data.note ? ' (' + esc(r.data.note) + ')' : '') + '.</b> Küldd el, és ne tedd ki nyilvánosan.' +
            '<div class="f27a-row" style="margin-top:6px"><input readonly value="' + esc(url) + '" aria-label="Bemutató link"></div>' +
            '<button class="f27a-btn sm" type="button" data-a="copy">Másolás</button>' + (navigator.share ? '<button class="f27a-btn sm sec" type="button" data-a="share">Megosztás…</button>' : '') +
            '<div class="f27a-note">Ha ' + hm(r.data.open_by) + '-ig nem nyitják meg, lejár.</div></div>';
          nb.querySelector('[data-a="copy"]').addEventListener('click', function () { copy(url, this); });
          var sh = nb.querySelector('[data-a="share"]');
          if (sh) sh.addEventListener('click', function () { navigator.share({ title: o.site + ' bemutató', text: 'Nézz be ' + o.site + '-be! A link az első megnyitástól 59:59-ig él.', url: url }).catch(function () {}); });
          nb.querySelector('input').select();
          body.querySelector('#f27a-note').value = '';
          loadLinks();
        }, function () { btn.disabled = false; body.querySelector('#f27a-e1').textContent = 'Nem sikerült.'; });
      });
      loadLinks();
      listT = setInterval(paintLinks, 1000);
    }
    var links = [];
    function loadLinks() {
      o.sb.rpc('share_list').then(function (r) { links = r.error ? null : (r.data || []); paintLinks(); }, function () { links = null; paintLinks(); });
    }
    function paintLinks() {
      var ul = body.querySelector('#f27a-links'); if (!ul) return;
      if (links === null) { ul.innerHTML = '<li class="s">A lista nem tölthető be (telepítve van a 011-es migráció?).</li>'; return; }
      if (!links.length) { ul.innerHTML = '<li class="s">Még nincs link.</li>'; return; }
      var now = Date.now();
      ul.innerHTML = links.map(function (l) {
        var st, cls = 'off', live = false;
        if (l.revoked_at) st = 'visszavonva ' + hm(l.revoked_at);
        else if (l.expires_at && Date.parse(l.expires_at) <= now) st = 'lejárt ' + hm(l.expires_at);
        else if (l.expires_at) { st = 'FUT · ' + mmss(Date.parse(l.expires_at) - now) + ' van hátra'; cls = 'live'; live = true; }
        else if (Date.parse(l.open_by) <= now) st = 'nem nyitották meg, lejárt';
        else { st = 'még nem nyitották meg · ' + hm(l.open_by) + '-ig nyitható'; cls = ''; live = true; }
        return '<li><div class="h"><b>' + esc(l.note || 'Névtelen link') + '</b><span class="f27a-badge ' + cls + '">' + esc(st) + '</span></div>' +
          '<div class="s">Készült: ' + hm(l.created_at) + (l.opens ? ' · megnyitva ' + l.opens + '×' : '') + (l.last_seen ? ' · utoljára ' + hm(l.last_seen) : '') + '</div>' +
          (live ? '<button class="f27a-btn sm red" type="button" data-rv="' + esc(l.id) + '">Visszavonás</button>' : '') + '</li>';
      }).join('');
      [].forEach.call(ul.querySelectorAll('[data-rv]'), function (b) {
        b.addEventListener('click', function () {
          if (b.getAttribute('data-sure') !== '1') { b.setAttribute('data-sure', '1'); b.textContent = 'Biztos? Igen, vonja vissza'; return; }
          o.sb.rpc('share_revoke', { p_id: b.getAttribute('data-rv') }).then(loadLinks, loadLinks);
        });
      });
    }

    // -- felhasználók
    function roleRadios(sel) {
      return '<div class="f27a-roles">' + roles.map(function (r) {
        var t = (o.roleText && o.roleText[r]) || ROLE_TXT[r][1];
        return '<label><input type="radio" name="f27a-role" value="' + r + '"' + (r === sel ? ' checked' : '') + '><span><b>' + ROLE_TXT[r][0] + '</b><small>' + esc(t) + '</small></span></label>';
      }).join('') + '</div>';
    }
    function usersTab() {
      body.innerHTML = '<ul class="f27a-list" id="f27a-us"><li class="s">Betöltés…</li></ul><div class="f27a-err" id="f27a-e2"></div>' +
        '<details id="f27a-add"' + '><summary style="cursor:pointer;font-weight:900;margin:8px 0">＋ Új felhasználó</summary>' +
        '<label class="f27a-f"><span>NÉV</span><input id="f27a-nm" maxlength="40" placeholder="pl. Anna" autocomplete="off"></label>' +
        '<label class="f27a-f"><span>E-MAIL (ezzel lép be)</span><input id="f27a-em" type="email" autocomplete="off" placeholder="nev@pelda.hu"></label>' +
        '<div class="f27a-f"><span>SZEREPKÖR</span>' + roleRadios(roles[0]) + '</div>' +
        '<label class="f27a-f"><span>KEZDŐ JELSZÓ (add át neki; belépve megváltoztathatja)</span><span class="f27a-row"><input id="f27a-pw" autocomplete="new-password" value="' + genPass() + '">' +
        '<button class="f27a-btn sm sec" type="button" id="f27a-gen">Új</button></span></label>' +
        '<button class="f27a-btn" type="button" id="f27a-cr">Felveszem</button><div class="f27a-err" id="f27a-e3"></div><div id="f27a-done"></div></details>';
      body.querySelector('#f27a-gen').addEventListener('click', function () { body.querySelector('#f27a-pw').value = genPass(); });
      body.querySelector('#f27a-cr').addEventListener('click', function () {
        var btn = this, nm = body.querySelector('#f27a-nm').value.trim(), em = body.querySelector('#f27a-em').value.trim(), pw = body.querySelector('#f27a-pw').value;
        var rl = (body.querySelector('input[name="f27a-role"]:checked') || {}).value, e3 = body.querySelector('#f27a-e3');
        e3.textContent = '';
        if (!nm) { e3.textContent = 'Add meg a nevét.'; return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { e3.textContent = 'Az e-mail cím nem jó.'; return; }
        if (pw.length < 10) { e3.textContent = 'A jelszó legalább 10 karakter legyen.'; return; }
        btn.disabled = true;
        call({ action: 'create', email: em, name: nm, role: rl, password: pw }).then(function (j) {
          btn.disabled = false;
          var msg = 'Belépés: ' + o.link + '\nE-mail: ' + em + (j.existed ? '' : '\nJelszó: ' + pw);
          var d = body.querySelector('#f27a-done');
          d.innerHTML = '<div class="f27a-ok"><b>' + esc(nm) + ' felvéve (' + ROLE_TXT[rl][0].toLowerCase() + ').</b>' +
            (j.existed ? ' Ez az e-mail már létezett: a régi jelszava marad.' : ' Add át neki a belépési adatokat (személyesen vagy üzenetben):') +
            '<pre style="white-space:pre-wrap;font:700 13px ui-monospace,monospace;margin:6px 0">' + esc(msg) + '</pre><button class="f27a-btn sm" type="button">Másolás</button></div>';
          d.querySelector('button').addEventListener('click', function () { copy(msg, this); });
          body.querySelector('#f27a-nm').value = ''; body.querySelector('#f27a-em').value = ''; body.querySelector('#f27a-pw').value = genPass();
          loadUsers();
        }, function (err) { btn.disabled = false; e3.textContent = err.message; });
      });
      loadUsers();
    }
    function loadUsers() {
      var ul = body.querySelector('#f27a-us'); if (!ul) return;
      call({ action: 'list' }).then(function (j) {
        var us = (j.users || []).slice().sort(function (a, b) { return (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || String(a.name || a.email).localeCompare(String(b.name || b.email), 'hu'); });
        ul.innerHTML = us.map(function (u) {
          var me = u.user_id === o.userId, own = u.role === 'owner';
          var badge = u.role ? '<span class="f27a-badge ' + u.role + '">' + ROLE_TXT[u.role][0] + '</span>' : '<span class="f27a-badge off">NINCS JOGA</span>';
          return '<li data-u="' + esc(u.user_id) + '"><div class="h"><b>' + esc(u.name || '(név nélkül)') + (me ? ' (te)' : '') + '</b>' + badge + '</div>' +
            '<div class="s">' + esc(u.email) + (u.last_sign_in_at ? ' · utoljára belépett: ' + hm(u.last_sign_in_at) : ' · még nem lépett be') + '</div>' +
            (own ? '' : '<div class="f27a-row" style="margin-top:6px;flex-wrap:wrap"><select aria-label="Szerepkör" data-a="role" style="flex:1;min-width:140px;border:2px solid #1e2a44;border-radius:10px;padding:5px;font:700 14px Nunito,sans-serif">' +
              (u.role ? '' : '<option value="" selected>válassz…</option>') + roles.map(function (r) { return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + ROLE_TXT[r][0].toLowerCase() + '</option>'; }).join('') + '</select>' +
              '<button class="f27a-btn sm sec" type="button" data-a="name">Név</button><button class="f27a-btn sm sec" type="button" data-a="pw">Új jelszó</button><button class="f27a-btn sm red" type="button" data-a="del">Törlés</button></div>') + '</li>';
        }).join('') || '<li class="s">Nincs felhasználó.</li>';
        [].forEach.call(ul.querySelectorAll('li[data-u]'), function (li) {
          var id = li.getAttribute('data-u'), e2 = body.querySelector('#f27a-e2');
          function act(p, okTxt) { e2.textContent = ''; call(Object.assign({ user_id: id }, p)).then(function () { if (okTxt) e2.innerHTML = '<span style="color:#256b40">' + esc(okTxt) + '</span>'; loadUsers(); }, function (err) { e2.textContent = err.message; }); }
          var sel = li.querySelector('[data-a="role"]');
          if (sel) sel.addEventListener('change', function () { if (sel.value) act({ action: 'update', role: sel.value }, 'Szerepkör mentve.'); });
          var bn = li.querySelector('[data-a="name"]');
          if (bn) bn.addEventListener('click', function () { var n = prompt('Új név:', ''); if (n && n.trim()) act({ action: 'update', name: n.trim() }, 'Név mentve.'); });
          var bp = li.querySelector('[data-a="pw"]');
          if (bp) bp.addEventListener('click', function () {
            var p = genPass();
            if (!confirm('Új jelszó beállítása: ' + p + '\n\nA régi jelszó megszűnik. Mehet? (A jelszót a következő ablakban másolhatod.)')) return;
            e2.textContent = '';
            call({ action: 'update', user_id: id, password: p }).then(function () { e2.innerHTML = '<span style="color:#256b40">Új jelszó: <b>' + esc(p) + '</b></span> '; var c = document.createElement('button'); c.className = 'f27a-btn sm'; c.textContent = 'Másolás'; c.onclick = function () { copy(p, c); }; e2.appendChild(c); }, function (err) { e2.textContent = err.message; });
          });
          var bd = li.querySelector('[data-a="del"]');
          if (bd) bd.addEventListener('click', function () {
            if (bd.getAttribute('data-sure') !== '1') { bd.setAttribute('data-sure', '1'); bd.textContent = 'Biztos? Igen, törlöm'; return; }
            act({ action: 'remove' }, 'Törölve.');
          });
        });
      }, function (err) { ul.innerHTML = '<li class="s">' + esc(err.message) + '</li>'; });
    }

    // -- saját jelszó (mindenkinek)
    function passTab() {
      body.innerHTML = '<p>Saját jelszavad cseréje (legalább 10 karakter).</p>' +
        '<label class="f27a-f"><span>ÚJ JELSZÓ</span><input id="f27a-p1" type="password" autocomplete="new-password"></label>' +
        '<label class="f27a-f"><span>MÉG EGYSZER</span><input id="f27a-p2" type="password" autocomplete="new-password"></label>' +
        '<button class="f27a-btn" type="button" id="f27a-ps">Jelszó mentése</button><div class="f27a-err" id="f27a-e4"></div>';
      body.querySelector('#f27a-ps').addEventListener('click', function () {
        var a = body.querySelector('#f27a-p1').value, b = body.querySelector('#f27a-p2').value, e = body.querySelector('#f27a-e4'), btn = this;
        if (a.length < 10) { e.textContent = 'Legalább 10 karakter legyen.'; return; }
        if (a !== b) { e.textContent = 'A két jelszó nem egyezik.'; return; }
        btn.disabled = true;
        o.sb.auth.updateUser({ password: a }).then(function (r) {
          btn.disabled = false;
          if (r.error) { e.textContent = 'Nem sikerült: ' + (r.error.message || ''); return; }
          e.innerHTML = '<span style="color:#256b40">Kész, az új jelszó él.</span>'; body.querySelector('#f27a-p1').value = ''; body.querySelector('#f27a-p2').value = '';
        }, function () { btn.disabled = false; e.textContent = 'Nem sikerült.'; });
      });
    }
    show(tab);
    return { close: close };
  }

  root.F27Access = { shareToken: shareToken, shareClient: shareClient, startShare: startShare, openPanel: openPanel, forget: forget, ROLE_TXT: ROLE_TXT };
})(typeof window !== 'undefined' ? window : this);
