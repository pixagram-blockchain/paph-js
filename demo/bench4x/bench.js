(function () {
'use strict';
/* PAPH 4.1 evidence bench — application layer.
   The engines below this line are the shipped files, inlined so the bench stays
   one file you can hand to anyone: paph3 (the v3 wire), paph4 (comparator 4 and
   41), calCore (the calibration loop).  Nothing here re-implements them. */
var P = window.paph3, V = window.paph4, CC = window.calCore;
var $ = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
var SCALE = 10000;
var CHAN_ORDER = ['dct', 'local', 'shape', 'topology', 'runs', 'palette', 'silhouette'];
var WEIGHT_ORDER = ['local', 'shape', 'topology', 'runs', 'dct', 'palette', 'silhouette'];
var CHAN_NOTE = {
  local: 'keypoint fingerprints through an optimal assignment',
  dct: 'coarse frequency agreement',
  shape: 'form, independent of the silhouette',
  topology: 'region adjacency',
  runs: 'run-length texture',
  palette: 'colour vocabulary',
  silhouette: 'the outer boundary'
};
var LUT_SLOTS = [
  ['lutLocal', 'local'], ['lutGeometry', 'geometry'], ['lutDiversity', 'diversity'],
  ['lutDct', 'dct'], ['lutShape', 'shape'], ['lutTopology', 'topology'],
  ['lutRuns', 'runs'], ['lutPalette', 'palette'], ['lutSilhouette', 'silhouette']
];
var THRESH_NAMES = ['STRUCT_IDENTICAL', 'STRUCT_STRONG', 'STRUCT_MODERATE', 'STRUCT_WEAK',
                    'STRUCT_SOLO', 'GEO_STRONG', 'GEO_WEAK', 'GEO_SOLO_INLIERS', 'DOMINANT_AT'];

var profile = V.cal003();          /* the shipped comparator-41 calibration */
var slots = { A: null, B: null };
var last = null, lastV4 = null, lastScreen = null, attackRows = null;

var CS = getComputedStyle(document.documentElement);
function tok(n, fb) { var v = CS.getPropertyValue(n).trim(); return v || fb; }
function dpr() { return Math.min(2, window.devicePixelRatio || 1); }
function fit(cv, h) {
  var w = cv.parentNode.clientWidth || 600, d = dpr();
  cv.width = Math.round(w * d); cv.height = Math.round(h * d);
  cv.style.width = '100%'; cv.style.height = h + 'px';
  var g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g: g, w: w, h: h };
}
function rainbowGrad(g, x0, y0, x1, y1) {
  var gr = g.createLinearGradient(x0, y0, x1, y1);
  for (var i = 0; i <= 6; i++) gr.addColorStop(i / 6, 'hsl(' + (i * 60) + ' 85% 62%)');
  return gr;
}
function esc(s) { return String(s).replace(/[&<>]/g, function (c) {
  return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; }); }
function stat(k, v, n, muted) {
  return '<div class="stat' + (muted ? ' muted' : '') + '"><div class="k">' + esc(k) +
         '</div><div class="v sm">' + esc(v) + '</div>' +
         (n ? '<div class="n">' + esc(n) + '</div>' : '') + '</div>';
}
function kv(k, v) {
  return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>';
}
function pct(v) { return (v / 100).toFixed(1) + '%'; }
/* ================================================================ *
 * Sample works.  Ordered dither and coherent regions, because that
 * is what pixel art actually is — per-pixel noise gives FAST-9 a
 * feast and tells you nothing about real content.
 * ================================================================ */
function lcg(s) { return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function blank(w, h) { return new ImageData(w, h); }
function px(d, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
  var o = (y * d.width + x) << 2;
  d.data[o] = r; d.data[o + 1] = g; d.data[o + 2] = b; d.data[o + 3] = a === undefined ? 255 : a;
}
function pxg(d, x, y) {
  x = Math.min(d.width - 1, Math.max(0, x)); y = Math.min(d.height - 1, Math.max(0, y));
  var o = (y * d.width + x) << 2;
  return [d.data[o], d.data[o + 1], d.data[o + 2], d.data[o + 3]];
}
function ramp(R, n) { var p = []; for (var i = 0; i < n; i++)
  p.push([28 + (R() * 205) | 0, 22 + (R() * 210) | 0, 44 + (R() * 196) | 0]); return p; }
var BAYER = [0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5];
function dith(x, y, t) { return BAYER[((y & 3) << 2) | (x & 3)] < t; }
function shade(d, x, y, a, b, t) { var c = dith(x, y, t) ? a : b; px(d, x, y, c[0], c[1], c[2], 255); }

var SAMPLES = {
  sprite: function () {
    var R = lcg(4711), w = 128, h = 128, d = blank(w, h), Pl = ramp(R, 6), x, y;
    var ink = [14, 12, 26], lit = [246, 240, 226];
    function body(x, y) {
      var cx = (x - w / 2) / (w * .34), cy = (y - h * .54) / (h * .40);
      var head = ((x - w / 2) / (w * .20)) * ((x - w / 2) / (w * .20)) +
                 ((y - h * .26) / (h * .20)) * ((y - h * .26) / (h * .20));
      return cx * cx + cy * cy < 1 || head < 1;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (!body(x, y)) { px(d, x, y, 0, 0, 0, 0); continue; }
      if (!body(x - 1, y) || !body(x + 1, y) || !body(x, y - 1) || !body(x, y + 1)) {
        px(d, x, y, ink[0], ink[1], ink[2], 255); continue; }
      var t = Math.max(0, Math.min(15, 15 - ((y * 13 / h) | 0) + (((x - w / 2) > 0) ? -3 : 3)));
      shade(d, x, y, Pl[1], Pl[2], t);
    }
    function slab(x0, y0, ww, hh, a, b, t) {
      for (var yy = 0; yy < hh; yy++) for (var xx = 0; xx < ww; xx++) {
        if (pxg(d, x0 + xx, y0 + yy)[3] === 0) continue;
        if (xx === 0 || yy === 0 || xx === ww - 1 || yy === hh - 1)
          px(d, x0 + xx, y0 + yy, ink[0], ink[1], ink[2], 255);
        else shade(d, x0 + xx, y0 + yy, a, b, t);
      }
    }
    slab((w * .30) | 0, (h * .20) | 0, 10, 8, lit, Pl[0], 11);
    slab((w * .58) | 0, (h * .20) | 0, 10, 8, lit, Pl[0], 11);
    slab((w * .24) | 0, (h * .58) | 0, (w * .52) | 0, 11, Pl[4], Pl[3], 7);
    slab((w * .30) | 0, (h * .72) | 0, 14, 14, Pl[5], Pl[3], 9);
    slab((w * .56) | 0, (h * .72) | 0, 14, 14, Pl[5], Pl[3], 4);
    for (var i = 0; i < 9; i++) slab(((w * .22) | 0) + i * 8, (h * .44) | 0, 5, 5, Pl[0], Pl[2], 6);
    return d;
  },
  scene: function (w, h) {
    var R = lcg(9137); w = w || 288; h = h || 200;
    var d = blank(w, h), Pl = ramp(R, 8), ink = [12, 14, 22], x, y;
    var horizon = (h * .58) | 0;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (y < horizon) shade(d, x, y, Pl[0], Pl[1], Math.max(0, Math.min(15, 15 - ((y * 15 / horizon) | 0))));
      else shade(d, x, y, Pl[2], Pl[3], Math.max(0, Math.min(15, ((y - horizon) * 15 / (h - horizon)) | 0)));
    }
    var nb = Math.max(9, Math.round(w * h / 2600));
    for (var i = 0; i < nb; i++) {
      var bw = 12 + ((R() * 26) | 0), bh = 16 + ((R() * 44) | 0);
      var bx = (R() * (w - bw - 2)) | 0, by = horizon - bh + ((R() * 14) | 0);
      var a = Pl[4 + ((R() * 4) | 0)], b = Pl[(R() * 4) | 0];
      for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) {
        var X = bx + x, Y = by + y; if (Y < 0 || Y >= h) continue;
        if (x === 0 || y === 0 || x === bw - 1 || y === bh - 1) px(d, X, Y, ink[0], ink[1], ink[2], 255);
        else if ((x % 5 === 2) && (y % 6 === 3)) px(d, X, Y, 250, 224, 150, 255);
        else shade(d, X, Y, a, b, 6 + (x % 3) * 3);
      }
    }
    return d;
  },
  banner: function () {
    var R = lcg(2029), w = 320, h = 128, d = blank(w, h), Pl = ramp(R, 7), ink = [10, 16, 20], x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++)
      shade(d, x, y, Pl[0], Pl[1], Math.max(0, Math.min(15, 3 + ((x * 12 / w) | 0))));
    for (x = 0; x < w; x++) {
      px(d, x, 0, ink[0], ink[1], ink[2], 255); px(d, x, h - 1, ink[0], ink[1], ink[2], 255);
      px(d, x, 3, Pl[5][0], Pl[5][1], Pl[5][2], 255); px(d, x, h - 4, Pl[5][0], Pl[5][1], Pl[5][2], 255);
    }
    var glyph = [0x1F, 0x11, 0x1F, 0x04, 0x1F, 0x15, 0x0E];
    for (var gi = 0; gi < 9; gi++) {
      var gx = 18 + gi * 33, gy = 40, a = Pl[3 + (gi % 4)], b = Pl[2];
      for (y = 0; y < 7; y++) for (x = 0; x < 5; x++) {
        if (!((glyph[(y + gi) % 7] >> (4 - x)) & 1)) continue;
        for (var sy = 0; sy < 6; sy++) for (var sx = 0; sx < 6; sx++)
          shade(d, gx + x * 6 + sx, gy + y * 6 + sy, a, b, 5 + ((x + y) % 3) * 4);
      }
    }
    return d;
  },
  tile: function () {
    var R = lcg(6151), w = 192, h = 192, d = blank(w, h), Pl = ramp(R, 6), ink = [16, 12, 20], x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var u = x % 32, v = y % 32;
      var onDiag = Math.abs(u - v) < 4 || Math.abs(u + v - 31) < 4;
      var ring = (u > 7 && u < 24 && v > 7 && v < 24);
      if (u === 0 || v === 0) { px(d, x, y, ink[0], ink[1], ink[2], 255); continue; }
      if (ring && onDiag) shade(d, x, y, Pl[4], Pl[5], 9);
      else if (ring) shade(d, x, y, Pl[2], Pl[3], 6);
      else shade(d, x, y, Pl[0], Pl[1], 4 + ((u + v) % 3) * 3);
    }
    return d;
  }
};

