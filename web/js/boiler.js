/* Bojler-napló (F27: 7-es kör, O2B: C1 konnektor; minden jövőbeli lakás is használhatja).

   Mennyit ment ma a bojler, mit jelent ez (hőtartás és melegvíz-használat külön, zuhanyban és literben),
   mennyibe került, és mihez képest sok vagy kevés (tegnap és a 7 napos átlag ugyanaddig az óráig).

   A hőtartás (a tartály hőveszteségének pótlása) mérésből jön: az éjszakai órákban (1-5 óra) senki nem
   enged meleg vizet, a bojler ilyenkor csak a veszteséget pótolja (2026.11.13-14-én az F27-ben 40 percenként
   2-3 perc 1,86 kW-on, kb. 2,5 kWh/nap). Ennek a mediánja × 24 a napi hőtartás.

   F27Boiler.load(sb, pink) -> Promise<raw>       (metrics_hourly 8 nap + energy_daily 15 nap)
   F27Boiler.demo(nowMs, profile) -> raw          (belépés nélkül, kitalált, de valószerű nap)
   F27Boiler.analyze(raw, { now, price, liveW }) -> a   (minden szám, ami a felülethez kell)
   F27Boiler.sub(a) -> 'ma 3,9 kWh ≈ 2 zuhany · 238 Ft · ▲ 26%'
   F27Boiler.open({ a, title, site, tips })       (A kártya felugró ablakban; ✕ és Esc zárja)          */
