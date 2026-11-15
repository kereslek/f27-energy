/* O2B: a lakás izometrikus babaháza (két szint, egymás fölött lebegve), bútorokkal, eszközökkel,
   és Pamutka útvonalával. A F27 G3 jelenetének stílusa: vastag sötét körvonal, három árnyalatú
   dobozok (teteje, bal és jobb oldala), távoli falak magasan, közeliek alacsonyan, 90 fokos forgatás.

   Mértékegység: méter, a hirdetés alaprajza szerint (x jobbra, y lefelé; lent y=0 az utcai, erkélyes fal).
   A cím, az utcanév és a fotók NEM kerülnek ide (publikus repó); csak méretek és bútortípusok.

   O2BScene.build(k, offs) -> { floors: { lo: {...}, up: {...} } } a k-szoros (90 fok) forgatáshoz;
   offs: { pieceId: [dx, dy] } a mozgatott bútorok eltolása méterben.                                     */
(function (root) {
  'use strict';
  var U = 30;                       // egység / méter (a F27 léptéke: 3,75 m = 112 egység)
  var INK = '#1e2a44';

  // ---- színek (a F27 palettája) ----------------------------------------------------------------
  var C = {
    WOOD: ['#d99b5e', '#a8703f', '#8c5c33'], OAK: ['#e0b27a', '#c18f57', '#a87a45'], WALNUT: ['#7a4f2e', '#5e3c22', '#4d311c'],
    DARK: ['#4a3324', '#36241a', '#2b1d14'], WHITE: ['#ffffff', '#e4e6ea', '#cfd3d9'], CREAM: ['#fff7e6', '#e6d8bc', '#d4c4a3'],
    GREY: ['#cfd4d8', '#aab2b9', '#949da5'], DGREY: ['#8e969e', '#6f7780', '#5d646c'], BLACK: ['#3a3532', '#26221f', '#1c1916'],
    SAGE: ['#a9c1a0', '#8eaa86', '#7c9775'], VELVET: ['#3f8a5a', '#2f6f47', '#255a3a'], NAVY: ['#3d5a8a', '#2e4670', '#253a5e'],
    ORANGE: ['#d9874a', '#b86c35', '#9c5a2b'], BLUEC: ['#c3dcf0', '#9cc0de', '#86abcb'], GLASS: ['#cfeaff', '#a9d4f5', '#93c2e8'],
    STEEL: ['#b8bec8', '#8f96a3', '#7a818e'], LAMP: ['#fff0b3', '#ffd060', '#e8b440'], LEAF: ['#6dbb5a', '#4f9a40', '#3f8233'],
    LEAF2: ['#8fd16f', '#6cb354', '#5a9a45'], TERRA: ['#d8875c', '#b86c45', '#9c5a3a'], RUGB: ['#9fb8cf', '#7f9bb5', '#6c88a3'],
    LINEN: ['#fbf8f1', '#e3dccb', '#d2c9b4'], SHAKER: ['#dfe3e3', '#c3c9c9', '#b0b7b7'], MARBLE: ['#f2f0ec', '#d9d5cd', '#c8c3b9'],
    WALL: ['#6a4c38', '#f6e7c8', '#ead3a6'], WALLW: ['#6a4c38', '#ffffff', '#eef0f2'], WALLB: ['#6a4c38', '#4a6a9a', '#3d5a85'],
    WALLS: ['#6a4c38', '#b7cdb0', '#a9c1a0'], LOW: ['#ffe0b0', '#d99a5e', '#b97c45'], INNER: ['#6a4c38', '#f6e7c8', '#e3cb9c'],
    SLAB: ['#e9b072', '#c97f4a', '#a8653a'], BEAM: ['#5a3a24', '#432a19', '#362114'], DECK: ['#c98d55', '#a8703f', '#8c5c33'],
    RED: ['#e8574a', '#c43f33', '#a8352b'], YELLOW: ['#ffd65a', '#e8b43a', '#c9982e'], PINKC: ['#f4b6c8', '#de94aa', '#c67d93']
  };

  // ---- alaprajz ---------------------------------------------------------------------------------
  // f: padló (oak = tölgy halszálka, lam = világos laminált, tile = csempe, deck = erkély fapadló)
  var FLOORS = {
    lo: {
      name: 'Lent', H: 3.0,
      rooms: [
        { id: 'erkely', n: 'Erkély', x: 0.75, y: -1.6, w: 3.4, d: 1.25, f: 'deck', open: true },
        { id: 'nappali', n: 'Nappali', x: 0, y: 0, w: 4.4, d: 6.2, f: 'oak' },
        { id: 'etkezo', n: 'Étkező', x: 0, y: 6.35, w: 4.45, d: 4.7, f: 'oak' },
        { id: 'halo', n: 'Hálószoba', x: 0, y: 11.2, w: 4.45, d: 3.2, f: 'oak' },
        { id: 'furdo_lent', n: 'Fürdő', x: 4.95, y: 5.8, w: 2.0, d: 1.5, f: 'tile' },
        { id: 'eloszoba', n: 'Előszoba', x: 4.95, y: 7.45, w: 1.85, d: 3.6, f: 'oak' },
        { id: 'kamra', n: 'Kamra', x: 6.95, y: 7.45, w: 1.15, d: 0.85, f: 'tile' },
        { id: 'konyha', n: 'Konyha', x: 6.95, y: 8.45, w: 2.6, d: 2.6, f: 'tile' }
      ],
      // külső falak: [x0, y0, x1, y1, oldal (a kifelé néző irány), nyílások [[a, b, fajta]]]
      // fajta: d = ajtó, w = ablak, g = üvegajtó (erkély)
      outer: [
        [0, 0, 4.4, 0, 'N', [[1.5, 2.9, 'g', 0, 2.6]], { low: 1.05 }],      // az erkély felé: alacsony, hogy látsszon az erkély
        [4.4, 0, 4.4, 5.8, 'E', [[1.4, 2.6, 'w']]],
        [4.4, 5.8, 6.95, 5.8, 'N', []],
        [6.95, 5.8, 6.95, 7.45, 'E', []],
        [6.95, 7.45, 8.1, 7.45, 'N', []],
        [8.1, 7.45, 8.1, 8.45, 'E', []],
        [8.1, 8.45, 9.55, 8.45, 'N', []],
        [9.55, 8.45, 9.55, 11.05, 'E', [[9.1, 10.3, 'w']]],
        [4.45, 11.05, 9.55, 11.05, 'S', [[5.35, 6.4, 'd', 0, 2.2, 'double'], [7.6, 8.8, 'w']]],   // bejárati ajtó (kétszárnyú, felülvilágítóval)
        [4.45, 11.05, 4.45, 14.4, 'E', [[12.0, 13.6, 'w', 0.45, 2.75]]],   // a háló magas ablaka (ÉK felé néz)
        [0, 14.4, 4.45, 14.4, 'S', []],
        [0, 0, 0, 14.4, 'W', []]
      ],
      inner: [
        [0, 6.27, 4.45, 6.27, [[1.9, 3.5]]],             // nappali / étkező: kétszárnyú üvegajtó
        [0, 11.12, 4.45, 11.12, [[2.9, 4.0]]],           // étkező / háló
        [4.7, 6.27, 4.7, 11.05, [[8.0, 9.0]]],           // étkező / előszoba
        [4.95, 7.37, 6.95, 7.37, [[5.4, 6.2]]],          // előszoba / fürdő
        [6.88, 7.45, 6.88, 11.05, [[7.6, 8.2], [8.9, 10.7]]],   // előszoba / kamra, konyha (félfal)
        [6.95, 8.38, 8.1, 8.38, []]                       // kamra / konyha
      ],
      stairs: { x: 0.1, y: 9.6, w: 2.7, d: 1.35, dir: 'W', steps: 12, rise: 3.0 },
      balcony: { x: 0.75, y: -1.6, w: 3.4, d: 1.25 }
    },
    up: {
      name: 'Fent', H: 3.0,
      rooms: [
        { id: 'kagylo', n: 'Kagyló szoba', x: 0, y: 0, w: 2.33, d: 4.55, f: 'lam' },
        { id: 'gyerek', n: 'Gyerekszoba', x: 2.45, y: 0, w: 2.1, d: 4.55, f: 'lam' },
        { id: 'eloter', n: 'Előtér', x: 0, y: 4.7, w: 4.55, d: 2.35, f: 'lam' },
        { id: 'lepcsohaz', n: 'Lépcső', x: 0, y: 7.05, w: 2.25, d: 3.45, f: 'lam' },
        { id: 'furdo_fent', n: 'Fürdő', x: 4.55, y: 5.65, w: 1.95, d: 1.4, f: 'tile' }
      ],
      outer: [
        [0, 0, 4.55, 0, 'N', [[0.75, 1.6, 'w'], [3.05, 3.9, 'w']]],
        [4.55, 0, 4.55, 5.65, 'E', []],
        [4.55, 5.65, 6.5, 5.65, 'N', []],
        [6.5, 5.65, 6.5, 7.05, 'E', []],
        [2.25, 7.05, 6.5, 7.05, 'S', []],
        [2.25, 7.05, 2.25, 10.5, 'E', []],
        [0, 10.5, 2.25, 10.5, 'S', []],
        [0, 0, 0, 10.5, 'W', []]
      ],
      inner: [
        [2.39, 0, 2.39, 4.62, []],
        [0, 4.62, 4.55, 4.62, [[1.35, 2.05], [2.95, 3.65]]],
        [4.55, 5.65, 4.55, 7.05, [[5.95, 6.75]]]
      ],
      hole: { x: 0.25, y: 7.4, w: 1.0, d: 2.6 },          // a lépcső nyílása (korláttal)
      beams: true
    }
  };

  // ---- bútorok: piece(id, név, szint) + dobozok [x, y, w, d, z, h, szín] méterben ------------------
  var PIECES = [];
  function piece(id, name, fl, boxes, drag) { PIECES.push({ id: id, name: name, fl: fl, drag: drag !== false, boxes: boxes }); }
  function legs(x, y, w, d, h, c, t) { t = t || 0.06; return [[x, y, t, t, 0, h, c], [x + w - t, y, t, t, 0, h, c], [x, y + d - t, t, t, 0, h, c], [x + w - t, y + d - t, t, t, 0, h, c]]; }
  function chairs6(cx, cy) {
    var out = [];
    [[-0.75, -0.62], [0, -0.68], [0.75, -0.62], [-0.75, 0.62], [0, 0.68], [0.75, 0.62]].forEach(function (o) {
      var x = cx + o[0] - 0.22, y = cy + o[1] - 0.2;
      out.push([x, y, 0.44, 0.4, 0, 0.45, C.GREY]);
      out.push([x + 0.04, y + (o[1] < 0 ? 0 : 0.32), 0.36, 0.08, 0.45, 0.4, C.GREY]);
    });
    return out;
  }
  function plant(x, y, s, pot) { s = s || 1; return [[x, y, 0.3 * s, 0.3 * s, 0, 0.32 * s, pot || C.TERRA], [x - 0.08 * s, y - 0.08 * s, 0.46 * s, 0.46 * s, 0.32 * s, 0.42 * s, C.LEAF], [x + 0.02 * s, y + 0.02 * s, 0.26 * s, 0.26 * s, 0.74 * s, 0.26 * s, C.LEAF2]]; }

  // LENT ------------------------------------------------------------------------------------------
  // Erkély: Pamutka helye, növények, függő hintaszék, kis asztal, a multi-split kültéri egysége
  piece('balc_plants', 'Erkélynövények (citrom, füge, olajfa, levendula)', 'lo',
    [].concat(plant(0.85, -1.5, 1.1), plant(1.35, -1.52, 0.8), plant(3.0, -1.52, 0.9, C.WHITE), plant(0.85, -0.95, 0.7)));
  piece('balc_egg', 'Függő hintaszék', 'lo', [[1.75, -1.4, 0.06, 0.06, 0.6, 1.6, C.DARK], [1.55, -1.5, 0.6, 0.55, 0.35, 0.7, C.CREAM], [1.6, -1.45, 0.5, 0.45, 0.4, 0.15, C.LINEN]]);
  piece('balc_table', 'Összecsukható asztal, két székkel', 'lo', [].concat(legs(2.3, -1.35, 0.55, 0.5, 0.7, C.DARK), [[2.3, -1.35, 0.55, 0.5, 0.7, 0.04, C.WOOD], [2.15, -1.25, 0.12, 0.32, 0, 0.75, C.DARK], [2.92, -1.25, 0.12, 0.32, 0, 0.75, C.DARK]]));
  piece('ac_out', 'Klíma kültéri egység (Gree, a nappali és a háló közös multi-splitje)', 'lo', [[3.15, -1.55, 0.94, 0.52, 0, 0.64, C.WHITE], [3.2, -1.03, 0.4, 0.02, 0.12, 0.4, C.DGREY], [3.15, -1.55, 0.94, 0.52, 0.64, 0.06, C.DECK]]);

  // Nappali
  piece('lv_curtains', 'Zöld bársonyfüggöny az erkélyajtónál', 'lo', [[1.2, 0.08, 0.25, 0.12, 0, 2.7, C.VELVET], [2.95, 0.08, 0.25, 0.12, 0, 2.7, C.VELVET], [1.1, 0.04, 2.2, 0.05, 2.7, 0.05, C.BLACK]], false);
  piece('lv_radiator', 'Radiátor az erkélyajtó mellett', 'lo', [[3.25, 0.12, 0.9, 0.1, 0.12, 0.55, C.WHITE]], false);
  piece('ac_lv', 'Klíma beltéri egysége a kanapé fölött (Gree, IR-ről)', 'lo', [[0.04, 2.75, 0.26, 0.95, 2.25, 0.32, C.WHITE], [0.29, 2.8, 0.02, 0.85, 2.27, 0.06, C.GREY]], false);
  piece('lv_sofa', 'Kanapé', 'lo', [[0.25, 2.2, 0.9, 2.2, 0, 0.42, C.GREY], [0.12, 2.2, 0.25, 2.2, 0, 0.8, C.GREY], [0.25, 2.05, 0.9, 0.2, 0, 0.62, C.GREY], [0.25, 4.35, 0.9, 0.2, 0, 0.62, C.GREY], [0.35, 2.4, 0.18, 0.5, 0.42, 0.3, C.BLUEC], [0.35, 3.8, 0.18, 0.5, 0.42, 0.3, C.YELLOW]]);
  piece('lv_rug', 'Szőnyeg', 'lo', [[1.3, 2.1, 2.1, 2.6, 0, 0.02, C.CREAM]]);
  piece('lv_coffee', 'Dohányzóasztal', 'lo', [].concat(legs(1.65, 2.85, 0.9, 0.9, 0.38, C.DARK), [[1.6, 2.8, 1.0, 1.0, 0.38, 0.05, C.WALNUT], [1.95, 3.15, 0.22, 0.22, 0.43, 0.12, C.LEAF]]));
  piece('lv_tv', 'TV a lécfalon, lebegő TV-pult LED-szalaggal', 'lo', [[4.24, 1.6, 0.1, 2.4, 0.2, 2.5, C.WOOD], [3.92, 1.8, 0.36, 2.0, 0.35, 0.3, C.WALNUT], [4.18, 2.25, 0.06, 1.1, 0.95, 0.66, C.BLACK], [3.95, 1.8, 0.3, 2.0, 0.32, 0.03, C.LAMP]]);
  piece('lv_vitrine', 'Antik vitrin', 'lo', [[0.1, 0.5, 0.45, 1.1, 0, 1.9, C.WALNUT], [0.52, 0.6, 0.03, 0.9, 0.5, 1.2, C.GLASS]]);
  piece('lv_table', 'Kerek, bővíthető tölgy étkezőasztal', 'lo', [[2.45, 0.85, 0.12, 0.12, 0, 0.74, C.DARK], [2.0, 0.4, 1.0, 1.0, 0.74, 0.05, C.OAK], [1.75, 0.75, 0.3, 0.3, 0, 0.45, C.GREY], [2.95, 0.75, 0.3, 0.3, 0, 0.45, C.GREY]]);
  piece('lv_cab', 'Magas fehér szekrény, alatta a robotporszívó dokkja', 'lo', [[3.7, 5.55, 0.65, 0.55, 0.12, 1.9, C.WHITE], [3.82, 5.6, 0.36, 0.36, 0, 0.1, C.BLACK]]);
  // robotporszívó lent: DreameBot Z10 Pro a porgyűjtő dokkjában, a nappali sarkában (R1)
  piece('lv_robot', 'DreameBot Z10 Pro robotporszívó a porgyűjtő dokkjában (R1)', 'lo', [[0.06, 5.58, 0.2, 0.36, 0, 0.42, C.DGREY], [0.08, 5.62, 0.16, 0.28, 0.42, 0.04, C.BLACK],
    { cyl: [0.45, 5.76, 0.17, 0, 0.09], c: C.DGREY }, { cyl: [0.45, 5.76, 0.05, 0.09, 0.03], c: C.BLACK }]);
  piece('lv_deer', 'Szarvas (dekor, okos konnektoron)', 'lo', [[1.0, 0.35, 0.12, 0.3, 0, 0.55, C.CREAM], [0.98, 0.35, 0.16, 0.36, 0.55, 0.22, C.CREAM], [1.0, 0.3, 0.12, 0.1, 0.77, 0.25, C.CREAM]]);

  // Étkező
  piece('dn_rug', 'Kék-bézs, kopott mintás szőnyeg', 'lo', [[0.95, 6.75, 2.6, 2.75, 0, 0.02, C.RUGB], [1.15, 6.95, 2.2, 2.35, 0.02, 0.01, C.CREAM]]);
  // élfás (live edge) tölgylap, fekete fém U-lábak; hosszában a nappali felé áll; 6 szürke kagylószék
  piece('dn_table', 'Élfás tölgyasztal fekete fémlábbal, 6 szürke kagylószékkel', 'lo', (function () {
    var o = [[1.82, 7.3, 0.8, 0.06, 0, 0.72, C.BLACK], [1.82, 8.94, 0.8, 0.06, 0, 0.72, C.BLACK],
      [1.74, 7.2, 0.96, 1.9, 0.72, 0.05, C.OAK], [1.7, 7.45, 0.04, 0.6, 0.72, 0.05, C.OAK], [2.7, 8.2, 0.04, 0.55, 0.72, 0.05, C.OAK]];
    function shell(x, y, w, d, bx, by, bw, bd) { o.push([x, y, w, d, 0.0, 0.46, C.GREY], [bx, by, bw, bd, 0.3, 0.42, C.GREY]); }
    shell(1.2, 7.55, 0.42, 0.42, 1.14, 7.55, 0.12, 0.42); shell(1.2, 8.35, 0.42, 0.42, 1.14, 8.35, 0.12, 0.42);
    shell(2.84, 7.55, 0.42, 0.42, 3.2, 7.55, 0.12, 0.42); shell(2.84, 8.35, 0.42, 0.42, 3.2, 8.35, 0.12, 0.42);
    shell(2.02, 6.72, 0.42, 0.4, 2.02, 6.66, 0.42, 0.12); shell(2.02, 9.18, 0.42, 0.38, 2.02, 9.48, 0.42, 0.1);
    return o;
  })());
  // A fotók szerint (a lépcső tetejéről és az előszoba ajtajából): a nyugati falon az alacsony fekete,
  // üvegajtós tálaló, rajta két fehér lámpa (C2), fölötte a fekete keretes fekvő tükör (C5); a lépcső
  // felőli sarokban a krém füles fotel, mögötte a lépcső alatti fekete beépített szekrény; a keleti falon
  // az előszoba ajtaja és a vakajtós ruhásszekrény; középen az asztal hosszában a nappali üvegajtaja felé.
  piece('dn_side', 'Alacsony fekete üvegajtós tálaló, rajta a dupla lámpa (két fehér asztali lámpa, C2)', 'lo', [[0.05, 7.05, 0.45, 1.6, 0, 0.82, C.BLACK], [0.5, 7.12, 0.02, 0.72, 0.12, 0.6, C.GLASS], [0.5, 7.88, 0.02, 0.72, 0.12, 0.6, C.GLASS], [0.48, 7.84, 0.04, 0.04, 0.05, 0.75, C.BLACK],
    [0.15, 7.15, 0.2, 0.2, 0.82, 0.12, C.WHITE], [0.11, 7.11, 0.28, 0.28, 0.94, 0.26, C.CREAM], [0.15, 8.35, 0.2, 0.2, 0.82, 0.12, C.WHITE], [0.11, 8.31, 0.28, 0.28, 0.94, 0.26, C.CREAM]]);
  piece('dn_mirror', 'Nagy fekvő tükör fekete kerettel a tálaló fölött', 'lo', [[0.02, 7.1, 0.07, 1.5, 1.3, 0.8, C.BLACK], [0.07, 7.17, 0.04, 1.36, 1.37, 0.66, C.GLASS]], false);
  piece('dn_under', 'Fekete beépített szekrény a lépcső alatt', 'lo', [[0.1, 9.55, 1.25, 0.06, 0, 1.85, C.BLACK], [0.75, 9.52, 0.03, 0.12, 0.9, 0.18, C.CREAM]], false);
  piece('dn_radiator', 'Radiátor (0-ra véve; itt mér a Computherm)', 'lo', [[3.55, 6.42, 0.75, 0.1, 0.12, 0.55, C.WHITE]], false);
  piece('dn_thermostat', 'Computherm termosztát (étkező sarka)', 'lo', [[4.32, 6.45, 0.06, 0.14, 1.3, 0.18, C.WHITE]], false);
  piece('dn_chair', 'Krém füles fotel a sarokban, a lépcső mellett', 'lo', [[0.2, 8.85, 0.72, 0.68, 0, 0.42, C.CREAM], [0.1, 8.8, 0.16, 0.78, 0, 1.05, C.CREAM], [0.1, 8.78, 0.3, 0.1, 0.4, 0.62, C.CREAM], [0.1, 9.5, 0.3, 0.1, 0.4, 0.62, C.CREAM], [0.2, 8.8, 0.7, 0.12, 0, 0.62, C.CREAM], [0.2, 9.48, 0.7, 0.12, 0, 0.62, C.CREAM]]);
  piece('dn_wardrobe', 'Vakajtó mögötti ruhásszekrény (keleti fal)', 'lo', [[4.2, 9.25, 0.4, 1.3, 0, 2.2, C.WHITE], [4.18, 9.88, 0.03, 0.04, 1.0, 0.2, C.STEEL]], false);
  piece('dn_tree', 'Karácsonyfa (okos konnektoron)', 'lo', [[3.6, 9.9, 0.3, 0.3, 0, 0.2, C.TERRA], [3.42, 9.72, 0.66, 0.66, 0.2, 0.6, C.LEAF], [3.52, 9.82, 0.46, 0.46, 0.8, 0.5, C.LEAF], [3.62, 9.92, 0.26, 0.26, 1.3, 0.4, C.LEAF2], [3.7, 10.0, 0.1, 0.1, 1.7, 0.12, C.YELLOW]]);

  // Hálószoba
  piece('ac_bd', 'Klíma beltéri egysége az ajtó fölött (IR-távirányítóval)', 'lo', [[3.0, 11.2, 0.9, 0.24, 2.38, 0.3, C.WHITE]], false);
  piece('bd_curtain', 'Fehér függöny a magas ablakon (ÉK-i fal)', 'lo', [[4.24, 11.75, 0.1, 0.25, 0.1, 2.65, C.LINEN], [4.24, 13.6, 0.1, 0.25, 0.1, 2.65, C.LINEN], [4.3, 11.7, 0.05, 2.2, 2.75, 0.05, C.BLACK]], false);
  // szimmetrikus beépített szekrényfal a teljes nyugati falon: két szekrénytorony, középen a zsályazöld
  // fülke az ággyal, fölötte áthidaló felső szekrény
  piece('bd_wardrobe', 'Beépített szekrényfal a teljes falon, középen fülke az ággyal (szimmetrikus)', 'lo', [
    [0.06, 11.22, 0.62, 0.78, 0, 2.7, C.WHITE], [0.06, 13.6, 0.62, 0.78, 0, 2.7, C.WHITE],
    [0.06, 12.0, 0.62, 1.6, 2.05, 0.65, C.WHITE], [0.06, 12.0, 0.05, 1.6, 0, 2.05, C.SAGE],
    [0.66, 11.6, 0.03, 0.04, 1.0, 0.25, C.BLACK], [0.66, 13.96, 0.03, 0.04, 1.0, 0.25, C.BLACK]], false);
  piece('bd_bed', 'Franciaágy a szekrényfal fülkéjében', 'lo', [[0.12, 12.05, 2.0, 1.5, 0, 0.45, C.WALNUT], [0.14, 12.07, 1.96, 1.46, 0.45, 0.14, C.LINEN], [1.0, 12.05, 1.1, 1.5, 0.58, 0.05, C.SAGE], [0.22, 12.17, 0.38, 0.55, 0.59, 0.14, C.WHITE], [0.22, 12.88, 0.38, 0.55, 0.59, 0.14, C.WHITE]]);
  piece('bd_desk', 'Állítható íróasztal LG monitorral', 'lo', [].concat([[3.3, 13.4, 1.0, 0.6, 0.72, 0.04, C.OAK], [3.35, 13.45, 0.06, 0.5, 0, 0.72, C.BLACK], [4.2, 13.45, 0.06, 0.5, 0, 0.72, C.BLACK], [3.55, 13.85, 0.55, 0.06, 0.95, 0.35, C.BLACK]], [[3.6, 12.95, 0.45, 0.45, 0, 0.5, C.BLACK], [3.62, 12.9, 0.42, 0.08, 0.5, 0.5, C.BLACK]]));
  piece('bd_radiator', 'Radiátor az ablak alatt', 'lo', [[4.22, 12.15, 0.1, 1.3, 0.12, 0.55, C.WHITE]], false);
  piece('bd_iron', 'Vasalódeszka', 'lo', [[3.0, 11.45, 1.1, 0.32, 0.85, 0.04, C.BLUEC], [3.4, 11.55, 0.04, 0.1, 0, 0.85, C.STEEL]]);

  // Előszoba, fürdő, kamra, konyha
  piece('hl_wardrobe', 'Beépített szekrénysor', 'lo', [[4.98, 8.2, 0.45, 2.6, 0, 2.4, C.WHITE]], false);
  piece('hl_mat', 'Lábtörlő', 'lo', [[5.55, 10.4, 0.8, 0.5, 0, 0.02, C.TERRA]]);
  piece('bt_shower', 'Zuhany fekete keretes üvegfallal', 'lo', [[6.0, 5.88, 0.9, 0.9, 0, 0.06, C.WHITE], [6.0, 6.76, 0.9, 0.03, 0.06, 1.95, C.GLASS], [6.0, 6.76, 0.9, 0.03, 2.0, 0.04, C.BLACK]], false);
  piece('bt_washer', 'Gorenje mosógép, fölötte a szekrényben a Savio gázkazán', 'lo', [[5.0, 5.9, 0.6, 0.55, 0, 0.85, C.BLACK], [5.0, 5.86, 0.6, 0.45, 1.5, 0.75, C.WHITE], [5.12, 5.86, 0.36, 0.03, 1.62, 0.5, C.CREAM]], false);
  piece('bt_wc', 'Fekete fali WC és mosdó', 'lo', [[5.05, 6.85, 0.36, 0.5, 0.25, 0.25, C.BLACK], [5.6, 7.05, 0.45, 0.3, 0.5, 0.35, C.WALNUT], [5.62, 7.07, 0.41, 0.26, 0.85, 0.06, C.WHITE]], false);
  piece('bt_towel', 'Fekete törölközőszárító radiátor', 'lo', [[6.85, 6.2, 0.06, 0.5, 0.4, 1.0, C.BLACK]], false);
  // C alakú konyha: a pult az északi falon (főzőlap, mosogató), a nyugati végén félsziget fordul be a
  // szoba közepe felé; a keleti falon magas oszlopok (sütő, mikró, hűtő); fent felső szekrények.
  piece('kc_counter', 'Konyhapult: gázfőzőlap, fekete gránit mosogató', 'lo', [[7.0, 8.5, 2.5, 0.6, 0, 0.88, C.SHAKER], [7.0, 8.5, 2.5, 0.62, 0.88, 0.05, C.OAK],
    [8.25, 8.58, 0.55, 0.46, 0.93, 0.03, C.BLACK], [7.45, 8.6, 0.5, 0.4, 0.92, 0.02, C.BLACK], [7.0, 8.47, 2.5, 0.03, 0.93, 0.55, C.MARBLE],
    [7.0, 8.5, 1.95, 0.36, 1.48, 0.92, C.SHAKER]], false);
  piece('kc_peninsula', 'Félsziget a mosogatóval (befordul a szoba közepe felé)', 'lo', [[7.0, 9.12, 0.62, 0.95, 0, 0.88, C.SHAKER], [6.98, 9.12, 0.66, 0.99, 0.88, 0.05, C.OAK], [7.12, 9.3, 0.38, 0.4, 0.92, 0.02, C.WHITE]], false);
  piece('kc_tall', 'Magas oszlopok: beépített sütő, mikró, hűtő', 'lo', [[8.95, 9.12, 0.55, 0.7, 0, 2.4, C.SHAKER], [8.93, 9.22, 0.03, 0.5, 0.8, 0.55, C.BLACK], [8.93, 9.22, 0.03, 0.5, 1.42, 0.3, C.BLACK],
    [8.95, 9.82, 0.55, 0.65, 0, 2.4, C.SHAKER], [8.95, 10.47, 0.55, 0.53, 0, 2.4, C.SHAKER]], false);
  piece('kc_radiator', 'Radiátor a konyhaablak alatt', 'lo', [[7.8, 10.92, 1.0, 0.08, 0.12, 0.5, C.WHITE]], false);
  piece('kc_lamp', 'Háromágú fekete függesztett lámpa', 'lo', [[7.6, 9.6, 1.0, 0.04, 2.95, 0.02, C.BLACK], [7.62, 9.55, 0.15, 0.15, 2.1, 0.18, C.LAMP], [8.02, 9.55, 0.15, 0.15, 2.05, 0.18, C.LAMP], [8.42, 9.55, 0.15, 0.15, 2.0, 0.18, C.LAMP]], false);
  piece('pn_shelf', 'Kamra polcai', 'lo', [[7.0, 7.5, 1.05, 0.3, 0, 2.0, C.OAK]], false);

  // FENT ------------------------------------------------------------------------------------------
  // kagyló szoba: belépve jobbra, a szoba végében a falhoz tolt kanapé; az íróasztal a kék falnál
  piece('ac_kg', 'Klíma beltéri egysége a kék falon (IR-ről)', 'up', [[0.04, 1.55, 0.26, 0.9, 2.1, 0.3, C.WHITE]], false);
  piece('kg_sofa', 'IKEA Friheten kinyitható kanapé (barna-narancs), a jobb falnál a szoba végében', 'up', [[1.42, 0.22, 0.66, 2.1, 0, 0.42, C.ORANGE], [2.08, 0.22, 0.24, 2.1, 0, 0.82, C.ORANGE],
    [1.42, 0.2, 0.9, 0.18, 0, 0.62, C.ORANGE], [1.42, 2.14, 0.9, 0.18, 0, 0.62, C.ORANGE], [1.95, 0.5, 0.14, 0.45, 0.42, 0.3, C.CREAM]]);
  piece('kg_desk', 'Sötét íróasztal két monitorral, irodai szék', 'up', [[0.08, 2.65, 0.7, 1.4, 0.72, 0.04, C.DARK], [0.12, 2.7, 0.06, 1.3, 0, 0.72, C.DARK], [0.68, 2.7, 0.06, 1.3, 0, 0.72, C.DARK],
    [0.14, 2.85, 0.06, 0.55, 0.92, 0.36, C.BLACK], [0.14, 3.45, 0.06, 0.5, 0.86, 0.5, C.BLACK], [0.88, 3.1, 0.45, 0.45, 0, 0.5, C.BLACK], [1.27, 3.12, 0.08, 0.42, 0.5, 0.5, C.BLACK]]);
  piece('kg_shelf', 'Könyvespolc a gerendák között', 'up', [[0.08, 0.2, 0.3, 0.8, 0.3, 1.6, C.WALNUT], [0.12, 0.25, 0.25, 0.7, 0.9, 0.3, C.RED], [0.12, 0.25, 0.25, 0.7, 1.4, 0.3, C.NAVY]]);
  piece('kg_radiator', 'Radiátor az ablak alatt, áttört burkolattal', 'up', [[0.55, 0.12, 0.8, 0.16, 0, 0.7, C.WHITE]], false);
  piece('kg_mat', 'Jógamatrac', 'up', [[1.45, 3.55, 0.6, 0.7, 0, 0.03, C.PINKC]]);
  piece('ac_gy', 'Klíma beltéri egysége az ajtó melletti falon (IR-ről)', 'up', [[4.27, 3.3, 0.26, 0.9, 2.1, 0.3, C.WHITE]], false);
  piece('gy_bed', 'Egyszemélyes kárpitozott ágy', 'up', [[3.6, 1.6, 0.9, 2.0, 0, 0.4, C.SAGE], [3.62, 1.62, 0.86, 1.96, 0.4, 0.12, C.LINEN], [3.65, 1.65, 0.8, 0.4, 0.52, 0.12, C.WHITE], [4.42, 1.6, 0.08, 2.0, 0.4, 0.5, C.SAGE]]);
  piece('gy_desk', 'Beépített sötét fa íróasztal az ablak előtt', 'up', [[2.55, 0.1, 1.9, 0.55, 0.72, 0.05, C.WALNUT], [2.55, 0.1, 0.45, 0.55, 0, 0.72, C.WALNUT], [4.0, 0.1, 0.45, 0.55, 0, 0.72, C.WALNUT]], false);
  piece('gy_chair', 'Kis fotel', 'up', [[2.6, 2.6, 0.6, 0.6, 0, 0.38, C.YELLOW], [2.55, 2.6, 0.12, 0.6, 0, 0.75, C.YELLOW]]);
  piece('gy_rug', 'Zöld szőnyeg', 'up', [[2.7, 1.3, 0.8, 1.2, 0, 0.02, C.LEAF2]]);
  piece('gy_rings', 'Tornagyűrűk a gerendáról', 'up', [[3.0, 3.5, 0.04, 0.04, 1.6, 1.3, C.CREAM], [3.4, 3.5, 0.04, 0.04, 1.6, 1.3, C.CREAM], [2.95, 3.45, 0.14, 0.14, 1.45, 0.15, C.WOOD], [3.35, 3.45, 0.14, 0.14, 1.45, 0.15, C.WOOD]]);
  piece('et_chest', 'Fehér fiókos komód (játékok, LEGO)', 'up', [[3.4, 4.75, 1.0, 0.45, 0, 0.85, C.WHITE], [3.55, 4.85, 0.25, 0.25, 0.85, 0.2, C.RED], [3.9, 4.85, 0.25, 0.25, 0.85, 0.15, C.YELLOW]]);
  piece('ub_bath', 'Kád csempézett előfallal', 'up', [[4.62, 5.72, 1.8, 0.75, 0, 0.55, C.WHITE], [4.7, 5.8, 1.64, 0.6, 0.5, 0.06, C.BLUEC]], false);
  piece('ub_sink', 'Mosdószekrény tükörrel, fali WC', 'up', [[5.0, 6.62, 0.6, 0.4, 0, 0.85, C.GREY], [5.05, 6.98, 0.5, 0.04, 1.1, 0.6, C.GLASS], [5.85, 6.7, 0.36, 0.3, 0.25, 0.25, C.WHITE]], false);
  piece('ub_towel', 'Króm törölközőszárító', 'up', [[6.42, 6.55, 0.05, 0.4, 0.3, 1.0, C.STEEL]], false);
  // robotporszívó fent: Roborock S7 a dokkjában, az emeleti előtérben (R2)
  piece('ub_robot', 'Roborock S7 robotporszívó a dokkjában (R2)', 'up', [[4.38, 6.44, 0.1, 0.32, 0, 0.12, C.WHITE],
    { cyl: [4.16, 6.6, 0.17, 0, 0.09], c: C.WHITE }, { cyl: [4.16, 6.6, 0.05, 0.09, 0.03], c: C.ORANGE }]);
  piece('ub_boiler', 'Villanybojler: kerek, álló, a fürdő mennyezete fölötti térben', 'up', [{ cyl: [5.45, 6.32, 0.28, 2.38, 1.0], c: C.WHITE }, { cyl: [5.45, 6.32, 0.29, 2.38, 0.08], c: C.STEEL }], false);

  // ---- eszközök (tűk): pink -> [szint, x, y, z (m)] ----------------------------------------------
  var PINS = {
    T1: ['lo', 3.2, 3.4, 1.2], T8: ['lo', 1.0, 1.9, 1.2], T2: ['lo', 1.2, 7.3, 1.2], T3: ['lo', 1.1, 13.9, 1.2],
    T4: ['lo', 8.6, 9.8, 1.4], T7: ['lo', 2.6, -1.0, 0.9], K1: ['lo', 0.17, 3.2, 2.62], K2: ['lo', 3.45, 11.32, 2.75],
    C2: ['lo', 0.3, 7.25, 1.55], C3: ['lo', 4.05, 2.9, 0.9], C4: ['lo', 1.6, 10.2, 1.4], C5: ['lo', 0.1, 7.95, 2.25],
    C6: ['lo', 3.75, 10.05, 1.9], C7: ['lo', 1.05, 0.5, 1.0], C8: ['lo', 4.0, -0.5, 1.0],
    IR1: ['lo', 0.5, 1.0, 2.2], IR2: ['lo', 4.2, 13.1, 2.2],
    T5: ['up', 1.2, 2.0, 1.2], T6: ['up', 3.3, 2.8, 1.2], K3: ['up', 0.17, 2.0, 2.45], K4: ['up', 4.4, 3.75, 2.45],
    C1: ['up', 5.45, 6.32, 3.5], R1: ['lo', 0.45, 5.76, 0.6], R2: ['up', 4.16, 6.6, 0.6], X1: ['up', 6.3, 6.9, 1.6], M1: ['up', 0.75, 7.25, 0.3],
    IR3: ['up', 0.3, 3.4, 2.2], IR4: ['up', 4.3, 3.0, 2.2]
  };
  // nem okos, de fontos tárgyak jelölése (nem kattintható eszköz, csak felirat)
  var MARKS = [
    { fl: 'lo', x: 5.3, y: 6.1, z: 1.9, t: 'Savio gázkazán', c: '#ffb74d', dx: 46 },
    { fl: 'lo', x: 4.2, y: 6.6, z: 1.3, t: 'Computherm', c: '#ffd65a', dx: -44 }
  ];

  // ---- Pamutka útvonala: pontok szintenként; a lépcsőnél a szintek közt "átugrik" ----------------
  var CAT_ROUTE = [
    ['lo', 2.3, -1.0, 'sit'], ['lo', 2.2, 0.5], ['lo', 1.9, 1.6], ['lo', 0.75, 3.2, 'sleep'], ['lo', 2.0, 4.6], ['lo', 2.7, 6.3],
    ['lo', 2.6, 7.4], ['lo', 0.8, 9.2, 'sit'], ['lo', 2.3, 10.4], ['lo', 3.4, 11.4], ['lo', 2.2, 12.8, 'sleep'], ['lo', 3.4, 11.4],
    ['lo', 3.0, 10.3], ['lo', 2.6, 10.25], ['lo', 0.35, 10.25, 'stairtop'],
    ['up', 0.75, 7.6], ['up', 1.5, 5.6], ['up', 1.7, 4.62], ['up', 1.85, 1.25, 'sleep'], ['up', 1.7, 4.62], ['up', 3.3, 5.3],
    ['up', 3.3, 4.62], ['up', 3.2, 2.2, 'sit'], ['up', 3.3, 4.62], ['up', 2.0, 5.8], ['up', 0.75, 7.6, 'stairtop'],
    ['lo', 0.35, 10.25], ['lo', 2.6, 10.25], ['lo', 4.2, 8.5], ['lo', 5.8, 9.2], ['lo', 7.9, 9.9, 'sit'], ['lo', 5.8, 9.2], ['lo', 4.3, 8.5], ['lo', 2.7, 6.3], ['lo', 2.2, 0.5]
  ];
  // a lenti lépcső magassága egy pontban (Pamutka fokról fokra megy fel rajta): kelet felől emelkedik
  function stairZ(fl, x, y) {
    var s = FLOORS.lo.stairs;
    if (fl !== 'lo' || x < s.x || x > s.x + s.w || y < s.y || y > s.y + s.d) return 0;
    var i = Math.min(s.steps, Math.floor((s.x + s.w - x) / (s.w / s.steps)) + 1);
    return i * (s.rise / s.steps) * 0.55;
  }
  // a szoba középpontja (Pamutka ide sétál, ha ott van gond)
  function roomCenter(id) {
    var out = null;
    ['lo', 'up'].forEach(function (f) { FLOORS[f].rooms.forEach(function (r) { if (r.id === id) out = [f, r.x + r.w / 2, r.y + r.d / 2]; }); });
    return out;
  }

  // Tájolás: a terv "fel" iránya (az erkély felé) és az észak közti szög, óramutató szerint.
  var PLAN_NORTH = 55;
  // az utca: középpont, irány (észak-dél) és a lakás felől kifelé mutató (keleti) egységvektor, méterben
  function streetGeom() {
    var a = PLAN_NORTH * Math.PI / 180;
    var d = [Math.sin(a), -Math.cos(a)];                        // észak a terven
    var e = [Math.sin(a + Math.PI / 2), -Math.cos(a + Math.PI / 2)];   // kelet a terven
    var c = [4.8 + e[0] * 7.6, 7.2 + e[1] * 7.6];
    return { c: c, d: d, e: e, len: 5.2 };
  }

  // az iránytű a talajon (méterben, a lenti szint rendszerében): a lakástól keletre, szabad helyen
  var COMPASS = [10.2, 1.4];

  // ---- vetítés ------------------------------------------------------------------------------------
  function bounds(f) {
    var xs = [], ys = [];
    FLOORS[f].rooms.forEach(function (r) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.d); });
    if (f === 'lo') {                                               // a fák, az utca és az iránytű is férjenek el
      ys.push(-3.2); xs.push(COMPASS[0] + 2.2); ys.push(COMPASS[1] - 2.0, COMPASS[1] + 3.2);
      var g = streetGeom();
      [-1, 1].forEach(function (t) { [-1.6, 0.8].forEach(function (o) { xs.push(g.c[0] + g.d[0] * g.len * t + g.e[0] * o); ys.push(g.c[1] + g.d[1] * g.len * t + g.e[1] * o); }); });
    }
    return { x0: Math.min.apply(0, xs), x1: Math.max.apply(0, xs), y0: Math.min.apply(0, ys), y1: Math.max.apply(0, ys) };
  }
  // Babaház: a felső szint a lépcső fölött áll (a lépcsőnyílása a lenti lépcső fölé esik), és a
  // jobb láthatóságért LIFT méterrel a valódi helye fölé emelve lebeg. Egy közös forgatási középpont
  // (az alsó szinté), így forgatva is egymás fölött maradnak.
  var LIFT = 4.6;
  var OFF = { lo: [0, 0, 0], up: [-2.6, 1.6, 3.0 + LIFT] };
  function Proj(f, k) {
    var b = bounds('lo'), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, o = OFF[f];
    function rot(x, y) { var u = (x + o[0] - cx) * U, v = (y + o[1] - cy) * U, t; for (var i = 0; i < k; i++) { t = u; u = -v; v = t; } return [u, v]; }
    function Q(u, v, z) { return [u - v, (u + v) / 2 - ((z || 0) + o[2]) * U]; }
    function P(x, y, z) { var r = rot(x, y); return Q(r[0], r[1], z); }
    // a képernyő-elmozdulásból (vetített egység) világ-elmozdulás (méter)
    function unproject(dx, dy) {
      var u = dy + dx / 2, v = dy - dx / 2, t;
      for (var i = 0; i < (4 - k) % 4; i++) { t = u; u = -v; v = t; }
      return [u / U, v / U];
    }
    return { k: k, rot: rot, Q: Q, P: P, unproject: unproject, cx: cx, cy: cy };
  }

  function r1(n) { return Math.round(n * 10) / 10; }
  function pts(a) { return a.map(function (p) { return r1(p[0]) + ',' + r1(p[1]); }).join(' '); }

  // tengelyirányú doboz három látható lapja + mélységkulcs
  function box(pj, x0, y0, w, d, z, h, c, bias) {
    var cs = [pj.rot(x0, y0), pj.rot(x0 + w, y0), pj.rot(x0 + w, y0 + d), pj.rot(x0, y0 + d)];
    var us = cs.map(function (q) { return q[0]; }), vs = cs.map(function (q) { return q[1]; });
    var u0 = Math.min.apply(0, us), u1 = Math.max.apply(0, us), v0 = Math.min.apply(0, vs), v1 = Math.max.apply(0, vs), zt = z + h, Q = pj.Q;
    return {
      key: (u0 + u1) / 2 + (v0 + v1) / 2 + (bias || 0) + z * 0.01,
      top: pts([Q(u0, v0, zt), Q(u1, v0, zt), Q(u1, v1, zt), Q(u0, v1, zt)]),
      left: h > 0.001 ? pts([Q(u0, v1, z), Q(u1, v1, z), Q(u1, v1, zt), Q(u0, v1, zt)]) : '',
      right: h > 0.001 ? pts([Q(u1, v0, z), Q(u1, v1, z), Q(u1, v1, zt), Q(u1, v0, zt)]) : '',
      c: c
    };
  }

  // álló henger (pl. a bojler): oldallap + felső ellipszis
  function cyl(pj, cx, cy, r, z, h, c) {
    var rc = pj.rot(cx, cy), T = pj.P(cx, cy, z + h), B = pj.P(cx, cy, z), rx = r * U * Math.SQRT2, ry = rx / 2;
    var side = 'M' + r1(T[0] - rx) + ',' + r1(T[1]) + 'L' + r1(B[0] - rx) + ',' + r1(B[1]) + 'A' + r1(rx) + ',' + r1(ry) + ' 0 0 0 ' + r1(B[0] + rx) + ',' + r1(B[1]) +
      'L' + r1(T[0] + rx) + ',' + r1(T[1]) + 'A' + r1(rx) + ',' + r1(ry) + ' 0 0 1 ' + r1(T[0] - rx) + ',' + r1(T[1]) + 'Z';
    return { key: rc[0] + rc[1] + z * 0.01, cyl: { side: side, tx: r1(T[0]), ty: r1(T[1]), rx: r1(rx), ry: r1(ry) }, c: c };
  }

  // a fal oldala a nézőtől távol esik-e (forgatva)
  function far(side, k) {
    var n = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[side], u = n[0], v = n[1], t;
    for (var i = 0; i < k; i++) { t = u; u = -v; v = t; }
    return u < -0.5 || v < -0.5;
  }

  // ---- padlóminták --------------------------------------------------------------------------------
  function floorPattern(pj, r) {
    var P = pj.P, s = '', x, y, step;
    function seg(a, b) { return 'M' + r1(a[0]) + ',' + r1(a[1]) + 'L' + r1(b[0]) + ',' + r1(b[1]); }
    if (r.f === 'oak') {                       // halszálka: ferde lécek, oszloponként váltva
      var hw = 0.32, pitch = 0.16, col = 0;
      for (x = r.x; x < r.x + r.w - 0.01; x += hw, col++) {
        var xe = Math.min(x + hw, r.x + r.w), dx = xe - x, odd = col % 2;
        s += seg(P(xe, r.y, 0), P(xe, r.y + r.d, 0));
        for (y = r.y - hw + (odd ? pitch / 2 : 0); y < r.y + r.d; y += pitch * 2) {
          var ya = odd ? y + dx : y, yb = odd ? y : y + dx, t0 = 0, t1 = 1;
          if (ya < r.y) t0 = Math.max(t0, (r.y - ya) / (yb - ya)); if (yb < r.y) t1 = Math.min(t1, (r.y - ya) / (yb - ya));
          if (ya > r.y + r.d) t0 = Math.max(t0, (r.y + r.d - ya) / (yb - ya)); if (yb > r.y + r.d) t1 = Math.min(t1, (r.y + r.d - ya) / (yb - ya));
          if (t1 > t0) s += seg(P(x + dx * t0, ya + (yb - ya) * t0, 0), P(x + dx * t1, ya + (yb - ya) * t1, 0));
        }
      }
      return { fill: '#b98a5c', lc: '#8e6640', lines: s };
    }
    if (r.f === 'lam') {
      for (y = r.y + 0.22; y < r.y + r.d; y += 0.22) s += seg(P(r.x, y, 0), P(r.x + r.w, y, 0));
      return { fill: '#e8d2a8', lc: '#c9ad7e', lines: s };
    }
    if (r.f === 'deck') {
      for (x = r.x + 0.14; x < r.x + r.w; x += 0.14) s += seg(P(x, r.y, 0), P(x, r.y + r.d, 0));
      return { fill: '#c98d55', lc: '#8c5c33', lines: s };
    }
    step = 0.3;
    for (y = r.y + step; y < r.y + r.d; y += step) s += seg(P(r.x, y, 0), P(r.x + r.w, y, 0));
    for (x = r.x + step; x < r.x + r.w; x += step) s += seg(P(x, r.y, 0), P(x, r.y + r.d, 0));
    return { fill: '#d7dad6', lc: '#b5bab4', lines: s };
  }

  // ---- falak --------------------------------------------------------------------------------------
  function wallBoxes(pj, F, k) {
    var out = [], H = F.H, T = 0.22, TI = 0.12;
    function spans(a, b, gaps) {
      var r = [[a, b]];
      (gaps || []).forEach(function (g) {
        var n = [];
        r.forEach(function (s) { if (g[1] <= s[0] || g[0] >= s[1]) n.push(s); else { if (g[0] - s[0] > 0.02) n.push([s[0], g[0]]); if (s[1] - g[1] > 0.02) n.push([g[1], s[1]]); } });
        r = n;
      });
      return r;
    }
    function seg(axis, line, a, b, z, h, c, t, bias, alpha) {
      // hosszú falat darabolunk, hogy a mélységrendezés a bútorokkal is jó legyen
      for (var s = a; s < b - 0.001; s += 0.7) {
        var e = Math.min(b, s + 0.7), bx;
        if (axis === 'x') bx = box(pj, s, line - t / 2, e - s, t, z, h, c, bias);
        else bx = box(pj, line - t / 2, s, t, e - s, z, h, c, bias);
        if (alpha) bx.alpha = alpha;
        out.push(bx);
      }
    }
    // befelé (a szoba felé) mutató irány a fal oldalából
    var INWARD = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] };
    F.outer.forEach(function (w) {
      var axis = w[1] === w[3] ? 'x' : 'y', line = axis === 'x' ? w[1] : w[0];
      var a = axis === 'x' ? Math.min(w[0], w[2]) : Math.min(w[1], w[3]), b = axis === 'x' ? Math.max(w[0], w[2]) : Math.max(w[1], w[3]);
      var isFar = far(w[4], k), side = w[4], low = w[6] && w[6].low;
      var off = (side === 'N' || side === 'W') ? -T / 2 : T / 2;     // a fal a szoba külső oldalán áll
      var col = F === FLOORS.up ? (side === 'W' ? C.WALLB : C.WALLW) : (side === 'E' && w[1] < 6 ? C.WALLS : C.WALL);
      var h = isFar ? (low || H) : 0.4, L = line + off;
      spans(a, b, (w[5] || []).map(function (g) { return [g[0], g[1]]; })).forEach(function (sp) { seg(axis, L, sp[0], sp[1], 0, h, isFar && !low ? col : C.LOW, T); });
      (w[5] || []).forEach(function (g) {
        var kind = g[2], sill = g[3] != null ? g[3] : (kind === 'w' ? 0.9 : 0), top = g[4] != null ? g[4] : (kind === 'w' ? 2.4 : kind === 'g' ? 2.5 : 2.15);
        var solid = isFar && !low, frame = C.WHITE;
        if (sill > 0) seg(axis, L, g[0], g[1], 0, Math.min(sill, h), solid ? col : C.LOW, T);
        if (solid && top < H) seg(axis, L, g[0], g[1], top, H - top, col, T);
        if (kind === 'w' || kind === 'g') {
          // üveg: távoli falon telt, közeli/alacsony falon áttetsző, hogy belássunk
          seg(axis, L, g[0], g[1], sill, top - sill, C.GLASS, 0.04, 0.05, solid ? 0 : 0.42);
        }
        if (!solid) {
          // keret: két oldaltok és a szemöldök, hogy a közeli falon is látsszon az ablak / ajtó
          seg(axis, L, g[0], g[0] + 0.07, sill, top - sill, frame, 0.1, 0.06, 0.92);
          seg(axis, L, g[1] - 0.07, g[1], sill, top - sill, frame, 0.1, 0.06, 0.92);
          seg(axis, L, g[0], g[1], top, 0.08, frame, 0.1, 0.06, 0.92);
          if (kind === 'w') seg(axis, L, (g[0] + g[1]) / 2 - 0.03, (g[0] + g[1]) / 2 + 0.03, sill, top - sill, frame, 0.06, 0.07, 0.92);
        }
        if (kind === 'd' && g[5] === 'double') {
          // kétszárnyú, befelé nyíló régi ajtó (nyitva), fölötte felülvilágító
          var inw = INWARD[side], half = (g[1] - g[0]) / 2, D = 0.05;
          [[g[0], 1], [g[1], -1]].forEach(function (q) {
            var x0, y0, ww, dd;
            if (axis === 'x') { x0 = q[1] > 0 ? q[0] : q[0] - D; y0 = inw[1] > 0 ? L : L - half; ww = D; dd = half; }
            else { y0 = q[1] > 0 ? q[0] : q[0] - D; x0 = inw[0] > 0 ? L : L - half; ww = half; dd = D; }
            var bx = box(pj, x0, y0, ww, dd, 0, top - 0.02, C.WHITE, 0.1); out.push(bx);
          });
          seg(axis, L, g[0], g[1], top + 0.08, 0.5, C.GLASS, 0.04, 0.05, solid ? 0 : 0.5);
        }
      });
    });
    F.inner.forEach(function (w) {
      var axis = w[1] === w[3] ? 'x' : 'y', line = axis === 'x' ? w[1] : w[0];
      var a = axis === 'x' ? w[0] : w[1], b = axis === 'x' ? w[2] : w[3];
      spans(a, b, w[4]).forEach(function (s) { seg(axis, line, s[0], s[1], 0, 0.75, C.INNER, TI); });
    });
    return out;
  }

  // ---- lépcső ---------------------------------------------------------------------------------------
  function stairBoxes(pj, s) {
    var out = [], n = s.steps, run = s.w / n;
    for (var i = 0; i < n; i++) {
      // a lépcső kelet felől indul (az étkező felől), nyugat felé emelkedik a fal mentén
      var x = s.x + s.w - (i + 1) * run;
      out.push(box(pj, x, s.y, run, s.d, 0, (i + 1) * (s.rise / n) * 0.55, i % 2 ? C.WHITE : C.CREAM));
    }
    out.push(box(pj, s.x, s.y + s.d - 0.05, s.w, 0.05, 0, 1.0, C.WHITE, 0.2));   // korlát
    return out;
  }

  // ---- az egész jelenet egy forgatásra ---------------------------------------------------------------
  function build(k, offs) {
    offs = offs || {};
    var res = { floors: {} };
    ['lo', 'up'].forEach(function (f) {
      var F = FLOORS[f], pj = Proj(f, k), P = pj.P, b = bounds(f);
      var floorPolys = F.rooms.map(function (r) {
        var pat = floorPattern(pj, r);
        return { id: r.id, n: r.n, p: pts([P(r.x, r.y, 0), P(r.x + r.w, r.y, 0), P(r.x + r.w, r.y + r.d, 0), P(r.x, r.y + r.d, 0)]),
          fill: pat.fill, lc: pat.lc, lines: pat.lines, label: P(r.x + r.w / 2, r.y + r.d / 2, 0), open: !!r.open };
      });
      // födém (vastag lemez a szint alatt), szobánként, hogy az L-alak is jó legyen
      var slab = F.rooms.map(function (r) { return box(pj, r.x - 0.12, r.y - 0.12, r.w + 0.24, r.d + 0.24, -0.45, 0.45, r.open ? C.DECK : C.SLAB); });
      var items = wallBoxes(pj, F, k).map(function (bx) { return { kind: 'wall', key: bx.key, boxes: [bx] }; });
      if (F.stairs) stairBoxes(pj, F.stairs).forEach(function (bx) { items.push({ kind: 'wall', key: bx.key, boxes: [bx] }); });
      if (F.hole) {
        var hl = F.hole;
        items.push({ kind: 'wall', key: 0, boxes: [box(pj, hl.x, hl.y, hl.w, hl.d, -0.02, 0.03, C.DARK, -999)] });
        items.push({ kind: 'wall', key: 0, boxes: [box(pj, hl.x + hl.w, hl.y, 0.05, hl.d, 0, 0.95, C.WHITE)] });
      }
      if (F.beams) {
        // látszó sötét gerendák (fogópár) a tetőtérben
        [[0, 1.4], [0, 3.2], [2.45, 1.4], [2.45, 3.2]].forEach(function (g) {
          var w = g[0] === 0 ? 2.33 : 2.1;
          items.push({ kind: 'wall', key: 0, boxes: [box(pj, g[0], g[1], w, 0.14, 2.55, 0.16, C.BEAM, 2)] });
        });
        items.forEach(function (it) { it.key = it.boxes[0].key; });
      }
      if (f === 'lo') {
        var bc = F.balcony, rail = [];
        // áttört díszes mellvéd: korlátpálcák, felső korlát, rajta a LED-füzér (C8)
        for (var bxp = bc.x; bxp <= bc.x + bc.w + 0.01; bxp += 0.17) rail.push(box(pj, bxp - 0.02, bc.y - 0.04, 0.04, 0.04, 0, 0.95, C.BLACK, 1));
        for (var byp = bc.y + 0.17; byp < bc.y + bc.d; byp += 0.17) { rail.push(box(pj, bc.x - 0.06, byp - 0.02, 0.04, 0.04, 0, 0.95, C.BLACK, 1)); rail.push(box(pj, bc.x + bc.w + 0.02, byp - 0.02, 0.04, 0.04, 0, 0.95, C.BLACK, 1)); }
        rail.push(box(pj, bc.x - 0.06, bc.y - 0.06, bc.w + 0.12, 0.07, 0.95, 0.06, C.BLACK, 1.2));
        rail.push(box(pj, bc.x - 0.07, bc.y - 0.06, 0.07, bc.d + 0.06, 0.95, 0.06, C.BLACK, 1.2));
        rail.push(box(pj, bc.x + bc.w, bc.y - 0.06, 0.07, bc.d + 0.06, 0.95, 0.06, C.BLACK, 1.2));
        rail.push(box(pj, bc.x, bc.y - 0.05, bc.w, 0.05, 0.42, 0.05, C.BLACK, 1.1));
        for (var lx = bc.x + 0.1; lx < bc.x + bc.w; lx += 0.3) rail.push(box(pj, lx, bc.y - 0.05, 0.07, 0.07, 1.02, 0.07, C.LAMP, 1.3));
        rail.forEach(function (bx) { items.push({ kind: 'wall', key: bx.key, boxes: [bx] }); });
        items.forEach(function (it) { it.key = it.boxes[0].key; });
      }
      PIECES.forEach(function (p) {
        if (p.fl !== f) return;
        var o = offs[p.id] || [0, 0];
        var bxs = p.boxes.map(function (q) { return Array.isArray(q) ? box(pj, q[0] + o[0], q[1] + o[1], q[2], q[3], q[4], q[5], q[6]) : cyl(pj, q.cyl[0] + o[0], q.cyl[1] + o[1], q.cyl[2], q.cyl[3], q.cyl[4], q.c); });
        var key = bxs.reduce(function (m, q) { return Math.max(m, q.key); }, -1e9);
        // a doboz-csoporton belül a kirajzolás a saját mélység szerint
        bxs.sort(function (a, c) { return a.key - c.key; });
        items.push({ kind: 'piece', id: p.id, name: p.name, drag: p.drag, key: key, boxes: bxs });
      });
      items.sort(function (a, c) { return a.key - c.key; });
      var pins = [];
      Object.keys(PINS).forEach(function (id) { var q = PINS[id]; if (q[0] === f) pins.push({ id: id, p: P(q[1], q[2], q[3]), base: P(q[1], q[2], 0) }); });
      var marks = MARKS.filter(function (m) { return m.fl === f; }).map(function (m) { var q = P(m.x, m.y, m.z); return { t: m.t, c: m.c, p: [q[0] + (m.dx || 0), q[1]], a: q }; });
      // babaház-vezetők: a felső szint sarkaiból szaggatott függőleges vonal le a valódi helyére (3 m)
      var guides = [];
      if (f === 'up') {
        var lp = Proj('lo', k);
        [[0, 0], [4.55, 0], [6.5, 7.05], [0, 10.5], [2.25, 10.5], [6.5, 5.65]].forEach(function (q) {
          var a = P(q[0], q[1], -0.45), c = lp.P(q[0] + OFF.up[0], q[1] + OFF.up[1], 3.0);
          guides.push('M' + r1(a[0]) + ',' + r1(a[1]) + 'L' + r1(c[0]) + ',' + r1(c[1]));
        });
        var hc = P(F.hole.x + F.hole.w / 2, F.hole.y + F.hole.d / 2, -0.45), lc = lp.P(F.hole.x + F.hole.w / 2 + OFF.up[0], F.hole.y + F.hole.d / 2 + OFF.up[1], 1.6);
        guides.stair = 'M' + r1(hc[0]) + ',' + r1(hc[1]) + 'L' + r1(lc[0]) + ',' + r1(lc[1]);
        guides.mid = [(hc[0] + lc[0]) / 2, (hc[1] + lc[1]) / 2];
      }
      // Környezet (csak lent). Az erkély felől (a Gellért-hegy felé) nincs látható utca, csak fák.
      // Az egyetlen utca a lakástól keletre fut, nagyjából észak-déli irányban (a tulaj térképe szerint);
      // a babaházon a konyha és a bejárat felőli oldalon. A neve csak belépve látszik (site_info).
      var street = null;
      if (f === 'lo') {
        var S0 = streetGeom();
        var at = function (t, o) { return P(S0.c[0] + S0.d[0] * t + S0.e[0] * o, S0.c[1] + S0.d[1] * t + S0.e[1] * o, 0); };
        var la = at(-S0.len, 0), lb = at(S0.len, 0), ang = Math.atan2(lb[1] - la[1], lb[0] - la[0]) * 180 / Math.PI;
        if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
        street = {
          road: pts([at(-S0.len, -0.8), at(S0.len, -0.8), at(S0.len, 0.8), at(-S0.len, 0.8)]),
          walk: pts([at(-S0.len, -1.6), at(S0.len, -1.6), at(S0.len, -0.8), at(-S0.len, -0.8)]),
          line: 'M' + r1(la[0]) + ',' + r1(la[1]) + 'L' + r1(lb[0]) + ',' + r1(lb[1]),
          lamps: [],
          trees: [-0.1, 1.6, 3.3, 5.0].map(function (x) { return P(x, -2.6, 0); }),
          label: at(S0.len * 0.45, 0), ang: ang
        };
      }
      // a képernyő-befoglaló (a padló és a falak teteje)
      var xs = [], ys = [];
      [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].forEach(function (q) { var a = P(q[0], q[1], -0.5), c = P(q[0], q[1], F.H); xs.push(a[0], c[0]); ys.push(a[1], c[1]); });
      res.floors[f] = { name: F.name, floors: floorPolys, slab: slab, items: items, pins: pins, marks: marks, street: street, guides: guides,
        bbox: { x0: Math.min.apply(0, xs), x1: Math.max.apply(0, xs), y0: Math.min.apply(0, ys), y1: Math.max.apply(0, ys) }, proj: pj };
    });
    return res;
  }

  root.O2BScene = {
    U: U, INK: INK, FLOORS: FLOORS, PIECES: PIECES, PINS: PINS, CAT_ROUTE: CAT_ROUTE,
    build: build, Proj: Proj, COMPASS: COMPASS, stairZ: stairZ, OFF: OFF, LIFT: LIFT, PLAN_NORTH: PLAN_NORTH, roomCenter: roomCenter, far: far
  };
})(typeof window !== 'undefined' ? window : this);