/* ---------------- transforms ---------------- */
function nearest(a, w, h) { var d = blank(w, h);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var p = pxg(a, (x * a.width / w) | 0, (y * a.height / h) | 0); px(d, x, y, p[0], p[1], p[2], p[3]); }
  return d; }
function area(a, w, h) { var d = blank(w, h);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var x0 = Math.floor(x * a.width / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * a.width / w));
    var y0 = Math.floor(y * a.height / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * a.height / h));
    var r = 0, g = 0, b = 0, al = 0, n = 0;
    for (var sy = y0; sy < y1 && sy < a.height; sy++) for (var sx = x0; sx < x1 && sx < a.width; sx++) {
      var p = pxg(a, sx, sy); r += p[0]; g += p[1]; b += p[2]; al += p[3]; n++; }
    px(d, x, y, (r / n) | 0, (g / n) | 0, (b / n) | 0, (al / n) > 127 ? 255 : 0); }
  return d; }
function cut(a, x0, y0, w, h) { var d = blank(w, h);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var p = pxg(a, x0 + x, y0 + y); px(d, x, y, p[0], p[1], p[2], p[3]); }
  return d; }
function pasteInto(a) {
  /* The guest goes in at 1:1 and the HOST grows to hold it.  Shrinking the
     guest to fit would stack two attacks and test something else. */
  var host = SAMPLES.scene(Math.max(288, Math.round(a.width * 2.1)), Math.max(200, Math.round(a.height * 1.9)));
  var d = blank(host.width, host.height); d.data.set(host.data);
  var ox = ((host.width - a.width) * 0.42) | 0, oy = ((host.height - a.height) * 0.46) | 0;
  for (var y = 0; y < a.height; y++) for (var x = 0; x < a.width; x++) {
    var p = pxg(a, x, y); if (p[3] < 128) continue; px(d, ox + x, oy + y, p[0], p[1], p[2], 255); }
  return d;
}
var XF = {
  mirror: { label: 'Mirrored', fn: function (a) { var d = blank(a.width, a.height);
    for (var y = 0; y < a.height; y++) for (var x = 0; x < a.width; x++) {
      var p = pxg(a, a.width - 1 - x, y); px(d, x, y, p[0], p[1], p[2], p[3]); } return d; } },
  rot90: { label: 'Rotated 90°', fn: function (a) { var d = blank(a.height, a.width);
    for (var y = 0; y < a.height; y++) for (var x = 0; x < a.width; x++) {
      var p = pxg(a, x, y); px(d, a.height - 1 - y, x, p[0], p[1], p[2], p[3]); } return d; } },
  rot180: { label: 'Rotated 180°', fn: function (a) { var d = blank(a.width, a.height);
    for (var y = 0; y < a.height; y++) for (var x = 0; x < a.width; x++) {
      var p = pxg(a, a.width - 1 - x, a.height - 1 - y); px(d, x, y, p[0], p[1], p[2], p[3]); } return d; } },
  invert: { label: 'Colour inverted', fn: function (a) { var d = blank(a.width, a.height); d.data.set(a.data);
    for (var i = 0; i < a.width * a.height; i++) { var o = i << 2;
      d.data[o] = 255 - d.data[o]; d.data[o + 1] = 255 - d.data[o + 1]; d.data[o + 2] = 255 - d.data[o + 2]; }
    return d; } },
  recolour: { label: 'Recoloured', fn: function (a) { var d = blank(a.width, a.height); d.data.set(a.data);
    for (var i = 0; i < a.width * a.height; i++) { var o = i << 2;
      var L = (77 * d.data[o] + 150 * d.data[o + 1] + 29 * d.data[o + 2] + 128) >> 8;
      d.data[o] = Math.min(255, 26 + ((L * 184) >> 8));
      d.data[o + 1] = Math.min(255, 8 + ((L * 126) >> 8));
      d.data[o + 2] = Math.min(255, 66 + ((L * 152) >> 8)); }
    return d; } },
  rebuild: { label: 'Palette rebuilt', fn: function (a) { var d = blank(a.width, a.height); d.data.set(a.data);
    var seen = new Map(), i, o;
    for (i = 0; i < a.width * a.height; i++) { o = i << 2;
      var k = (d.data[o] << 16) | (d.data[o + 1] << 8) | d.data[o + 2];
      if (!seen.has(k)) seen.set(k, (77 * d.data[o] + 150 * d.data[o + 1] + 29 * d.data[o + 2] + 128) >> 8); }
    var order = Array.from(seen.entries()).sort(function (p, q) { return p[1] - q[1]; }), map = new Map();
    order.forEach(function (e, i2) { var t = Math.round(255 * i2 / Math.max(1, order.length - 1));
      map.set(e[0], [Math.min(255, 14 + ((t * 192) >> 8)), Math.min(255, 4 + ((t * 232) >> 8)),
                     Math.min(255, 42 + ((t * 172) >> 8))]); });
    for (i = 0; i < a.width * a.height; i++) { o = i << 2;
      var c = map.get((d.data[o] << 16) | (d.data[o + 1] << 8) | d.data[o + 2]);
      d.data[o] = c[0]; d.data[o + 1] = c[1]; d.data[o + 2] = c[2]; }
    return d; } },
  up4: { label: '4× nearest upscale', fn: function (a) { return nearest(a, a.width * 4, a.height * 4); } },
  rescale: { label: 'Rescaled 1.7×', fn: function (a) {
    return area(a, Math.round(a.width * 1.7), Math.round(a.height * 1.7)); } },
  crop: { label: 'Cropped 70%', fn: function (a) {
    var w = Math.round(a.width * .7), h = Math.round(a.height * .7);
    return cut(a, ((a.width - w) / 2) | 0, ((a.height - h) / 2) | 0, w, h); } },
  paste: { label: 'Pasted into a scene', fn: pasteInto },
  pastecrop: { label: 'Pasted, then cropped', fn: function (a) { var s = pasteInto(a);
    return cut(s, (s.width * .12) | 0, (s.height * .1) | 0, (s.width * .8) | 0, (s.height * .8) | 0); } }
};

