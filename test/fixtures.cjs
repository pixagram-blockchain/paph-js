/* Deterministic pixel-art fixtures for the paph 5.1 test suite.
 * Everything derives from a seeded xorshift; no I/O, no randomness. */
'use strict';
function rng(seed) { var x = seed >>> 0 || 1;
  return function () { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; }; }
function blank(w, h, c) {
  var px = new Uint8Array(w * h * 4);
  for (var i = 0; i < w * h; i++) { px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255; }
  return { px: px, w: w, h: h };
}
function put(im, x, y, c) {
  if (x < 0 || y < 0 || x >= im.w || y >= im.h) return;
  var o = (y * im.w + x) * 4;
  im.px[o] = c[0]; im.px[o + 1] = c[1]; im.px[o + 2] = c[2]; im.px[o + 3] = 255;
}
function rect(im, x0, y0, w, h, c) {
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) put(im, x0 + x, y0 + y, c);
}
function disc(im, cx, cy, r, c) {
  for (var y = -r; y <= r; y++) for (var x = -r; x <= r; x++)
    if (x * x + y * y <= r * r) put(im, cx + x, cy + y, c);
}
/* repetitive checker tiles with line overlays (worst case for repetition) */
function tiles(w, h, seed) {
  var r = rng(seed), cols = [];
  for (var i = 0; i < 9; i++) cols.push([r() % 256, r() % 256, r() % 256]);
  var im = blank(w, h, [0, 0, 0]);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++)
    put(im, x, y, cols[((x >> 3) + (y >> 3)) % 9]);
  for (i = 0; i < 40; i++) {
    var x0 = r() % (w - 9), y0 = r() % (h - 9), c = cols[r() % 9];
    for (var t = 0; t < 8; t++) { put(im, x0 + t, y0, c); put(im, x0, y0 + t, c); }
  }
  return im;
}
/* distinctive corner-rich sprite: outlined shapes plus a scatter of hard
 * pixel-art stamps (crosses, boxes, zigzags) so FAST-9 finds real corners
 * everywhere and the local channel has distinctive descriptors */
function sprite(w, h, seed) {
  var r = rng(seed);
  /* background: 3-tone diagonal micro-pattern varying only the blue
   * nibble.  The three 4-bit border keys each hold ~1/3 of the edge
   * ring, so foldMatte's majority test (bestN*2 >= ring) can never
   * pass at any dims; luma spread < 4 stays far below FAST_T, so the
   * pattern spawns no keypoints of its own; and no 2x2 block is
   * constant, so divideUpscale stays at 1. */
  var im = blank(w, h, [30, 30, 16]);
  var bgTone = [[30, 30, 16], [30, 30, 32], [30, 30, 48]];
  for (var by = 0; by < h; by++) for (var bx = 0; bx < w; bx++)
    put(im, bx, by, bgTone[(bx + by) % 3]);
  var pal = [], dark = [8, 8, 12];
  for (var i = 0; i < 7; i++) pal.push([64 + r() % 192, 64 + r() % 192, 64 + r() % 192]);
  function outlineRect(x0, y0, rw, rh, c) {
    rect(im, x0, y0, rw, rh, c);
    for (var x = 0; x < rw; x++) { put(im, x0 + x, y0, dark); put(im, x0 + x, y0 + rh - 1, dark); }
    for (var y = 0; y < rh; y++) { put(im, x0, y0 + y, dark); put(im, x0 + rw - 1, y0 + y, dark); }
  }
  function cross(x0, y0, s, c) {
    for (var t = -s; t <= s; t++) { put(im, x0 + t, y0, c); put(im, x0, y0 + t, c); }
  }
  function zigzag(x0, y0, n, c) {
    for (var t = 0; t < n; t++) { put(im, x0 + t, y0 + (t & 3), c); put(im, x0 + t, y0 + (t & 3) + 1, c); }
  }
  function box(x0, y0, s, c) { rect(im, x0, y0, s, s, c); put(im, x0 + (s >> 1), y0 + (s >> 1), pal[3]); }
  /* orientation-locked stamps: every wedge and hook is drawn in the SAME
   * orientation, so the strong-descriptor multiset is NOT closed under
   * D4 and bag alignment can discriminate the true element (a purely
   * cross/box/disc sprite is D4-closed at bag level, which lawfully
   * ties the alignment predicate) */
  function wedge(x0, y0, s, c) {
    for (var t = 0; t < s; t++) for (var u = 0; u <= t; u++) put(im, x0 + u, y0 + t, c);
  }
  function hook(x0, y0, s, c) {
    for (var t = 0; t < s; t++) { put(im, x0, y0 + t, c); put(im, x0 + 1, y0 + t, c); }
    for (var u = 0; u < s; u++) { put(im, x0 + u, y0 + s - 1, c); put(im, x0 + u, y0 + s - 2, c); }
  }
  for (i = 0; i < 5; i++) {
    var cx = 14 + r() % (w - 28), cy = 14 + r() % (h - 28), rad = 5 + r() % 8, c = pal[i % 7];
    disc(im, cx, cy, rad, c);
    disc(im, cx, cy, Math.max(1, rad - 2), pal[(i + 2) % 7]);
    cross(cx, cy, 2, pal[(i + 4) % 7]);   /* single-polarity: no dark twin of the bright crosses */
  }
  for (i = 0; i < 5; i++)
    outlineRect(2 + r() % (w - 24), 2 + r() % (h - 16), 8 + r() % 12, 6 + r() % 9, pal[(i + 3) % 7]);
  for (i = 0; i < 10; i++) cross(4 + r() % (w - 8), 4 + r() % (h - 8), 1 + r() % 3, pal[r() % 7]);
  for (i = 0; i < 8; i++) box(2 + r() % (w - 8), 2 + r() % (h - 8), 3 + r() % 4, pal[r() % 7]);
  for (i = 0; i < 12; i++) zigzag(2 + r() % (w - 16), 2 + r() % (h - 8), 8 + r() % 6, pal[r() % 7]);
  for (i = 0; i < 14; i++) wedge(2 + r() % (w - 12), 2 + r() % (h - 12), 5 + r() % 5, pal[r() % 7]);
  for (i = 0; i < 12; i++) hook(2 + r() % (w - 10), 3 + r() % (h - 12), 5 + r() % 4, pal[r() % 7]);
  for (i = 0; i < 30; i++) put(im, r() % w, r() % h, pal[r() % 7]);
  return im;
}
function stripes(w, h, seed) {
  var r = rng(seed), a = [r() % 256, r() % 256, r() % 256], b = [r() % 256, r() % 256, r() % 256];
  var im = blank(w, h, a), p = 5 + r() % 6;
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++)
    if (((x + y * 2) / p | 0) % 2) put(im, x, y, b);
  return im;
}
function noise(w, h, seed) {
  var r = rng(seed), im = blank(w, h, [0, 0, 0]);
  for (var i = 0; i < w * h; i++)
    put(im, i % w, (i / w) | 0, [r() % 256, r() % 256, r() % 256]);
  return im;
}
/* exact D4 transform of an RGBA image (forward element semantics: the
 * OUTPUT is the input moved by element k, matching wire D4F on grids) */
