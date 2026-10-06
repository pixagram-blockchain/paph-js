/* test/png.test.cjs — the tool codec must decode what the world writes:
 * every filter type, indexed + tRNS, gray, gray+alpha; and round-trip
 * its own encoder exactly. */
'use strict';
const zlib = require('node:zlib');
const { readPng, writePng } = require('../tools/png.cjs');
const F = require('./fixtures.cjs');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('PASS ' + name); pass++; }
  catch (e) { console.log('FAIL ' + name + ': ' + e.message); fail++; }
}
function eq(a, b, msg) { if (a !== b) throw new Error(msg + ' (' + a + ' != ' + b + ')'); }
function eqPx(a, b) {
  eq(a.length, b.length, 'pixel buffer length');
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error('pixel byte ' + i + ': ' + a[i] + ' != ' + b[i]);
}

/* hand-rolled chunk writer independent of tools/png.cjs internals */
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
function crc32(u8) { let c = -1; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, body) {
  const tb = new Uint8Array(4 + body.length);
  for (let i = 0; i < 4; i++) tb[i] = type.charCodeAt(i);
  tb.set(body, 4);
  const out = new Uint8Array(8 + body.length + 4);
  new DataView(out.buffer).setUint32(0, body.length);
  out.set(tb, 4);
  new DataView(out.buffer).setUint32(8 + body.length, crc32(tb));
  return out;
}
function png(chunks) {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  let n = sig.length; for (const c of chunks) n += c.length;
  const out = new Uint8Array(n); out.set(sig, 0);
  let o = sig.length; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
function ihdr(w, h, ctype) {
  const b = new Uint8Array(13);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); b[8] = 8; b[9] = ctype;
  return b;
}

T('round-trip: writePng -> readPng is exact on a fixture sprite', () => {
  const im = F.sprite(97, 61, 5);
  const back = readPng(writePng(im.px, im.w, im.h));
  eq(back.w, 97, 'w'); eq(back.h, 61, 'h');
  eqPx(back.px, im.px);
});

T('all five filters decode (RGB, one filter per row)', () => {
  /* reference image 4x5 RGB, deterministic bytes */
  const w = 4, h = 5, CH = 3, stride = w * CH;
  const ref = new Uint8Array(stride * h);
  for (let i = 0; i < ref.length; i++) ref[i] = (i * 37 + 11) & 255;
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
  };
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const f = y % 5;                       /* rows use filters 0,1,2,3,4 */
    raw[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x++) {
      const v = ref[y * stride + x];
      const a = x >= CH ? ref[y * stride + x - CH] : 0;
      const b = y > 0 ? ref[(y - 1) * stride + x] : 0;
      const c = (x >= CH && y > 0) ? ref[(y - 1) * stride + x - CH] : 0;
      let e;
      if (f === 0) e = v;
      else if (f === 1) e = v - a;
      else if (f === 2) e = v - b;
      else if (f === 3) e = v - ((a + b) >> 1);
      else e = v - paeth(a, b, c);
      raw[y * (stride + 1) + 1 + x] = e & 255;
    }
  }
  const bytes = png([chunk('IHDR', ihdr(w, h, 2)), chunk('IDAT', new Uint8Array(zlib.deflateSync(raw))), chunk('IEND', new Uint8Array(0))]);
  const got = readPng(bytes);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = y * stride + x * CH, d = (y * w + x) * 4;
    eq(got.px[d], ref[s], 'r@' + x + ',' + y);
    eq(got.px[d + 1], ref[s + 1], 'g@' + x + ',' + y);
    eq(got.px[d + 2], ref[s + 2], 'b@' + x + ',' + y);
    eq(got.px[d + 3], 255, 'a@' + x + ',' + y);
  }
});

T('indexed + tRNS decodes with per-index alpha', () => {
  const w = 3, h = 2;
  const plte = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]); /* R,G,B */
  const trns = new Uint8Array([255, 128]);                        /* index 2 -> opaque by default */
  const idx = [0, 1, 2, 2, 1, 0];
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = idx[y * w + x]; }
  const bytes = png([chunk('IHDR', ihdr(w, h, 3)), chunk('PLTE', plte), chunk('tRNS', trns),
                     chunk('IDAT', new Uint8Array(zlib.deflateSync(raw))), chunk('IEND', new Uint8Array(0))]);
  const got = readPng(bytes);
  const expect = [
    [255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 255],
    [0, 0, 255, 255], [0, 255, 0, 128], [255, 0, 0, 255]
  ];
  for (let i = 0; i < 6; i++) for (let c = 0; c < 4; c++) eq(got.px[i * 4 + c], expect[i][c], 'px' + i + '.' + c);
});

T('grayscale and gray+alpha decode', () => {
  const g = new Uint8Array([0, 10, 0, 200]);           /* 2x2 gray, filter col */
  const raw = new Uint8Array([0, 0, 10, 0, 0, 200]);
  let bytes = png([chunk('IHDR', ihdr(2, 2, 0)), chunk('IDAT', new Uint8Array(zlib.deflateSync(raw))), chunk('IEND', new Uint8Array(0))]);
  let got = readPng(bytes);
  eq(got.px[0], 0, 'g0'); eq(got.px[4], 10, 'g1'); eq(got.px[3], 255, 'ga');
  const raw2 = new Uint8Array([0, 7, 100, 8, 200]);    /* 2x1 gray+alpha */
  bytes = png([chunk('IHDR', ihdr(2, 1, 4)), chunk('IDAT', new Uint8Array(zlib.deflateSync(raw2))), chunk('IEND', new Uint8Array(0))]);
  got = readPng(bytes);
  eq(got.px[0], 7, 'ga.g0'); eq(got.px[3], 100, 'ga.a0'); eq(got.px[4], 8, 'ga.g1'); eq(got.px[7], 200, 'ga.a1');
});

T('interlaced is rejected, not mangled', () => {
  const b = ihdr(2, 2, 2); b[12] = 1;
  const raw = new Uint8Array([0, 1, 2, 3, 4, 5, 6]);
  const bytes = png([chunk('IHDR', b), chunk('IDAT', new Uint8Array(zlib.deflateSync(raw))), chunk('IEND', new Uint8Array(0))]);
  let threw = false;
  try { readPng(bytes); } catch (e) { threw = /Adam7/.test(e.message); }
  if (!threw) throw new Error('expected Adam7 rejection');
});

console.log('png: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