/* ================================================================ *
 * plates + hashing
 * ================================================================ */
function toWire(img) {
  return { px: new Uint8Array(img.data.buffer.slice(0)), w: img.width, h: img.height };
}
function toCanvas(img, maxW, maxH) {
  var c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  var z = Math.max(1, Math.min(Math.floor(maxW / img.width), Math.floor(maxH / img.height)));
  if (z > 1) {
    var o = document.createElement('canvas');
    o.width = img.width * z; o.height = img.height * z;
    var g = o.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(c, 0, 0, o.width, o.height);
    return o;
  }
  return c;
}
function setSlot(slot, img, name) {
  var t0 = performance.now(), wire = toWire(img), fp;
  try { fp = V.hashChecked(wire, {}, profile.limits); }
  catch (e) { alert('That work did not hash: ' + e.message); return; }
  var kp = 0;
  try { kp = P.parseT2(fp.t2).list.length; } catch (e) {}
  slots[slot] = { img: img, wire: wire, hash: fp, kp: kp, name: name || slot,
                  ms: +(performance.now() - t0).toFixed(1) };
  showPlate(slot);
  attackRows = null;
}
function showPlate(slot) {
  var s = slots[slot], body = $('#body' + slot);
  body.innerHTML = '';
  if (!s) { body.innerHTML = '<div class="plate-hint">Drop a work here</div>'; return; }
  body.appendChild(toCanvas(s.img, 420, 240));
  $('#dim' + slot).textContent = s.img.width + '×' + s.img.height;
  $('#ft' + slot).innerHTML = '<span><b>' + esc(s.name) + '</b></span>' +
    '<span>tier 1 ' + P.T1_BYTES + ' B</span>' +
    '<span>tier 2 ' + s.hash.t2.length + ' B</span>' +
    '<span>' + s.kp + ' keypoints</span>' +
    '<span>' + s.ms + ' ms</span>';
}
function fromFile(file, slot) {
  var rd = new FileReader();
  rd.onload = function () {
    var im = new Image();
    im.onload = function () {
      var c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      var g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingEnabled = false; g.drawImage(im, 0, 0);
      setSlot(slot, g.getImageData(0, 0, c.width, c.height), file.name.replace(/\.[a-z0-9]+$/i, ''));
      run();
    };
    im.src = rd.result;
  };
  rd.readAsDataURL(file);
}

