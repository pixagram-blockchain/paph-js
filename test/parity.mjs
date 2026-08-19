/**
 * Cross-implementation parity.
 *
 * The single property this package exists to have: two independent
 * implementations, written from the same spec in different languages, produce
 * the SAME 3952 bytes and the SAME verdict.  Everything else in the design is
 * downstream of that — an index, a consensus rule and a moderation appeal all
 * assume two parties can recompute the same answer.
 */
import { init, Config as WConfig, Paph as WPaph } from '../wasm/paph3-wasm.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const JS = require('../src/paph3.cjs');

const C = { g: '\u001b[32m', r: '\u001b[31m', d: '\u001b[2m', x: '\u001b[0m' };
let pass = 0, fail = 0;
const ok = (c, name, extra) => {
  if (c) { pass++; console.log(`  ${C.g}PASS${C.x} ${name}` + (extra ? ` ${C.d}${extra}${C.x}` : '')); }
  else { fail++; console.log(`  ${C.r}FAIL${C.x} ${name}` + (extra ? ` ${C.d}${extra}${C.x}` : '')); }
};

function work(w, h, seed, alpha) {
  const px = new Uint8Array(w * h * 4);
  let s = seed;
  const R = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) << 2, cx = x - w / 2, cy = y - h / 2;
    if (alpha && (cx * cx) / (w * w / 5) + (cy * cy) / (h * h / 4.5) >= 1) { px[o + 3] = 0; continue; }
    px[o] = (x * 7 + y * 3 + seed) % 251; px[o + 1] = (y * 11 + x * 5) % 253;
    px[o + 2] = ((x ^ y) * 13) % 247; px[o + 3] = 255;
  }
  for (let i = 0; i < 40; i++) {
    const bx = (R() * (w - 10)) | 0, by = (R() * (h - 10)) | 0;
    const r = (R() * 255) | 0, g = (R() * 255) | 0, b = (R() * 255) | 0;
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) {
      const o = ((by + dy) * w + bx + dx) << 2;
      if (px[o + 3] === 0) continue;
      px[o] = r; px[o + 1] = g; px[o + 2] = b;
    }
  }
  return { px, w, h };
}
const T = {
  none: im => im,
  mirror: ({ px, w, h }) => { const o = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y * w + (w - 1 - x)) << 2, d = (y * w + x) << 2;
      o[d] = px[s]; o[d + 1] = px[s + 1]; o[d + 2] = px[s + 2]; o[d + 3] = px[s + 3]; }
    return { px: o, w, h }; },
  invert: ({ px, w, h }) => { const o = Uint8Array.from(px);
    for (let i = 0; i < w * h; i++) { const q = i << 2; o[q] = 255 - o[q]; o[q + 1] = 255 - o[q + 1]; o[q + 2] = 255 - o[q + 2]; }
    return { px: o, w, h }; },
  up2: ({ px, w, h }) => { const nw = w * 2, nh = h * 2, o = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const s = ((y >> 1) * w + (x >> 1)) << 2, d = (y * nw + x) << 2;
      o[d] = px[s]; o[d + 1] = px[s + 1]; o[d + 2] = px[s + 2]; o[d + 3] = px[s + 3]; }
    return { px: o, w: nw, h: nh }; },
  crop: ({ px, w, h }) => { const nw = (w * .7) | 0, nh = (h * .7) | 0, x0 = ((w - nw) / 2) | 0, y0 = ((h - nh) / 2) | 0;
    const o = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const s = ((y0 + y) * w + x0 + x) << 2, d = (y * nw + x) << 2;
      o[d] = px[s]; o[d + 1] = px[s + 1]; o[d + 2] = px[s + 2]; o[d + 3] = px[s + 3]; }
    return { px: o, w: nw, h: nh }; }
};
const eq = (a, b) => Buffer.from(a).equals(Buffer.from(b));

console.log('\nPAPH v3 — JavaScript vs WebAssembly parity\n');
await init();
const jsE = new JS.Paph(), wE = new WPaph();

console.log('config surface');
const jc = jsE.config.toJSON(), wc = wE.config.toJSON();
const keys = Object.keys(wc);
ok(keys.every(k => JSON.stringify(jc[k]) === JSON.stringify(wc[k])),
   'both backends default to the same configuration',
   keys.length + ' fields');
ok(wE.backend === 'wasm' && jsE.backend === 'js', 'backends identify themselves');