function d4(im, k) {
  var w = im.w, h = im.h, nw = k >= 4 ? h : w, nh = k >= 4 ? w : h;
  var out = { px: new Uint8Array(nw * nh * 4), w: nw, h: nh };
  for (var y = 0; y < nh; y++) for (var x = 0; x < nw; x++) {
    var sx, sy;
    if (k === 0) { sx = x; sy = y; }
    else if (k === 1) { sx = nw - 1 - x; sy = y; }
    else if (k === 2) { sx = x; sy = nh - 1 - y; }
    else if (k === 3) { sx = nw - 1 - x; sy = nh - 1 - y; }
    else if (k === 4) { sx = y; sy = x; }
    else if (k === 5) { sy = x; sx = w - 1 - y; }
    else if (k === 6) { sy = h - 1 - x; sx = y; }
    else { sx = w - 1 - y; sy = h - 1 - x; }
    var s = (sy * w + sx) * 4, d = (y * nw + x) * 4;
    out.px[d] = im.px[s]; out.px[d + 1] = im.px[s + 1];
    out.px[d + 2] = im.px[s + 2]; out.px[d + 3] = im.px[s + 3];
  }
  return out;
}
function shiftLum(im, delta) {
  var out = { px: new Uint8Array(im.px), w: im.w, h: im.h };
  for (var i = 0; i < out.px.length; i += 4)
    for (var c = 0; c < 3; c++)
      out.px[i + c] = Math.max(0, Math.min(255, out.px[i + c] + delta));
  return out;
}
function invert(im) {
  var out = { px: new Uint8Array(im.px), w: im.w, h: im.h };
  for (var i = 0; i < out.px.length; i += 4)
    for (var c = 0; c < 3; c++) out.px[i + c] = 255 - out.px[i + c];
  return out;
}
function upscale(im, k) {
  var w = im.w * k, h = im.h * k, out = { px: new Uint8Array(w * h * 4), w: w, h: h };
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var s = (((y / k) | 0) * im.w + ((x / k) | 0)) * 4, d = (y * w + x) * 4;
    out.px[d] = im.px[s]; out.px[d + 1] = im.px[s + 1];
    out.px[d + 2] = im.px[s + 2]; out.px[d + 3] = im.px[s + 3];
  }
  return out;
}
/* paste a crop of src into dst (both mutated copies returned) */
function pasteCrop(src, sx, sy, cw, chh, dst, dx, dy) {
  var out = { px: new Uint8Array(dst.px), w: dst.w, h: dst.h };
  for (var y = 0; y < chh; y++) for (var x = 0; x < cw; x++) {
    var s = ((sy + y) * src.w + (sx + x)) * 4;
    put(out, dx + x, dy + y, [src.px[s], src.px[s + 1], src.px[s + 2]]);
  }
  return out;
}
module.exports = { rng: rng, blank: blank, rect: rect, disc: disc, put: put,
                   tiles: tiles, sprite: sprite, stripes: stripes, noise: noise,
                   d4: d4, shiftLum: shiftLum, invert: invert, upscale: upscale,
                   pasteCrop: pasteCrop };