/* ================================================================ *
 * 02 — the stage-1 screen
 * ================================================================ */
function paintScreen() {
  var A = slots.A, B2 = slots.B;
  if (!A || !B2) return;
  var t0 = performance.now();
  var s = V.screenV41(A.hash.t1, A.hash.t2, B2.hash.t1, B2.hash.t2, {}, profile);
  var ms = performance.now() - t0;
  lastScreen = s;
  $('#screenStats').innerHTML = [
    stat('Screen', s.pass ? 'PASS' : 'UNSCREENED',
         s.pass ? 'the full comparator may run' : 'not a verdict — never “unrelated”', !s.pass),
    stat('Direct pool', String(s.poolDirect), 'correspondences, no verification'),
    stat('Mirror pool', String(s.poolMirror), 'the free hypothesis'),
    stat('Screen cost', ms.toFixed(2) + ' ms', 'floor is geo_min_corr ' + profile.geoMinCorr)
  ].join('');
}

/* ================================================================ *
 * 03 — the verdict lattice
 * ================================================================ */
var LAT = [
  ['geometry certifies', 'weak + geometric', 'structure + geometry'],
  ['no coherent model', 'partial agreement', 'structure carries it'],
  ['unrelated', 'related — same family', 'structure only, capped']
];
function buildLattice() {
  var g = $('#latGrid');
  g.innerHTML = '';
  var rows = [
    ['geometric ≥ strong', ['R3 caps a scattered model', 'certifies with corroboration', 'Copy — both axes agree']],
    ['geometric ≥ weak', ['review', 'review', 'Copy — structure over the solo bar']],
    ['geometric silent', ['unrelated', 'related', 'capped at Suspected']]
  ];
  var cols = ['structural < moderate', 'structural ≥ moderate', 'structural ≥ strong'];
  for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
    var cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.r = r; cell.dataset.c = c;
    cell.innerHTML = '<span class="cl">' + esc(r === 0 ? 'geometry strong' : r === 1 ? 'geometry weak' : 'geometry silent') +
      '</span><span class="cv">' + esc(cols[c].replace('structural ', '')) + '</span>' +
      '<span class="cs">' + esc(rows[r][1][c]) + '</span>';
    g.appendChild(cell);
  }
  var dot = document.createElement('span');
  dot.className = 'dot'; dot.id = 'latDot';
  dot.style.left = '0%'; dot.style.bottom = '0%';
  g.parentNode.appendChild(dot);
}
function paintLattice(r) {
  var t = profile.thresholds;
  var sx = Math.max(0, Math.min(SCALE, r.structural)) / SCALE;
  var gy = Math.max(0, Math.min(SCALE, r.geometryEvidence)) / SCALE;
  var dot = $('#latDot');
  if (dot) { dot.style.left = (6 + sx * 88) + '%'; dot.style.bottom = (6 + gy * 84) + '%'; }
  var col = r.structural >= t[1] ? 2 : r.structural >= t[2] ? 1 : 0;
  var row = r.geometryEvidence >= t[5] ? 0 : r.geometryEvidence >= t[6] ? 1 : 2;
  $$('#latGrid .cell').forEach(function (c) {
    c.classList.toggle('on', +c.dataset.r === row && +c.dataset.c === col);
  });
  $('#latNote').textContent = 'thresholds: structural ' + t[2] + ' / ' + t[1] +
    ' · geometric ' + t[6] + ' / ' + t[5] + ' · geo-solo floor ' + t[7] + ' inliers';
}
function paintReadout(r, r4) {
  var pills = r.basis.map(function (b) {
    return '<span class="pill' + (b.indexOf('R') === 0 ? '' : ' on') + '">' + esc(b) + '</span>';
  }).join('');
  if (r.geoWeakInliers > 0) pills += '<span class="pill">weak signal ' + r.geoWeakInliers + '</span>';
  $('#readout').innerHTML =
    '<p class="px-eyebrow">Comparator 41 · ' + esc(r.calibration) + '</p>' +
    '<div class="verdict-big' + (r.verdict === 'Copy' || r.verdict === 'Identical' ? ' px-rainbow-text' : ' grey') + '">' +
      esc(r.verdict) + '</div>' +
    '<div class="verdict-class">' + esc(r.class) + '</div>' +
    '<div style="margin-top:12px">' + pills + '</div>';
  $('#reportCard').innerHTML =
    kv('structural', String(r.structural)) +
    kv('geometry evidence', String(r.geometryEvidence)) +
    kv('inliers', r.totalInliers + (r.geoWeakInliers ? ' (weak)' : '')) +
    kv('topology class', String(r.topology)) +
    kv('geo margin', r.geoMargin + '  raw ' + r.geoRaw + ' ctl ' + r.geoCtl) +
    kv('control member', r.geoCtlMember) +
    kv('comparator 4 says', r4 ? r4.verdict : '—') +
    kv('calibration id', r.calibrationId);
}
function paintVerdictStats(r, r4) {
  var moved = r4 && r4.verdict !== r.verdict;
  $('#verdictStats').innerHTML = [
    stat('Verdict', r.verdict, r.certifiable ? 'certifiable evidence present' : 'not certifiable'),
    stat('Structural', String(r.structural), 'strong bar ' + profile.thresholds[1]),
    stat('Geometric', String(r.geometryEvidence), 'strong bar ' + profile.thresholds[5]),
    stat('vs comparator 4', moved ? r4.verdict + ' → ' + r.verdict : 'unchanged',
         moved ? 'the 4.1 amendments moved this pair' : 'both comparators agree', !moved)
  ].join('');
}