console.log('\ntier 1 and tier 2 wires, byte for byte');
const cases = [[96, 96, false], [160, 120, false], [220, 170, false], [128, 128, true],
               [301, 97, true], [64, 64, false], [400, 300, false]];
for (const [w, h, alpha] of cases) {
  const im = work(w, h, 7, alpha);
  const j = jsE.hash(im.px, w, h), x = wE.hash(im.px, w, h);
  ok(eq(j.t1, x.t1) && eq(j.t2, x.t2), `${w}x${h}${alpha ? ' with alpha' : ''}`,
     `${j.t1.length} + ${j.t2.length} B, ${j.kpCount} keypoints`);
}

console.log('\nverdicts');
const base = work(160, 120, 7, false);
const jA = jsE.hash(base.px, base.w, base.h), wA = wE.hash(base.px, base.w, base.h);
for (const k of Object.keys(T)) {
  const im = T[k](base);
  const jB = jsE.hash(im.px, im.w, im.h), wB = wE.hash(im.px, im.w, im.h);
  const j = jsE.compare(jA, jB), x = wE.compare(wA, wB);
  const same = j.verdict === x.verdict && j.structural === x.structural &&
               j.geometric === x.geometric && j.report.inliers === x.report.inliers;
  ok(same, k.padEnd(8), `${j.verdict} struct ${j.structural} geo ${j.geometric} inliers ${j.report.inliers}`);
}
const other = work(200, 150, 99, true);
{
  const jB = jsE.hash(other.px, other.w, other.h), wB = wE.hash(other.px, other.w, other.h);
  const j = jsE.compare(jA, jB), x = wE.compare(wA, wB);
  ok(j.verdict === x.verdict && j.structural === x.structural, 'unrelated',
     `${j.verdict} struct ${j.structural}`);
}

console.log('\nchannel by channel, on the mirrored pair');
{
  const im = T.mirror(base);
  const j = jsE.compare(jA, jsE.hash(im.px, im.w, im.h));
  const x = wE.compare(wA, wE.hash(im.px, im.w, im.h));
  for (const n of ['dct', 'local', 'shape', 'topology', 'runs', 'palette', 'silhouette']) {
    const a = j.channels[n], b = x.channels[n];
    ok(a.measurable === b.measurable && (!a.measurable || (a.value === b.value && a.raw === b.raw && a.control === b.control)),
       n.padEnd(10), a.measurable ? `value ${a.value} raw ${a.raw} control ${a.control}` : 'both abstain');
  }
}

console.log('\nderived configuration reaches both engines');
{
  const j2 = jsE.with({ scoring: 'gate', hammingT: 4, geoEps: 900 });
  const w2 = wE.with({ scoring: 'gate', hammingT: 4, geoEps: 900 });
  const im = T.crop(base);
  const j = j2.compare(j2.hash(base.px, base.w, base.h), j2.hash(im.px, im.w, im.h));
  const x = w2.compare(w2.hash(base.px, base.w, base.h), w2.hash(im.px, im.w, im.h));
  ok(j.verdict === x.verdict && j.structural === x.structural && j.geometric === x.geometric,
     'gate / hammingT 4 / geoEps 900', `${j.verdict} ${j.structural}/${j.geometric}`);
  let threw = 0;
  try { wE.with({ nope: 1 }); } catch { threw++; }
  try { jsE.with({ nope: 1 }); } catch { threw++; }
  ok(threw === 2, 'both reject unknown config keys');
  threw = 0;
  try { new WConfig({ geoEps: 99999 }); } catch { threw++; }
  try { new JS.Config({ geoEps: 99999 }); } catch { threw++; }
  ok(threw === 2, 'both validate ranges');
}

console.log('\ntiming');
{
  const big = work(512, 384, 3, false);
  let t = Date.now(); jsE.hash(big.px, 512, 384); const tj = Date.now() - t;
  t = Date.now(); wE.hash(big.px, 512, 384); const tw = Date.now() - t;
  console.log(`  ${C.d}hash 512x384 — js ${tj} ms, wasm ${tw} ms (${(tj / Math.max(1, tw)).toFixed(1)}x)${C.x}`);
}

console.log(`\n${fail ? C.r : C.g}${pass} passed, ${fail} failed${C.x}\n`);
process.exit(fail ? 1 : 0);