(function (root) {
  'use strict';
  var W_HEAT = 1860, SHOWER_KWH = 1.7, L_PER_KWH = 33, FULL_KWH = 5.6, TZ = 'Europe/Budapest';
  var NIGHT = [1, 2, 3, 4];

  function parts(ms) {
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { day: p.year + '-' + p.month + '-' + p.day, h: +p.hour, m: +p.minute };
  }
  function fmt(x, d) { return x == null || !isFinite(x) ? '--' : (+x).toFixed(d == null ? 1 : d).replace('.', ','); }
  function ft(x) { return x == null ? '--' : Math.round(x).toLocaleString('hu-HU').replace(/ /g, ' ') + ' Ft'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function load(sb, pink) {
    var now = Date.now(), h0 = new Date(now - 8 * 864e5).toISOString(), d0 = parts(now - 15 * 864e5).day;
    return Promise.all([
      sb.from('metrics_hourly').select('hour,kwh,w_max').eq('pink', pink).gte('hour', h0).order('hour', { ascending: true }).limit(400),
      sb.from('energy_daily').select('day,kwh,source').eq('pink', pink).gte('day', d0).order('day', { ascending: true }).limit(60)
    ]).then(function (r) {
      return { hours: r[0].error ? [] : (r[0].data || []), days: r[1].error ? [] : (r[1].data || []), err: !!(r[0].error && r[1].error) };
    }, function () { return { hours: [], days: [], err: true }; });
  }

  // kitalált, de valószerű adat a demóhoz: éjjel 40 percenként pótlás, reggel és este zuhanyok
  function demo(now, profile) {
    var hours = [], seed = profile === 'o2b' ? 11 : 5;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    var idleH = (profile === 'o2b' ? 2.2 : 2.5) / 24;
    for (var i = 8 * 24; i >= 0; i--) {
      var t = now - i * 3600e3, p = parts(t), k = idleH * (0.85 + rnd() * 0.3);
      var use = (p.h === 7 || p.h === 8) ? 0.5 + rnd() * 0.6 : (p.h === 19 || p.h === 20) ? 0.4 + rnd() * 0.7 : (p.h === 13 && rnd() > 0.5) ? 0.3 : 0;
      if (profile === 'o2b' && i < 24 && (p.h === 21)) use += 1.2;          // ma este fürdés
      hours.push({ hour: new Date(Math.floor(t / 3600e3) * 3600e3).toISOString(), kwh: +(k + use).toFixed(3), w_max: use || rnd() > 0.4 ? W_HEAT : 0 });
    }
    var byDay = {};
    hours.forEach(function (x) { var d = parts(Date.parse(x.hour)).day; byDay[d] = (byDay[d] || 0) + x.kwh; });
    return { hours: hours, days: Object.keys(byDay).map(function (d) { return { day: d, kwh: +byDay[d].toFixed(2), source: 'log' }; }), demo: true };
  }

  function analyze(raw, o) {
    o = o || {};
    var now = o.now || Date.now(), price = o.price || 60.9, P = parts(now), today = P.day;
    var cut = P.h + P.m / 60;                                   // a nap eddig eltelt órái
    var byDay = {}, minutes = [], i;
    for (i = 0; i < 24; i++) minutes.push(0);
    var nights = [];
    (raw.hours || []).forEach(function (x) {
      var ms = Date.parse(x.hour), p = parts(ms), kwh = +x.kwh || 0;
      (byDay[p.day] = byDay[p.day] || []).push({ h: p.h, kwh: kwh });
      if (p.day === today) minutes[p.h] += kwh / (W_HEAT / 1000) * 60;
      if (NIGHT.indexOf(p.h) >= 0 && p.day !== today) nights.push(kwh);
    });
    function upTo(day, hcut) { return (byDay[day] || []).reduce(function (s, x) { return s + (x.h < Math.floor(hcut) ? x.kwh : x.h === Math.floor(hcut) ? x.kwh * (hcut % 1) : 0); }, 0); }
    var todayH = upTo(today, 25), dayRow = (raw.days || []).filter(function (d) { return d.day === today; })[0];
    var todayKwh = Math.max(todayH, dayRow ? +dayRow.kwh : 0);
    // hőtartás: az éjszakai órák mediánja × 24; ha nincs elég éjszaka, a 14 nap legcsendesebb napja
    // az éjszakai órák ÁTLAGA a vízhasználat nélkül (f27/boiler.py ugyanígy); a medián 0 lehet, ha ritkán
    // fűt utána vagy éjjel ki van kapcsolva; 0,8 kWh/nap alatt nem valós a hőtartás: a legcsendesebb nap számít
    var quiet = nights.filter(function (k) { return k <= 0.5; });
    var idle = quiet.length >= 6 ? quiet.reduce(function (s, k) { return s + k; }, 0) / quiet.length * 24 : null, idleSrc = 'éjszakai órákból mérve';
    if (idle == null || idle < 0.8) {
      var full = (raw.days || []).filter(function (d) { return d.day < today && +d.kwh > 0; }).map(function (d) { return +d.kwh; });
      if (full.length >= 3) { idle = Math.min.apply(null, full); idleSrc = 'a legcsendesebb nap'; }
      else { idle = 2.5; idleSrc = 'becslés (még kevés a mérés)'; }
    }
    var idleSoFar = idle * Math.min(1, cut / 24), use = Math.max(0, todayKwh - idleSoFar);
    var yday = parts(now - 864e5).day, ySame = byDay[yday] ? upTo(yday, cut) : null;
    var same = [];
    for (i = 1; i <= 7; i++) { var d = parts(now - i * 864e5).day; if (byDay[d] && byDay[d].length >= 20) same.push(upTo(d, cut)); }
    var avg7 = same.length >= 3 ? same.reduce(function (s, x) { return s + x; }, 0) / same.length : null;
    var nightUse = (byDay[today] || []).filter(function (x) { return x.h <= 5 && x.kwh > Math.max(0.25, idle / 24 * 2.5); }).map(function (x) { return x.h; });
    var heatMin = minutes.reduce(function (s, x) { return s + x; }, 0);
    return {
      demo: !!raw.demo, empty: !(raw.hours || []).length && !(raw.days || []).length, price: price,
      now: now, cutH: cut, todayKwh: todayKwh, cost: todayKwh * price,
      idle: idle, idleSrc: idleSrc, idleCostDay: idle * price, idleCostMonth: idle * price * 30.4, idleSoFar: idleSoFar, idleCost: idleSoFar * price,
      use: use, useCost: use * price, showers: use / SHOWER_KWH, liters: use * L_PER_KWH,
      ySame: ySame, avg7: avg7, pctY: ySame ? todayKwh / ySame - 1 : null, pct7: avg7 ? todayKwh / avg7 - 1 : null,
      minutes: minutes, heatMin: heatMin, nightUse: nightUse, liveW: o.liveW == null ? null : o.liveW, fullKwh: FULL_KWH
    };
  }

  function pctTxt(p) { return p == null ? '' : (p >= 0 ? '↑ +' : '↓ ') + Math.round(p * 100) + '%'; }   // ↑↓: benne van a Nunito/Quest betűkészletben
  function showersTxt(n) { return n < 0.3 ? 'nem használták' : n < 0.75 ? 'kb. fél zuhany' : 'kb. ' + Math.round(n) + ' zuhany'; }
  function sub(a) {
    if (!a || a.empty) return '';
    // csak a Nunito betűkészletében meglévő jelek (a ≈ és a ▲ rendszerbetűre esne)
    var vs = a.pct7 == null ? '' : ' · ' + Math.abs(Math.round(a.pct7 * 100)) + '%-kal ' + (a.pct7 >= 0 ? 'több' : 'kevesebb') + ', mint a 7 napos átlag';
    return 'ma ' + fmt(a.todayKwh) + ' kWh, ' + showersTxt(a.showers) + ' · ' + ft(a.cost) + vs;
  }

  // ---- A: a kártya (felugró ablakban) ----------------------------------------------------------
  var CSS = '' +
    '.bl-ov{position:fixed;inset:0;z-index:8500;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(20,28,48,.5)}' +
    '.bl-card{position:relative;width:100%;max-width:520px;max-height:calc(100% - 20px);overflow:auto;background:#fff;border:3px solid #1e2a44;border-radius:20px;box-shadow:0 6px 0 #1e2a44;font:700 14px/1.4 Nunito,system-ui,sans-serif;color:#1e2a44}' +
    '.bl-x{position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:50%;border:2.5px solid #1e2a44;background:#fff;font:900 17px Nunito,sans-serif;cursor:pointer;z-index:1}' +
    '.bl-hd{display:flex;align-items:center;gap:12px;padding:14px 56px 12px 14px;background:linear-gradient(90deg,#fff1c9,#ffe2a8);border-bottom:3px solid #1e2a44}' +
    '.bl-zap{flex:none;width:44px;height:44px;border-radius:50%;background:#ffd23f;border:3px solid #1e2a44;display:grid;place-items:center}.bl-zap.on{animation:blzap .9s ease-in-out infinite}.bl-zap.off{background:#e4e6ea}' +
    '@keyframes blzap{0%,100%{transform:scale(1)}40%{transform:scale(1.12) rotate(-6deg)}}' +
    '.bl-n{font:400 18px "Quest Display","Lilita One","Baloo 2",sans-serif}.bl-s{font-weight:900;font-size:12.5px;color:#9a3412}' +
    '.bl-big{margin-left:auto;text-align:right;font:400 24px/1 "Quest Display","Lilita One","Baloo 2",sans-serif;white-space:nowrap}.bl-big small{display:block;font:900 11px Nunito,sans-serif;color:#5b6478}' +
    '.bl-k{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-bottom:2px solid #e6dcc6}.bl-k>div{padding:9px 11px;border-right:2px solid #e6dcc6;min-width:0}.bl-k>div:last-child{border-right:0}' +
    '.bl-k .l{font:900 10px Nunito,sans-serif;letter-spacing:.6px;color:#5b6478;text-transform:uppercase}.bl-k .v{font:400 20px/1.1 "Quest Display","Lilita One","Baloo 2",sans-serif;font-variant-numeric:tabular-nums}.bl-k .d{font-weight:900;font-size:11.5px}' +
    '.bl-up{color:#c4361f}.bl-dn{color:#2f8a3a}' +
    '.bl-bars{padding:10px 12px 2px}.bl-bars .lb{display:flex;justify-content:space-between;gap:8px;font:900 10.5px Nunito,sans-serif;color:#5b6478;letter-spacing:.4px}.bl-bars svg{display:block;width:100%;height:auto;margin-top:4px}' +
    '.bl-split{padding:8px 12px 10px;display:grid;gap:7px}.bl-row{display:grid;grid-template-columns:128px minmax(0,1fr) auto;align-items:center;gap:8px;font-weight:800;font-size:12.5px}' +
    '.bl-tr{height:13px;border-radius:999px;background:#eef1f5;border:2px solid #1e2a44;overflow:hidden}.bl-tr i{display:block;height:100%}' +
    '.bl-means{margin:0 12px 10px;padding:9px 11px;border-radius:13px;background:#eaf5ff;border:2px solid #1e2a44;font-weight:800;font-size:13px}' +
    '.bl-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.bl-chip{border:2px solid #1e2a44;border-radius:999px;background:#fff;padding:2px 9px;font:900 12px Nunito,sans-serif}' +
    '.bl-tip{margin:0 12px 12px;padding:9px 11px;border-radius:13px;background:#e7f8ec;border:2px solid #1e2a44;font-weight:800;font-size:13px}.bl-tip.warn{background:#fff1e6}' +
    '.bl-note{margin:0 12px 12px;font-size:11.5px;color:#5b6478;font-weight:700}' +
    '@media (max-width:520px){.bl-row{grid-template-columns:96px minmax(0,1fr) auto}.bl-k .v{font-size:17px}}' +
    '@media (prefers-reduced-motion:reduce){.bl-zap.on{animation:none}}';
  function css() { if (document.getElementById('bl-css')) return; var s = document.createElement('style'); s.id = 'bl-css'; s.textContent = CSS; document.head.appendChild(s); }

  function bars(a) {
    var maxM = Math.max(60, Math.max.apply(null, a.minutes)), H = 64, out = '';
    a.minutes.forEach(function (m, h) {
      if (!m) return;
      var hh = Math.max(2, m / maxM * H), cur = h === Math.floor(a.cutH);
      out += '<rect x="' + (h * 20 + 2) + '" y="' + (H + 6 - hh).toFixed(1) + '" width="16" height="' + hh.toFixed(1) + '" fill="' + (cur ? '#ffd23f' : '#ff7a1a') + '" stroke="#1e2a44" stroke-width="1.4"' + (cur ? ' stroke-dasharray="3 2"' : '') + '><title>' + h + ' óra: ' + Math.round(m) + ' perc fűtés</title></rect>';
    });
    var grid = '<g stroke="#e6dcc6" stroke-width="1"><line x1="0" y1="6" x2="480" y2="6"/><line x1="0" y1="' + (H / 2 + 6) + '" x2="480" y2="' + (H / 2 + 6) + '"/><line x1="0" y1="' + (H + 6) + '" x2="480" y2="' + (H + 6) + '"/></g>';
    var lab = '<g font-family="Nunito,sans-serif" font-weight="900" font-size="10" fill="#5b6478"><text x="0" y="' + (H + 20) + '">0</text><text x="116" y="' + (H + 20) + '">6</text><text x="236" y="' + (H + 20) + '">12</text><text x="356" y="' + (H + 20) + '">18</text><text x="466" y="' + (H + 20) + '">24</text><text x="478" y="14" text-anchor="end">' + Math.round(maxM) + ' p</text></g>';
    return '<svg viewBox="0 0 480 ' + (H + 24) + '" role="img" aria-label="Fűtési percek óránként ma">' + grid + out + lab + '</svg>';
  }

  function cardHtml(a, o) {
    o = o || {};
    var on = a.liveW != null && a.liveW > 500, total = Math.max(0.01, a.idleSoFar + a.use);
    var state = a.liveW == null ? 'állapot nem ismert' : on ? 'FŰT MOST · ' + fmt(a.liveW / 1000, 1) + ' kW' : 'felfűtve áll · ' + Math.round(a.liveW) + ' W';
    var h = '<div class="bl-hd"><div class="bl-zap ' + (on ? 'on' : 'off') + '" aria-hidden="true"><svg width="20" height="22" viewBox="-8 -12 16 24"><path d="M2,-11 L-6,1 L0,1 L-3,11 L7,-4 L1,-4 Z" fill="#1e2a44"/></svg></div>' +
      '<div><div class="bl-n">' + esc(o.title || 'Bojler') + '</div><div class="bl-s">' + esc(state) + '</div></div>' +
      '<div class="bl-big">' + fmt(a.todayKwh) + ' kWh<small>ma eddig · ' + ft(a.cost) + '</small></div></div>';
    h += '<div class="bl-k">' +
      '<div><div class="l">Tegnap ekkorra</div><div class="v">' + (a.ySame == null ? '--' : fmt(a.ySame) + ' kWh') + '</div><div class="d ' + (a.pctY > 0 ? 'bl-up' : 'bl-dn') + '">' + pctTxt(a.pctY) + '</div></div>' +
      '<div><div class="l">7 napos átlag</div><div class="v">' + (a.avg7 == null ? '--' : fmt(a.avg7) + ' kWh') + '</div><div class="d ' + (a.pct7 > 0 ? 'bl-up' : 'bl-dn') + '">' + pctTxt(a.pct7) + '</div></div>' +
      '<div><div class="l">Üres napon</div><div class="v">' + fmt(a.idle) + ' kWh</div><div class="d">csak hőtartás · <b>' + ft(a.idleCostDay) + '/nap</b></div></div></div>';
    h += '<div class="bl-bars"><div class="lb"><span>FŰTÉS PERCEI ÓRÁNKÉNT (MA)</span><span>össz. ' + Math.floor(a.heatMin / 60) + ' ó ' + Math.round(a.heatMin % 60) + ' p</span></div>' + bars(a) + '</div>';
    h += '<div class="bl-split">' +
      '<div class="bl-row"><span>Hőtartás (veszteség)</span><span class="bl-tr"><i style="width:' + Math.round(a.idleSoFar / total * 100) + '%;background:#b7c0cf"></i></span><span>' + fmt(a.idleSoFar) + ' kWh · ' + ft(a.idleCost) + '</span></div>' +
      '<div class="bl-row"><span>Melegvíz-használat</span><span class="bl-tr"><i style="width:' + Math.round(a.use / total * 100) + '%;background:#3b8cff"></i></span><span>' + fmt(a.use) + ' kWh · ' + ft(a.useCost) + '</span></div></div>';
    h += '<div class="bl-means">' + (a.use < 0.3 ? 'Ma eddig <b>nem használtak</b> meleg vizet: csak a tartály hőveszteségét pótolja.' :
      'Ez kb. <b>' + Math.round(a.liters / 5) * 5 + ' liter 38 °C-os zuhanyvíz</b>, vagyis') +
      (a.use < 0.3 ? '' : '<div class="bl-chips"><span class="bl-chip">🚿 ' + showersTxt(a.showers) + ' (8 perc)</span><span class="bl-chip">🛁 a kád ' + Math.max(1, Math.round(a.liters / 160 * 10)) * 10 + '%-a</span>' + (o.people ? '<span class="bl-chip">👥 ' + o.people + ' fő: ' + fmt(a.showers / o.people, 1) + ' zuhany/fő</span>' : '') + '</div>') + '</div>';
    (o.tips || []).forEach(function (t) { h += '<div class="bl-tip' + (t.warn ? ' warn' : '') + '">' + t.html + '</div>'; });
    h += '<div class="bl-note">Hőtartás: ' + esc(a.idleSrc) + ' (' + fmt(a.idle) + ' kWh/nap, kb. ' + ft(a.idleCostMonth) + '/hó). Ár: ' + fmt(a.price, 1) + ' Ft/kWh. Egy zuhany kb. 1,7 kWh, a teljes tartály felfűtése kb. 5,6 kWh.' + (a.demo ? ' <b>Demó adat.</b>' : '') + '</div>';
    return h;
  }

  function open(o) {
    css();
    var ov = document.createElement('div'); ov.className = 'bl-ov';
    ov.innerHTML = '<div class="bl-card" role="dialog" aria-modal="true" aria-label="' + esc(o.title || 'Bojler-napló') + '"><button class="bl-x" type="button" aria-label="Bezárás">✕</button>' + cardHtml(o.a, o) + '</div>';
    function close() { ov.remove(); document.removeEventListener('keydown', key); }
    function key(e) { if (e.key === 'Escape') close(); }
    ov.querySelector('.bl-x').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', key);
    document.body.appendChild(ov);
    ov.querySelector('.bl-x').focus();
    return { close: close };
  }

  root.F27Boiler = { load: load, demo: demo, analyze: analyze, sub: sub, open: open, cardHtml: cardHtml, showersTxt: showersTxt, fmt: fmt, ft: ft, pctTxt: pctTxt };
})(typeof window !== 'undefined' ? window : this);