/* ================================================================ *
 * 04 — geometry
 * ================================================================ */
function paintGeometry(r) {
  var A = slots.A, B2 = slots.B;
  var cv = $('#corr');
  var pad = 14, maxH = 260;
  var wA = A.img.width, hA = A.img.height, wB = B2.img.width, hB = B2.img.height;
  var scale = Math.min(1, maxH / Math.max(hA, hB));
  var W = (wA + wB) * scale + pad * 3, H = Math.max(hA, hB) * scale + pad * 2;
  var d = dpr();
  cv.width = Math.round(W * d); cv.height = Math.round(H * d);
  cv.style.width = Math.round(W) + 'px'; cv.style.height = Math.round(H) + 'px';
  var g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
  g.imageSmoothingEnabled = false;
  g.fillStyle = tok('--bg-base', '#000'); g.fillRect(0, 0, W, H);
  var ca = toCanvas(A.img, wA, hA), cb = toCanvas(B2.img, wB, hB);
  g.drawImage(ca, pad, pad, wA * scale, hA * scale);
  g.drawImage(cb, pad * 2 + wA * scale, pad, wB * scale, hB * scale);

  var ka = P.parseT2(A.hash.t2).list, kb = P.parseT2(B2.hash.t2).list;
  var dA = P.parseT1(A.hash.t1), dB = P.parseT1(B2.hash.t1);
  /* keypoint coordinates are normalised by the long side; undo that per side */
  var unA = function (k) {
    return [pad + (k.x / 65535) * dA.maxDim * scale, pad + (k.y / 65535) * dA.maxDim * scale];
  };
  var unB = function (k) {
    return [pad * 2 + wA * scale + (k.x / 65535) * dB.maxDim * scale, pad + (k.y / 65535) * dB.maxDim * scale];
  };
  g.globalAlpha = .5;
  g.fillStyle = tok('--grey-700', '#a3a3a3');
  ka.forEach(function (k) { var p = unA(k); g.fillRect(p[0] - 1, p[1] - 1, 2, 2); });
  kb.forEach(function (k) { var p = unB(k); g.fillRect(p[0] - 1, p[1] - 1, 2, 2); });
  g.globalAlpha = 1;

  /* The report carries models, not membership, so the bench recomputes the
     pools and re-runs the verifier — the same functions the comparator used —
     and draws which correspondences the model kept. */
  var o = { geoMinCorr: profile.geoMinCorr, geoEps: profile.geoEps,
            geoConfAt: profile.geoConfAt, mirrorHypothesis: true };
  var xmaxA = Math.max(0, Math.min(65535, Math.trunc((dA.width - 1) * 65535 / Math.max(1, dA.maxDim))));
  var am = P._internal.mirrorSide(ka, xmaxA);
  var pd = V.correspondW(ka, kb), pm = V.correspondW(am, kb);
  var vd = pd.length >= o.geoMinCorr ? V._internal.houghVerifyW(ka, kb, pd, o, dA.maxDim, dB.maxDim) : null;
  var vm = pm.length >= o.geoMinCorr ? V._internal.houghVerifyW(am, kb, pm, o, dA.maxDim, dB.maxDim) : null;
  var useMirror = (vm ? vm.inliers : -1) > (vd ? vd.inliers : -1);
  var pool = useMirror ? pm : pd, ver = useMirror ? vm : vd;
  var srcK = useMirror ? am : ka;
  var kept = 0;
  if (pool && pool.length) {
    var rg = rainbowGrad(g, pad, 0, W - pad, 0);
    for (var ci = 0; ci < pool.length; ci++) {
      var c0 = pool[ci];
      var a0 = srcK[c0[0]], b0 = kb[c0[1]];
      if (!a0 || !b0) continue;
      var p1 = unA(a0), p2 = unB(b0);
      var isIn = ver && ver.mask && ver.mask[ci];
      g.strokeStyle = isIn ? rg : tok('--grey-400', '#3d3d3d');
      g.globalAlpha = isIn ? 0.95 : 0.35;
      g.lineWidth = isIn ? 1.2 : 0.7;
      g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.stroke();
      if (isIn) kept++;
    }
    g.globalAlpha = 1;
  }
  $('#corrLegend').innerHTML =
    '<span><i class="swatch-rainbow"></i>inlier — the recovered model kept it (' + kept + ')</span>' +
    '<span><i style="background:var(--grey-400)"></i>correspondence the fit rejected (' +
      Math.max(0, (pool ? pool.length : 0) - kept) + ')</span>' +
    '<span><i style="background:var(--grey-700)"></i>stored keypoint, unmatched</span>' +
    '<span>pool: ' + (useMirror ? 'mirror' : 'direct') + ' · ' + (pool ? pool.length : 0) + ' correspondences</span>';

  var cov = r.coverage;
  var gsize = profile.gridG;
  var cells = '';
  if (cov) {
    var counts = Array.prototype.slice.call(cov.counts || []);
    var mx = Math.max.apply(null, counts.concat([1]));
    for (var i = 0; i < gsize * gsize; i++) {
      var v = counts[i] || 0;
      var a = v ? (0.15 + 0.85 * v / mx) : 0;
      cells += '<i title="' + v + ' inliers" style="background:' +
        (v ? 'hsl(' + Math.round(280 - 240 * (v / mx)) + ' 80% 60% / ' + a.toFixed(2) + ')' : 'var(--surface-2)') + '"></i>';
    }
  }
  $('#covGrid').style.gridTemplateColumns = 'repeat(' + gsize + ',1fr)';
  $('#covGrid').innerHTML = cells;
  $('#geoStats').innerHTML = [
    stat('Models accepted', String(r.models.length), 'floor ' + profile.minModelInliers + ' inliers, max ' + profile.maxModels),
    stat('Inliers', String(r.totalInliers), r.geoWeakInliers ? 'from the §A1 weak signal' : 'from accepted models'),
    stat('Topology', 'class ' + r.topology, r.topology >= 4 ? 'dominant region' : r.topology === 2 ? 'one localised region' :
         r.topology === 3 ? 'multi-model' : r.topology === 1 ? 'scattered' : 'nothing placed'),
    stat('Coverage', cov ? cov.occupied + '/' + (gsize * gsize) + ' cells' : '—',
         cov ? 'coverage ' + cov.coverage + ' · bbox ' + cov.bboxCells : '')
  ].join('');
}

