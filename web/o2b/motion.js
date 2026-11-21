/* Mozgás-statisztika a lépcső tetején (O2B, a tulaj választása 2026.11.21: M1 + M2 + M3 mind).
 *
 * Forrás: a mozgásérzékelő minden jelzése a Tuya-naplóból, percre pontosan (device_status, status.pir = 'pir').
 * Egy jelzés után az érzékelő kb. egy percig nem jelez újra, ezért a szám „mozgásos percek” száma
 * (percenként egyszer számolva, a napló és a 10 perces minta duplikátumai nélkül), nem lépésszám.
 * Az érzékelő nem tudja, ki ment el előtte, és merre; Pamutka is kiváltja.
 *
 * M3: mini kártya az adatlap Áttekintés fülén (ma óránként + egy átlagos ugyanilyen nap).
 * M1: heti hőtérkép (nap × óra), 12 hétre visszalapozható, eltérés-nézettel a 4 hetes átlaghoz.
 * M2: napszakok (a kiválasztott hét vs az előző 4 hét átlaga), mind / hétköznap / hétvége.
 * Időzóna: mindig Budapest, a böngésző saját időzónájától függetlenül.
 */
(function () {
  'use strict';
  var WEEKS = 12, DAY = 86400000;
  var DAYS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
  var DAYS_L = ['hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'];
  var PS = [['Éjjel', '0-6', 0, 6], ['Reggel', '6-9', 6, 9], ['Napközben', '9-17', 9, 17], ['Este', '17-22', 17, 22], ['Késő este', '22-24', 22, 24]];
  var PAL = ['#eef0f5', '#e6e2ff', '#c9c1fb', '#a99cf2', '#8a7fe0', '#6a5cc8', '#4b3fa3'];
  var fmt = null, hcache = {};
  try { fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }); } catch (e) { fmt = null; }

  // egy időpont budapesti napja (napszám 1970 óta), a hét napja (0 = hétfő) és órája
  function bud(t) {
    var k = Math.floor(t / 3600000);
    if (hcache[k]) return hcache[k];
    var y, m, d, h;
    if (fmt) {
      var p = {}; fmt.formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
      y = +p.year; m = +p.month; d = +p.day; h = +p.hour % 24;
    } else { var x = new Date(t); y = x.getFullYear(); m = x.getMonth() + 1; d = x.getDate(); h = x.getHours(); }
    var day = Date.UTC(y, m - 1, d) / DAY;
    return (hcache[k] = { day: day, wd: (new Date(day * DAY).getUTCDay() + 6) % 7, h: h });
  }

  var M = { ev: null, at: 0, loading: false, err: null, w: 0, cmp: false, view: 'wk', ps: 'all', sel: null, demo: false };

  // a mozgásos percek listája (ms), percre kerekítve, duplikátum nélkül
  function uniq(ts) {
    var seen = {}, out = [];
    ts.forEach(function (t) { var k = Math.floor(t / 60000); if (!seen[k]) { seen[k] = 1; out.push(k * 60000); } });
    return out.sort(function (a, b) { return a - b; });
  }

  // kitalált, de valószerű demóadat: hétköznap reggel és este csúcs, hétvégén később, éjjel a macska
  function demo() {
    var s = 7, r = function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }, out = [], now = Date.now();
    var today = bud(now);
    for (var back = WEEKS * 7; back >= 0; back--) {
      var dayStart = now - back * DAY, wd = bud(dayStart).wd, we = wd >= 5;
      for (var h = 0; h < 24; h++) {
        if (back === 0 && h > today.h) break;
        var b = 0;
        if (!we) { b = { 6: 5, 7: 9, 8: 4, 16: 3, 17: 3, 18: 7, 19: 10, 20: 7, 21: 7, 22: 4 }[h] || (h >= 9 && h <= 15 ? 1 : 0); }
        else { b = h >= 8 && h <= 10 ? 5 : h >= 11 && h <= 17 ? 4 : h >= 18 && h <= 22 ? 6 : h === 23 ? 3 : 0; }
        if (h < 6) b = r() < 0.35 ? 1 + Math.floor(r() * 2) : 0;
        var n = Math.max(0, Math.round(b * (0.6 + r() * 0.8)));
        var base = Date.UTC(1970, 0, 1) + (today.day - back) * DAY;     // budapesti nap éjfele (UTC-ben elég közelítés a demóhoz)
        for (var i = 0; i < n; i++) out.push(base + (h - 1) * 3600000 + Math.floor(r() * 59) * 60000);
      }
    }
    return uniq(out);
  }

  // betöltés: 12 hét mozgásjelzés lapozva (a Supabase egy kérésre legfeljebb 1000 sort ad)
  function load(ctx) {
    if (M.loading || (M.ev && Date.now() - M.at < 5 * 60000)) return;
    var sb = ctx.sb, pink = ctx.pink;
    if (!sb || !ctx.user || ctx.role === 'share') { M.ev = demo(); M.demo = true; M.at = Date.now(); return; }
    M.loading = true; M.err = null; M.demo = false;
    var since = new Date(Date.now() - (WEEKS * 7 + 7) * DAY).toISOString(), got = [];
    (function page(from) {
      sb.from('device_status').select('ts,status').eq('pink', pink).gte('ts', since).order('ts', { ascending: true }).range(from, from + 999).then(function (res) {
        if (res.error) { M.loading = false; M.err = res.error.message || 'hiba'; M.ev = []; M.at = Date.now(); ctx.done(); return; }
        (res.data || []).forEach(function (r) { if (r.status && r.status.pir === 'pir') got.push(Date.parse(r.ts)); });
        if ((res.data || []).length === 1000 && from < 30000) { page(from + 1000); return; }
        M.ev = uniq(got); M.at = Date.now(); M.loading = false; ctx.done();
      }, function () { M.loading = false; M.err = 'hálózati hiba'; M.ev = []; M.at = Date.now(); ctx.done(); });
    })(0);
  }

  function counts(days) {   // days: {napszám: [24 óra]}
    (M.ev || []).forEach(function (t) { var b = bud(t), row = days[b.day]; if (row) row[b.h]++; });
    return days;
  }
  function weekGrid(w) {   // w = 0 a mostani hét; visszaad: 7 × 24
    var td = bud(Date.now()), mon = td.day - td.wd - 7 * w, days = {}, g = [];
    for (var i = 0; i < 7; i++) days[mon + i] = new Array(24).fill(0);
    counts(days);
    for (i = 0; i < 7; i++) g.push(days[mon + i]);
    return { g: g, mon: mon };
  }
  function avgGrid(w) {     // az előző 4 hét átlaga cellánként
    var acc = [], n = 0;
    for (var k = w + 1; k <= w + 4; k++) { if (!hasWeek(k)) continue; var g = weekGrid(k).g; n++; g.forEach(function (row, d) { acc[d] = acc[d] || new Array(24).fill(0); row.forEach(function (v, h) { acc[d][h] += v; }); }); }
    if (!n) return null;
    return acc.map(function (row) { return row.map(function (v) { return v / n; }); });
  }
  function firstDay() { return M.ev && M.ev.length ? bud(M.ev[0]).day : null; }
  function hasWeek(w) {
    var f = firstDay(); if (f == null) return false;
    var td = bud(Date.now()), mon = td.day - td.wd - 7 * w;
    return mon + 6 >= f;
  }
  function dayLbl(day) {
    var x = new Date(day * DAY), mo = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];
    return mo[x.getUTCMonth()] + ' ' + x.getUTCDate() + '.';
  }
  function col(v) { return PAL[v <= 0 ? 0 : v <= 1 ? 1 : v <= 3 ? 2 : v <= 5 ? 3 : v <= 8 ? 4 : v <= 11 ? 5 : 6]; }
  function dcol(v) { return Math.abs(v) < 1 ? '#eef0f5' : v > 0 ? (v > 3 ? '#ff7a45' : '#ffc2a6') : (v < -3 ? '#4f86e8' : '#bcd2fb'); }
  function num(v) { return String(Math.round(v * 10) / 10).replace('.', ','); }

  function stateMsg() {
    if (M.loading || !M.ev) return '<div class="mo-n">Betöltöm a mozgásokat…</div>';
    if (M.err) return '<div class="mo-n">Nem sikerült betölteni: ' + M.err.slice(0, 80) + '</div>';
    if (!M.ev.length) return '<div class="mo-n">Még nincs rögzített mozgás. Az első jelzések után itt lesz a statisztika.</div>';
    return '';
  }

  // M3: mini kártya
  function mini() {
    var m = stateMsg(); if (m) return '<div class="mo">' + m + '</div>';
    var td = bud(Date.now()), days = {}, i;
    days[td.day] = new Array(24).fill(0);
    for (i = 1; i <= 4; i++) days[td.day - 7 * i] = new Array(24).fill(0);
    counts(days);
    var today = days[td.day], prev = [], f = firstDay();
    for (i = 1; i <= 4; i++) if (td.day - 7 * i >= f) prev.push(days[td.day - 7 * i]);
    var avg = new Array(24).fill(0); prev.forEach(function (r) { r.forEach(function (v, h) { avg[h] += v / prev.length; }); });
    var sum = today.slice(0, td.h + 1).reduce(function (a, b) { return a + b; }, 0);
    var avgSum = prev.length ? avg.reduce(function (a, b) { return a + b; }, 0) : null;
    var avgSoFar = prev.length ? avg.slice(0, td.h + 1).reduce(function (a, b) { return a + b; }, 0) : null;
    var pk = today.slice(0, td.h + 1), pkH = pk.indexOf(Math.max.apply(null, pk));
    var mx = Math.max.apply(null, today.concat(avg)) || 1, bw = 300 / 24, s = '<line x1="0" y1="80" x2="300" y2="80" stroke="#cfd3df" stroke-width="1"/>';
    for (var h = 0; h <= td.h; h++) { var y = 80 - today[h] / mx * 66; s += '<rect x="' + (h * bw + 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw - 4).toFixed(1) + '" height="' + (80 - y).toFixed(1) + '" rx="2" fill="' + (h === td.h ? '#4b3fa3' : '#8a7fe0') + '"><title>' + h + ':00-' + (h + 1) + ':00: ' + today[h] + '</title></rect>'; }
    if (prev.length) s += '<polyline points="' + avg.map(function (v, h) { return (h * bw + bw / 2).toFixed(1) + ',' + (80 - v / mx * 66).toFixed(1); }).join(' ') + '" fill="none" stroke="#6b7488" stroke-width="1.6" stroke-dasharray="4 3"/>';
    [0, 6, 12, 18].forEach(function (h) { s += '<text x="' + (h * bw + 2) + '" y="93" font-size="10" fill="#6b7488">' + h + '</text>'; });
    var cmp = avgSoFar ? Math.round((sum - avgSoFar) / Math.max(1, avgSoFar) * 100) : null;
    return '<div class="mo"><div class="sub">Mozgás ma <small>(mozgásos percek, óránként)</small></div>' +
      '<div class="mo-k"><div><small>Ma eddig</small><b>' + sum + '</b>' + (cmp != null ? '<em class="' + (cmp > 25 ? 'up' : cmp < -25 ? 'dn' : '') + '">' + (cmp > 0 ? '+' : '') + cmp + '%</em>' : '') + '</div>' +
      '<div><small>Átlagos ' + DAYS_L[td.wd] + '</small><b>' + (avgSum != null ? Math.round(avgSum) : '–') + '</b></div>' +
      '<div><small>Csúcs ma</small><b>' + (sum ? pkH + 'h' : '–') + '</b></div></div>' +
      '<svg class="mo-sp" viewBox="0 0 300 96" role="img" aria-label="Mai mozgás óránként' + (prev.length ? ', szaggatottan egy átlagos ' + DAYS_L[td.wd] : '') + '">' + s + '</svg>' +
      (prev.length ? '<div class="mo-l"><i class="b"></i>ma <i class="d"></i>átlagos ' + DAYS_L[td.wd] + ' (előző ' + prev.length + ' hét)</div>' : '<div class="mo-l">Az átlaghoz legalább egy hét adat kell.</div>') +
      '<button type="button" class="btn sm mo-more" data-mo="open">Hetek és napszakok ›</button>' + demoNote() + '</div>';
  }
  function demoNote() { return M.demo ? '<div class="mo-n">Példaadat (belépve a valódi mozgások látszanak).</div>' : ''; }

  // M1 + M2: a Hetek fül
  function weeks() {
    var m = stateMsg(); if (m) return '<div class="mo">' + m + '</div>';
    var h = '<div class="mo"><div class="mo-seg" role="group" aria-label="Nézet"><button type="button" data-mo="v" data-v="wk" aria-pressed="' + (M.view === 'wk') + '">Heti hőtérkép</button><button type="button" data-mo="v" data-v="ps" aria-pressed="' + (M.view === 'ps') + '">Napszakok</button></div>';
    var wg = weekGrid(M.w), mon = wg.mon, prevOk = hasWeek(M.w + 1) && M.w + 1 < WEEKS;
    h += '<div class="mo-wk"><button type="button" class="mo-nav" data-mo="prev" aria-label="Előző hét"' + (prevOk ? '' : ' disabled') + '>‹</button><b aria-live="polite">' + (M.w === 0 ? 'Ez a hét' : M.w === 1 ? 'Múlt hét' : M.w + ' hete') + '<small>' + dayLbl(mon) + ' - ' + dayLbl(mon + 6) + '</small></b><button type="button" class="mo-nav" data-mo="next" aria-label="Következő hét"' + (M.w > 0 ? '' : ' disabled') + '>›</button></div>';
    var tot = 0, mx = [0, 0, 0], night = 0;
    wg.g.forEach(function (row, d) { row.forEach(function (v, x) { tot += v; if (v > mx[0]) mx = [v, d, x]; if (x < 6) night += v; }); });
    h += '<div class="mo-k"><div><small>Összesen</small><b>' + tot + '</b></div><div><small>Csúcs</small><b>' + (tot ? DAYS[mx[1]] + ' ' + mx[2] + 'h' : '–') + '</b></div><div><small>Éjjel 0-6</small><b>' + night + '</b></div></div>';
    var avg = avgGrid(M.w);
    if (M.view === 'wk') {
      h += '<div class="mo-seg sm" role="group" aria-label="Színezés"><button type="button" data-mo="cmp" data-c="0" aria-pressed="' + !M.cmp + '">Ez a hét</button><button type="button" data-mo="cmp" data-c="1" aria-pressed="' + M.cmp + '"' + (avg ? '' : ' disabled') + '>Eltérés a 4 hetes átlagtól</button></div>';
      var cmp = M.cmp && avg, g = '<span></span>';
      for (var x = 0; x < 24; x++) g += '<span class="hh">' + (x % 6 === 0 ? x : '') + '</span>';
      var td = bud(Date.now());
      wg.g.forEach(function (row, d) {
        g += '<span class="dl">' + DAYS[d] + '</span>';
        row.forEach(function (v, x) {
          var fut = M.w === 0 && (d > td.wd || (d === td.wd && x > td.h));
          var c = fut ? 'transparent' : cmp ? dcol(v - avg[d][x]) : col(v);
          g += '<button type="button" class="c' + (M.sel && M.sel[0] === d && M.sel[1] === x ? ' sel' : '') + '" style="background:' + c + '" data-mo="cell" data-d="' + d + '" data-h="' + x + '" aria-label="' + DAYS_L[d] + ' ' + x + '-' + (x + 1) + ' óra: ' + (fut ? 'még nem volt' : v + ' mozgásos perc') + '"' + (fut ? ' disabled' : '') + '></button>';
        });
      });
      h += '<div class="mo-hmw"><div class="mo-hm" role="group" aria-label="Mozgás napok és órák szerint">' + g + '</div></div>';
      h += '<div class="mo-leg">' + (cmp ? '<span>kevesebb</span><i style="background:#4f86e8"></i><i style="background:#bcd2fb"></i><i style="background:#eef0f5"></i><i style="background:#ffc2a6"></i><i style="background:#ff7a45"></i><span>több az átlagnál</span>' :
        '<span>0</span>' + PAL.slice(1).map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '<span>12+ perc/óra</span>') + '</div>';
      if (M.sel) {
        var sd = M.sel[0], sh = M.sel[1], sv = wg.g[sd][sh];
        h += '<div class="mo-tip" role="status"><b>' + DAYS_L[sd] + ' ' + sh + ':00-' + (sh + 1) + ':00</b> · ' + sv + ' mozgásos perc' + (avg ? ', a 4 hetes átlag ' + num(avg[sd][sh]) : '') + (sh < 6 ? ' · éjjel: valószínűleg Pamutka' : '') + '</div>';
      } else h += '<div class="mo-tip">Koppints egy cellára a pontos számért.</div>';
    } else {
      h += '<div class="mo-seg sm" role="group" aria-label="Napok"><button type="button" data-mo="ps" data-p="all" aria-pressed="' + (M.ps === 'all') + '">Mind</button><button type="button" data-mo="ps" data-p="wd" aria-pressed="' + (M.ps === 'wd') + '">Hétköznap</button><button type="button" data-mo="ps" data-p="we" aria-pressed="' + (M.ps === 'we') + '">Hétvége</button></div>';
      var days = M.ps === 'wd' ? [0, 1, 2, 3, 4] : M.ps === 'we' ? [5, 6] : [0, 1, 2, 3, 4, 5, 6];
      var rows = PS.map(function (p) {
        var v = 0, a = 0;
        days.forEach(function (d) { for (var x = p[2]; x < p[3]; x++) { v += wg.g[d][x]; if (avg) a += avg[d][x]; } });
        return [p, v, avg ? a : null];
      });
      var top = Math.max.apply(null, rows.map(function (r) { return Math.max(r[1], r[2] || 0); })) || 1, all = rows.reduce(function (s, r) { return s + r[1]; }, 0) || 1;
      h += '<div class="mo-ps">' + rows.map(function (r) {
        return '<div class="row"><span>' + r[0][0] + '<small>' + r[0][1] + ' óra</small></span><div class="bars"><i class="a" style="width:' + Math.max(2, r[1] / top * 100) + '%"></i>' + (r[2] != null ? '<i class="b" style="width:' + Math.max(2, r[2] / top * 100) + '%"></i>' : '') + '</div><span class="n">' + r[1] + '<small>' + Math.round(r[1] / all * 100) + '%</small></span></div>';
      }).join('') + '</div><div class="mo-l"><i class="b"></i>a kiválasztott hét' + (avg ? ' <i class="d2"></i>az előző 4 hét átlaga' : '') + '</div>';
    }
    h += '<div class="mo-cat">Az érzékelő a lépcső tetején van, és nem tudja, ki ment el előtte, és merre. Pamutka is kiváltja: az éjszakai mozgás nagy része valószínűleg ő.</div>' + demoNote() + '</div>';
    return h;
  }

  function onClick(e, rerender, openTab) {
    var b = e.target.closest ? e.target.closest('[data-mo]') : null; if (!b || b.disabled) return false;
    var k = b.getAttribute('data-mo');
    if (k === 'open') { openTab('wk'); return true; }
    if (k === 'v') M.view = b.getAttribute('data-v');
    else if (k === 'prev') { M.w++; M.sel = null; }
    else if (k === 'next') { M.w = Math.max(0, M.w - 1); M.sel = null; }
    else if (k === 'cmp') M.cmp = b.getAttribute('data-c') === '1';
    else if (k === 'ps') M.ps = b.getAttribute('data-p');
    else if (k === 'cell') { var d = +b.getAttribute('data-d'), x = +b.getAttribute('data-h'); M.sel = M.sel && M.sel[0] === d && M.sel[1] === x ? null : [d, x]; }
    rerender();
    return true;
  }

  window.O2BMotion = { load: load, mini: mini, weeks: weeks, onClick: onClick, state: M, _bud: bud, _uniq: uniq };
})();
