/* tools/png.cjs — dependency-free PNG codec (node:zlib only).
 *
 * readPng(bytes)  -> { px: Uint8Array (RGBA), w, h }
 * writePng(px, w, h) -> Uint8Array
 *
 * Decoder: 8-bit depth, color types 0/2/3/4/6, PLTE + tRNS (indexed
 * transparency), all five filters, no interlace (Adam7 is rejected with
 * a clear error — pixel-art corpora do not ship interlaced).
 * Encoder: RGBA, filter 0, one IDAT.  Tool-side only; the library
 * itself never touches PNG. */
'use strict';
const zlib = require('node:zlib');

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

/* ---- crc32 (PNG polynomial) ---- */
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(u8, from, to) {
  let c = -1;
  for (let i = from; i < to; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function be32(u8, o) { return ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0; }

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

function readPng(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < 8; i++) if (u[i] !== SIG[i]) throw new Error('png: bad signature');
  let o = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  let plte = null, trns = null;
  const idat = [];
  while (o + 8 <= u.length) {
    const len = be32(u, o);
    const type = String.fromCharCode(u[o + 4], u[o + 5], u[o + 6], u[o + 7]);
    const body = o + 8;
    if (type === 'IHDR') {
      w = be32(u, body); h = be32(u, body + 4);
      depth = u[body + 8]; ctype = u[body + 9]; interlace = u[body + 12];
    } else if (type === 'PLTE') plte = u.subarray(body, body + len);
    else if (type === 'tRNS') trns = u.subarray(body, body + len);
    else if (type === 'IDAT') idat.push(u.subarray(body, body + len));
    else if (type === 'IEND') break;
    o = body + len + 4;
  }
  if (!w || !h) throw new Error('png: missing IHDR');
  if (depth !== 8) throw new Error('png: only 8-bit depth supported (got ' + depth + ')');
  if (interlace) throw new Error('png: interlaced (Adam7) not supported');
  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!CH) throw new Error('png: color type ' + ctype + ' unsupported');
  if (ctype === 3 && !plte) throw new Error('png: indexed without PLTE');

  const raw = zlib.inflateSync(Buffer.concat(idat.map(Buffer.from)));
  const stride = w * CH;
  if (raw.length < (stride + 1) * h) throw new Error('png: short pixel data');

  const line = new Uint8Array(stride), prev = new Uint8Array(stride);
  const px = new Uint8Array(w * h * 4);
  let ro = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[ro++];
    for (let x = 0; x < stride; x++) {
      const rb = raw[ro + x];
      const a = x >= CH ? line[x - CH] : 0;
      const b = prev[x];
      const c = x >= CH ? prev[x - CH] : 0;
      let v;
      if (f === 0) v = rb;
      else if (f === 1) v = rb + a;
      else if (f === 2) v = rb + b;
      else if (f === 3) v = rb + ((a + b) >> 1);
      else if (f === 4) v = rb + paeth(a, b, c);
      else throw new Error('png: bad filter ' + f + ' at row ' + y);
      line[x] = v & 255;
    }
    ro += stride;
    for (let x = 0; x < w; x++) {
      const s = x * CH, d = (y * w + x) * 4;
      if (ctype === 0) { const g = line[s]; px[d] = g; px[d + 1] = g; px[d + 2] = g; px[d + 3] = 255; }
      else if (ctype === 2) { px[d] = line[s]; px[d + 1] = line[s + 1]; px[d + 2] = line[s + 2]; px[d + 3] = 255; }
      else if (ctype === 3) {
        const i = line[s], p3 = i * 3;
        px[d] = plte[p3]; px[d + 1] = plte[p3 + 1]; px[d + 2] = plte[p3 + 2];
        px[d + 3] = (trns && i < trns.length) ? trns[i] : 255;
      }
      else if (ctype === 4) { const g = line[s]; px[d] = g; px[d + 1] = g; px[d + 2] = g; px[d + 3] = line[s + 1]; }
      else { px[d] = line[s]; px[d + 1] = line[s + 1]; px[d + 2] = line[s + 2]; px[d + 3] = line[s + 3]; }
    }
    prev.set(line);
  }
  return { px, w, h };
}

function chunk(type, body) {
  const out = new Uint8Array(8 + body.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

function writePng(px, w, h) {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6;                       /* 8-bit RGBA */
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = new Uint8Array(zlib.deflateSync(raw, { level: 9 }));
  const parts = [new Uint8Array(SIG), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

module.exports = { readPng, writePng };