/* ================================================================ *
 * 05 — the nine channels, before and after their tables
 * ================================================================ */
function paintChannels(r) {
  var host = $('#chans');
  host.innerHTML = '';
  CHAN_ORDER.forEach(function (name) {
    var ch = r.v3.channels[name];
    var isLocal = name === 'local';
    var raw = isLocal ? r.local.margin : ch.value;
    var ev = isLocal ? r.local.evidence : V.lutEval(V.lutChannel(profile, name), ch.value);
    var meas = isLocal ? r.local.measurable : ch.measurable;
    var w = profile.weights[WEIGHT_ORDER.indexOf(name)];
    var lut = isLocal ? profile.lutLocal : V.lutChannel(profile, name);
    var identity = lut.length === 2 && lut[0][0] === 0 && lut[0][1] === 0 &&
                   lut[1][0] === SCALE && lut[1][1] === SCALE;
    var el = document.createElement('div');
    el.className = 'chan' + (meas ? '' : ' abst') + (name === 'local' ? ' hero' : '');
    el.innerHTML =
      '<div class="chan-top">' +
        '<div class="chan-name">' + esc(name) + '<small>' + esc(CHAN_NOTE[name]) + '</small></div>' +
        '<div class="track">' +
          '<i class="raw" style="width:' + (meas ? (raw / SCALE * 100) : 0) + '%"></i>' +
          '<i class="val" style="width:' + (meas ? (ev / SCALE * 100) : 0) + '%"></i>' +
        '</div>' +
        '<div class="chan-val">' + (meas ? ev : 'abstains') + '</div>' +
        '<div class="chan-caret">›</div>' +
      '</div>' +
      '<div class="chan-body">' +
        kv('raw agreement', meas ? String(raw) : 'not measurable') +
        kv('after the ' + name + ' table', meas ? String(ev) : '—') +
        kv('table', identity ? 'identity — this channel is passed through' :
            lut.map(function (p) { return p[0] + '→' + p[1]; }).join('  ')) +
        kv('weight in the vote', String(w)) +
        (ch && ch.controlRan ? kv('own null control', String(ch.control)) : '') +
        (ch && ch.note ? '<p class="cap" style="margin-top:8px">' + esc(ch.note) + '</p>' : '') +
      '</div>';
    el.querySelector('.chan-top').addEventListener('click', function () { el.classList.toggle('open'); });
    host.appendChild(el);
  });
  var abst = CHAN_ORDER.filter(function (n) {
    return n === 'local' ? !r.local.measurable : !r.v3.channels[n].measurable; });
  $('#chanNote').innerHTML = 'The grey bar is the channel’s raw agreement; the bright fill is what its ' +
    '<b>calibration table</b> leaves once the corpus has had its say. Under container 2 every channel has ' +
    'its own table — that is the whole of amendment A3. ' +
    (abst.length ? 'Abstaining here: <b>' + abst.join(', ') + '</b>.' : 'Every channel could measure this pair.');
}

/* ================================================================ *
 * 06 — the calibration artefact
 * ================================================================ */
function curveSvg(pts, hero) {
  var d = pts.map(function (p, i) {
    return (i ? 'L' : 'M') + (p[0] / 100).toFixed(1) + ' ' + (100 - p[1] / 100).toFixed(1); }).join(' ');
  return '<svg class="curve" viewBox="0 0 100 100" preserveAspectRatio="none">' +
    '<line x1="0" y1="100" x2="100" y2="0" stroke="var(--grey-400)" stroke-width="1" ' +
      'stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line>' +
    '<path d="' + d + '" fill="none" stroke="' + (hero ? 'url(#rg)' : 'var(--grey-900)') +
      '" stroke-width="2" vector-effect="non-scaling-stroke"></path></svg>';
}
function paintProfile() {
  var bytes = V.profileEncode(profile);
  var id = V.hex(V.profileId(profile));
  $('#profId').innerHTML =
    kv('name', V.profileName(profile)) +
    kv('container / comparator', profile.container + ' / ' + profile.comparator) +
    kv('artefact', bytes.length + ' bytes') +
    kv('identity', id.slice(0, 32) + '…') +
    kv('grid', profile.gridG + '×' + profile.gridG) +
    kv('geo eps', String(profile.geoEps)) +
    kv('model floor', String(profile.minModelInliers)) +
    kv('min secondaries', String(profile.minSecondaries));
  $('#threshTable').innerHTML = '<table class="data"><thead><tr><th>threshold</th><th class="num">value</th></tr></thead><tbody>' +
    THRESH_NAMES.map(function (n, i) {
      return '<tr><td class="name">' + n + '</td><td class="num">' + profile.thresholds[i] + '</td></tr>'; }).join('') +
    '</tbody></table>';
  $('#curves').innerHTML = LUT_SLOTS.map(function (s) {
    var pts = profile[s[0]];
    var identity = pts.length === 2 && pts[0][1] === 0 && pts[1][1] === SCALE;
    return '<div class="card tight' + (identity ? ' flat' : '') + '">' +
      '<p class="px-eyebrow">' + esc(s[1]) + (identity ? ' · identity' : '') + '</p>' +
      curveSvg(pts, !identity) +
      '<p class="cap mono" style="margin-top:6px">' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join('  ') + '</p>' +
      '</div>';
  }).join('');
}

