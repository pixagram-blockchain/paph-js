/**
 * Cross-engine parity for the v4 COMPARATOR (SPEC-004, milestone M4).
 *
 * test/parity.mjs proves the two engines hash and compare identically under
 * comparator 3.  This file proves comparator 4: the SAME wires (hashed once,
 * by the JS engine) go through the native Rust reference (`paphcli` mode 'V')
 * and through the JavaScript port, and the two full reports must be equal
 * field for field — verdict, basis, rule firings, every evidence number,
 * every model, every coverage cell count.
 *
 * Build the reference first:  cargo build --release --manifest-path rust/Cargo.toml
 * Then:                       npm run parity4
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const JS = require('../src/paph3.cjs');
const V4 = require('../src/paph4.cjs');

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '..', 'rust', 'target', 'release', process.platform === 'win32' ? 'paphcli.exe' : 'paphcli');
if (!existsSync(BIN)) {
  console.error('paphcli not found at ' + BIN);
  console.error('build it first:  cargo build --release --manifest-path rust/Cargo.toml');
  process.exit(2);
}

const C = { g: '\u001b[32m', r: '\u001b[31m', d: '\u001b[2m', x: '\u001b[0m' };
let pass = 0, fail = 0;
const ok = (c, name, extra) => {
  if (c) { pass++; console.log(`  ${C.g}PASS${C.x} ${name}` + (extra ? ` ${C.d}${extra}${C.x}` : '')); }
  else { fail++; console.log(`  ${C.r}FAIL${C.x} ${name}` + (extra ? ` ${C.d}${extra}${C.x}` : '')); }
};

function work(w, h, seed) {
  const px = new Uint8Array(w * h * 4);
  let s = seed;
  const R = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) << 2;
    px[o] = (x * 7 + y * 3 + seed) % 251; px[o + 1] = (y * 11 + x * 5) % 253;
    px[o + 2] = ((x ^ y) * 13) % 247; px[o + 3] = 255;
  }
  for (let i = 0; i < 40; i++) {
    const bx = (R() * (w - 10)) | 0, by = (R() * (h - 10)) | 0;
    const r = (R() * 255) | 0, g = (R() * 255) | 0, b = (R() * 255) | 0;
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) {
      const o = ((by + dy) * w + bx + dx) << 2;
      px[o] = r; px[o + 1] = g; px[o + 2] = b;
    }
  }
  return { px, w, h };
}
const mirror = ({ px, w, h }) => {
  const o = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + (w - 1 - x)) << 2, d = (y * w + x) << 2;
    o[d] = px[s]; o[d + 1] = px[s + 1]; o[d + 2] = px[s + 2]; o[d + 3] = px[s + 3];
  }
  return { px: o, w, h };
};
const crop = ({ px, w, h }) => {
  const nw = (w * .7) | 0, nh = (h * .7) | 0, x0 = ((w - nw) / 2) | 0, y0 = ((h - nh) / 2) | 0;
  const o = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const s = ((y0 + y) * w + x0 + x) << 2, d = (y * nw + x) << 2;
    o[d] = px[s]; o[d + 1] = px[s + 1]; o[d + 2] = px[s + 2]; o[d + 3] = px[s + 3];
  }
  return { px: o, w: nw, h: nh };
};
const up2 = ({ px, w, h }) => {
  const nw = w * 2, nh = h * 2, o = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const s = ((y >> 1) * w + (x >> 1)) << 2, d = (y * nw + x) << 2;
    o[d] = px[s]; o[d + 1] = px[s + 1]; o[d + 2] = px[s + 2]; o[d + 3] = px[s + 3];
  }
  return { px: o, w: nw, h: nh };
};

function rustV4(a, b) {
  const head = Buffer.alloc(17);
  head[0] = 'V'.charCodeAt(0);
  head.writeUInt32LE(a.t1.length, 1);
  head.writeUInt32LE(a.t2.length, 5);
  head.writeUInt32LE(b.t1.length, 9);
  head.writeUInt32LE(b.t2.length, 13);
  const input = Buffer.concat([head, Buffer.from(a.t1), Buffer.from(a.t2), Buffer.from(b.t1), Buffer.from(b.t2)]);
  const r = spawnSync(BIN, [], { input, maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error('paphcli failed: ' + r.stderr);
  return JSON.parse(r.stdout.toString());
}
function rustV41(a, b) {
  const head = Buffer.alloc(17);
  head[0] = 'W'.charCodeAt(0);
  head.writeUInt32LE(a.t1.length, 1);
  head.writeUInt32LE(a.t2.length, 5);
  head.writeUInt32LE(b.t1.length, 9);
  head.writeUInt32LE(b.t2.length, 13);
  const input = Buffer.concat([head, Buffer.from(a.t1), Buffer.from(a.t2), Buffer.from(b.t1), Buffer.from(b.t2)]);
  const r = spawnSync(BIN, [], { input, maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error('paphcli failed: ' + r.stderr);
  return JSON.parse(r.stdout.toString());
}
function pickCov(c) {
  return { g: c.g, occupied: c.occupied, coverage: c.coverage, bboxCells: c.bboxCells,
           concentration: c.concentration, counts: Array.from(c.counts) };
}
function pick41(r) {
  const base = pickReport(r);
  base.geoWeakInliers = r.geoWeakInliers;
  return base;
}
function jsV41(a, b) {
  return pick41(V4.compareV41(a.t1, a.t2, b.t1, b.t2, {}, V4.cal003()));
}
function jsV4(a, b) {
  return pickReport(V4.compareV4(a.t1, a.t2, b.t1, b.t2, {}, V4.cal001()));
}
function pickReport(r) {
  return {
    comparator: r.comparator, verdict: r.verdict, class: r.class, basis: r.basis,
    reasons: r.reasons, structural: r.structural, certifiable: r.certifiable,
    v3Verdict: r.v3 ? r.v3.verdict : '', topology: r.topology, totalInliers: r.totalInliers,
    geometryEvidence: r.geometryEvidence, geoMeasurable: r.geoMeasurable, geoRaw: r.geoRaw, geoCtl: r.geoCtl,
    geoMargin: r.geoMargin, geoCtlMember: r.geoCtlMember, swapped: r.swapped,
    calibration: r.calibration, calibrationId: r.calibrationId,
    models: r.models.map(m => ({ r00: m.r00, r10: m.r10, tx: m.tx, ty: m.ty,
                                 scaleQ16: m.scaleQ16, mirror: m.mirror, inliers: m.inliers })),
    coverage: r.coverage ? pickCov(r.coverage) : null,
    local: r.local ? {
      measurable: r.local.measurable, note: r.local.note, matches: r.local.matches,
      cmax: r.local.cmax, w: r.local.w, cap: r.local.cap, ctlW: r.local.ctlW,
      ctlN: r.local.ctlN, ctlMember: r.local.ctlMember, liftRaw: r.local.liftRaw,
      liftCtl: r.local.liftCtl, margin: r.local.margin, evidence: r.local.evidence,
      propRaw: r.local.propRaw, propCtl: r.local.propCtl, propMargin: r.local.propMargin,
      diversity: r.local.diversity, dA: r.local.dA, dB: r.local.dB,
      coverageA: pickCov(r.local.coverageA), coverageB: pickCov(r.local.coverageB)
    } : null
  };
}
function diff(a, b, path, out) {
  if (a === b) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff(a[k], b[k], path + '.' + k, out);
    return;
  }
  out.push(path + ': rust=' + JSON.stringify(a) + ' js=' + JSON.stringify(b));
}

console.log('\n\u001b[1mv4 cross-engine parity (native Rust reference vs JavaScript port)\u001b[0m');
const A = JS.hash(work(128, 128, 42));
const B = JS.hash(work(128, 128, 1337));
const M = JS.hash(mirror(work(128, 128, 42)));
const K = JS.hash(crop(work(128, 128, 42)));
const U = JS.hash(up2(work(128, 128, 42)));

const cases = [
  ['self (42, 42)', A, A],
  ['unrelated (42, 1337)', A, B],
  ['mirrored copy (42, mirror 42)', A, M],
  ['cropped copy (42, crop 42)', A, K],
  ['upscaled copy (42, 2x 42)', A, U],
  ['swapped order (1337, 42)', B, A],
];
for (const [name, a, b] of cases) {
  const ru = rustV4(a, b), js = jsV4(a, b);
  const d = [];
  diff(ru, js, '', d);
  ok(d.length === 0, name, d.length ? d.slice(0, 3).join(' | ') : ru.verdict + ' [' + ru.basis.join(',') + ']');
  if (d.length) console.log('    ' + d.slice(0, 12).join('\n    '));
}

console.log('\n\u001b[1mv4.1 cross-engine parity (comparator 41, CAL-003-PROPOSED)\u001b[0m');
for (const [name, a, b] of cases) {
  const ru = rustV41(a, b), js = jsV41(a, b);
  delete ru.screen; /* both engines say null; the picker omits it */
  const d = [];
  diff(ru, js, '', d);
  ok(d.length === 0, name,
     d.length ? d.slice(0, 3).join(' | ')
              : ru.verdict + ' [' + ru.basis.join(',') + '] weak=' + ru.geoWeakInliers);
  if (d.length) console.log('    ' + d.slice(0, 12).join('\n    '));
}

console.log('\n\u001b[1m' + pass + ' passed, ' + (fail ? C.r : '') + fail + ' failed\u001b[0m');
process.exit(fail ? 1 : 0);
