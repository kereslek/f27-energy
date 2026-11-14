/* Napkelte, napnyugta és a nap iránya (NOAA közelítés, kb. 1 perces pontosság Budapesten).
   Hálózat nélkül, a böngészőben számol; minden térkép ezt használja (F27, O2B, a későbbiek is).

   F27Sun.times(ms, lat, lon) -> { rise, set, noon (ms), riseAz, setAz (fok, É=0, K=90), dayLen (perc) }
   F27Sun.pos(ms, lat, lon)   -> { az (fok, É=0, K=90), alt (fok a horizont fölött) }
   F27Sun.hm(ms)              -> 'ÓÓ:PP' budapesti idő szerint                                     */
(function (root) {
  'use strict';
  var RAD = Math.PI / 180;
  function jd(ms) { return ms / 86400000 + 2440587.5; }
  function solar(ms) {                                  // napdeklináció és időegyenlet (perc)
    var T = (jd(ms) - 2451545) / 36525;
    var L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
    var lam = L0 + C - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * T) * RAD);
    var eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    var eps = eps0 + 0.00256 * Math.cos((125.04 - 1934.136 * T) * RAD);
    var dec = Math.asin(Math.sin(eps * RAD) * Math.sin(lam * RAD)) / RAD;
    var y = Math.pow(Math.tan(eps * RAD / 2), 2);
    var eqt = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
      - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
    return { dec: dec, eqt: eqt };
  }
  function pos(ms, lat, lon) {
    var s = solar(ms), d = new Date(ms);
    var utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
    var ha = ((utcMin + s.eqt + 4 * lon) / 4) - 180;               // óraszög (fok)
    var phi = lat * RAD, del = s.dec * RAD, H = ha * RAD;
    var cz = Math.sin(phi) * Math.sin(del) + Math.cos(phi) * Math.cos(del) * Math.cos(H);
    var z = Math.acos(Math.max(-1, Math.min(1, cz)));
    var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(del) * Math.cos(phi)) / RAD + 180;
    return { az: (az + 360) % 360, alt: 90 - z / RAD };
  }
  function times(ms, lat, lon) {
    var d = new Date(ms), day0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
    var s = solar(day0), phi = lat * RAD, del = s.dec * RAD;
    var cosH = (Math.cos(90.833 * RAD) - Math.sin(phi) * Math.sin(del)) / (Math.cos(phi) * Math.cos(del));
    var noonMin = 720 - 4 * lon - s.eqt, dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    var out = { noon: dayStart + noonMin * 60000 };
    if (cosH > 1 || cosH < -1) { out.rise = out.set = null; return out; }
    var H = Math.acos(cosH) / RAD;
    out.rise = dayStart + (noonMin - 4 * H) * 60000;
    out.set = dayStart + (noonMin + 4 * H) * 60000;
    out.riseAz = pos(out.rise, lat, lon).az;
    out.setAz = pos(out.set, lat, lon).az;
    out.dayLen = Math.round(8 * H);
    return out;
  }
  var FMT = null;
  function hm(ms) {
    try {
      FMT = FMT || new Intl.DateTimeFormat('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      return FMT.format(new Date(ms));
    } catch (e) { var d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  }
  root.F27Sun = { times: times, pos: pos, hm: hm };
})(typeof window !== 'undefined' ? window : this);