/* ================================================================ *
 * 07 — the attack sweep, both comparators
 * ================================================================ */
function runAttackSweep() {
  if (!slots.A) return;
  var keys = Object.keys(XF), i = 0, rows = [];
  var busy = $('#busy'); busy.classList.add('on');
  $('#sweepStatus').textContent = 'running…';
  var cal1 = V.cal001();
  function step() {
    if (i >= keys.length) {
      attackRows = rows;
      busy.classList.remove('on');
      $('#sweepStatus').textContent = rows.length + ' transforms · comparator 4 and 41 side by side';
      paintAttack();
      return;
    }
    var k = keys[i++];
    var img = XF[k].fn(slots.A.img);
    var wire = toWire(img), fp;
    try { fp = V.hashChecked(wire, {}, profile.limits); } catch (e) { setTimeout(step, 0); return; }
    var a = slots.A.hash;
    var r41 = V.compareV41(a.t1, a.t2, fp.t1, fp.t2, {}, profile);
    var r4 = V.compareV4(a.t1, a.t2, fp.t1, fp.t2, {}, cal1);
    rows.push({ label: XF[k].label, v41: r41.verdict, v4: r4.verdict,
                s: r41.structural, g: r41.geometryEvidence, inl: r41.totalInliers,
                weak: r41.geoWeakInliers, basis: r41.basis.join('+') });
    $('#sweepStatus').textContent = i + ' / ' + keys.length;
    setTimeout(step, 0);
  }
  setTimeout(step, 16);
}
function paintAttack() {
  if (!attackRows) return;
  var rows = attackRows.slice().sort(function (a, b) { return b.s - a.s; });
  $('#attackTable').innerHTML =
    '<table class="data"><thead><tr><th>transform</th><th>41</th><th>4</th>' +
    '<th class="num">struct</th><th class="num">geo</th><th class="num">inliers</th></tr></thead><tbody>' +
    rows.map(function (r) {
      var cert = r.v41 === 'Copy' || r.v41 === 'Identical';
      return '<tr' + (cert ? ' class="hero"' : '') + '>' +
        '<td class="name">' + esc(r.label) + '</td>' +
        '<td' + (cert ? ' class="verdict"' : '') + '>' + esc(r.v41) + '</td>' +
        '<td>' + esc(r.v4) + '</td>' +
        '<td class="num">' + r.s + '</td>' +
        '<td class="num">' + r.g + '</td>' +
        '<td class="num">' + r.inl + (r.weak ? '*' : '') + '</td></tr>';
    }).join('') + '</tbody></table>' +
    '<p class="cap" style="margin-top:10px">* the inlier count came from the §A1 weak signal — ' +
    'evidence for the margin, never enough to certify alone.</p>';

  var c = fit($('#chAttack'), 300), g = c.g;
  var pad = 34, x0 = pad, x1 = c.w - 12, y0 = 12, y1 = c.h - pad;
  g.strokeStyle = tok('--divider-strong', '#333'); g.lineWidth = 1;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, y1); g.lineTo(x1, y1); g.stroke();
  var t = profile.thresholds;
  [[t[1], 'strong'], [t[2], 'moderate']].forEach(function (m) {
    var x = x0 + (m[0] / SCALE) * (x1 - x0);
    g.strokeStyle = tok('--grey-400', '#3d3d3d'); g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); g.setLineDash([]);
    g.fillStyle = tok('--text-tertiary', '#7a7a7a'); g.font = '10px ui-monospace, monospace';
    g.fillText(m[1], x + 3, y0 + 10);
  });
  [[t[5], 'geo strong'], [t[6], 'geo weak']].forEach(function (m) {
    var y = y1 - (m[0] / SCALE) * (y1 - y0);
    g.strokeStyle = tok('--grey-400', '#3d3d3d'); g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]);
    g.fillStyle = tok('--text-tertiary', '#7a7a7a');
    g.fillText(m[1], x0 + 4, y - 3);
  });
  attackRows.forEach(function (r) {
    var x = x0 + (r.s / SCALE) * (x1 - x0), y = y1 - (r.g / SCALE) * (y1 - y0);
    var cert = r.v41 === 'Copy' || r.v41 === 'Identical';
    g.beginPath(); g.arc(x, y, cert ? 5 : 3.5, 0, Math.PI * 2);
    g.fillStyle = cert ? rainbowGrad(g, x0, 0, x1, 0) : tok('--grey-600', '#7a7a7a');
    g.fill();
  });
  g.fillStyle = tok('--text-tertiary', '#7a7a7a'); g.font = '10px ui-monospace, monospace';
  g.fillText('structural →', x1 - 74, y1 + 16);
  g.save(); g.translate(12, y0 + 60); g.rotate(-Math.PI / 2);
  g.fillText('geometric →', 0, 0); g.restore();
}

/* ================================================================ *
 * 08 — the wire
 * ================================================================ */
var hexSec = null;
function paintWire() {
  var A = slots.A;
  if (!A) return;
  var secs = P.SECTIONS, total = P.T1_BYTES;
  var rib = $('#ribbon');
  rib.innerHTML = '';
  var off = 0;
  secs.forEach(function (s, i) {
    var el = document.createElement('i');
    var shade = 20 + Math.round((i / secs.length) * 60);
    el.style.width = (s.len / total * 100) + '%';
    el.style.background = 'hsl(0 0% ' + shade + '%)';
    el.title = s.name + ' — ' + s.len + ' B at ' + off;
    var start = off;
    el.addEventListener('mouseenter', function () { paintHex({ name: s.name, off: start, len: s.len }); });
    rib.appendChild(el);
    off += s.len;
  });
  $('#ribLegend').innerHTML = secs.map(function (s) {
    return '<span>' + esc(s.name) + ' ' + s.len + ' B</span>'; }).join('');
  paintHex(hexSec);
}
function paintHex(sec) {
  var A = slots.A;
  if (!A) return;
  hexSec = sec;
  var b = A.hash.t1, from = sec ? sec.off : 0, to = sec ? sec.off + sec.len : Math.min(b.length, 1024);
  var out = [], line = [];
  $('#hexLabel').textContent = sec ? sec.name + ' — ' + sec.len + ' B at offset ' + sec.off
                                   : 'first 1024 bytes of tier 1';
  for (var i = from; i < to; i++) {
    if (line.length === 0) line.push(('0000' + i.toString(16)).slice(-4) + '  ');
    line.push(('0' + b[i].toString(16)).slice(-2));
    if (line.length === 17) { out.push(line.join(' ')); line = []; }
  }
  if (line.length > 1) out.push(line.join(' '));
  $('#hexview').textContent = out.join('\n');
}

/* ================================================================ *
 * 09 — cost, and the run loop
 * ================================================================ */
function decide() {
  var A = slots.A, B2 = slots.B;
  if (!A || !B2) return;
  var cal1 = V.cal001();
  var t0 = performance.now();
  var r = V.compareV41(A.hash.t1, A.hash.t2, B2.hash.t1, B2.hash.t2, {}, profile);
  var t1 = performance.now();
  var r4 = V.compareV4(A.hash.t1, A.hash.t2, B2.hash.t1, B2.hash.t2, {}, cal1);
  var t2 = performance.now();
  last = r; lastV4 = r4;
  paintScreen();
  paintLattice(r);
  paintReadout(r, r4);
  paintVerdictStats(r, r4);
  paintGeometry(r);
  paintChannels(r);
  paintProfile();
  paintWire();
  $('#costStats').innerHTML = [
    stat('Hash A', A.ms + ' ms', A.img.width + '×' + A.img.height + ' — budget 1600 ms'),
    stat('Hash B', B2.ms + ' ms', B2.img.width + '×' + B2.img.height),
    stat('Compare 41', (t1 - t0).toFixed(1) + ' ms', 'budget 25 ms — from the wire only'),
    stat('Compare 4', (t2 - t1).toFixed(1) + ' ms', 'the frozen comparator, same wires')
  ].join('');
}
function run() {
  var busy = $('#busy'); busy.classList.add('on');
  requestAnimationFrame(function () {
    setTimeout(function () {
      try { decide(); } catch (e) { console.error(e); }
      busy.classList.remove('on');
    }, 16);
  });
}

/* ---- wiring ---- */
['A', 'B'].forEach(function (slot) {
  var el = $('#plate' + slot);
  el.addEventListener('dragover', function (e) { e.preventDefault(); el.classList.add('drag'); });
  el.addEventListener('dragleave', function () { el.classList.remove('drag'); });
  el.addEventListener('drop', function (e) {
    e.preventDefault(); el.classList.remove('drag');
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) fromFile(f, slot);
  });
  el.querySelector('.plate-body').addEventListener('click', function () {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = function () { if (inp.files[0]) fromFile(inp.files[0], slot); };
    inp.click();
  });
});
window.addEventListener('paste', function (e) {
  var items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) if (items[i].type.indexOf('image') === 0) {
    fromFile(items[i].getAsFile(), slots.A ? 'B' : 'A'); break;
  }
});
$$('[data-sample]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    setSlot(slots.A ? 'B' : 'A', SAMPLES[btn.dataset.sample](), btn.dataset.sample);
    run();
  });
});
$('#xform').innerHTML = Object.keys(XF).map(function (k) {
  return '<option value="' + k + '">' + XF[k].label + '</option>'; }).join('');
$('#apply').addEventListener('click', function () {
  var k = $('#xform').value;
  if (!k || !slots.A) return;
  setSlot('B', XF[k].fn(slots.A.img), XF[k].label);
  run();
});
$('#swap').addEventListener('click', function () {
  var t = slots.A; slots.A = slots.B; slots.B = t;
  showPlate('A'); showPlate('B'); run();
});
$('#run').addEventListener('click', run);
$('#runSweep').addEventListener('click', runAttackSweep);
$('#hexReset').addEventListener('click', function () { paintHex(null); });
$('#exportProfile').addEventListener('click', function () {
  var blob = new Blob([V.profileEncode(profile)], { type: 'application/octet-stream' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = V.profileName(profile).replace(/[^A-Za-z0-9._-]/g, '_') + '.pcal';
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
});
var rt = null;
window.addEventListener('resize', function () {
  clearTimeout(rt);
  rt = setTimeout(function () { if (last) paintGeometry(last); if (attackRows) paintAttack(); }, 160);
});

/* a bench should never open as an empty form */
buildLattice();
setSlot('A', SAMPLES.sprite(), 'sprite');
setSlot('B', XF.pastecrop.fn(slots.A.img), XF.pastecrop.label);
$('#xform').value = 'pastecrop';
run();

/* the console surface the headless harness drives */
window.paph4x = {
  profile: function () { return profile; },
  slots: function () { return slots; },
  report: function () { return last; },
  reportV4: function () { return lastV4; },
  screen: function () { return lastScreen; },
  samples: SAMPLES, transforms: XF,
  setSlot: setSlot, decide: decide, sweep: runAttackSweep,
  attackRows: function () { return attackRows; }
};
})();
