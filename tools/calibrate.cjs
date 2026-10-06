/* tools/calibrate.cjs — fit a pcal profile from a labelled corpus.
 *
 *     node tools/calibrate.cjs corpus.json [outdir] [--bless]
 *
 * corpus.json: { "families": [ { "name": "...", "images": ["a.png", ...] } ] }
 * Images inside one family are variants of the same work (positives);
 * images across families are unrelated works (negatives).  Paths are
 * resolved relative to the manifest.
 *
 * The tool hashes every image, compares every within-family pair and a
 * deterministic sample of cross-family pairs, then fits one monotone LUT
 * per channel (pool-adjacent-violators over the raw evidence values,
 * mapped to 0..10000) and writes the profile as JSON + encoded .pcal.
 *
 * SPEC-005.1 §24.4 gates (all required before a profile may leave
 * PROVISIONAL): >= 24 families, >= 60 images, >= 60 positive pairs, and
 * >= 10 measurable positives on every fitted channel.  Without --bless,
 * or when any gate fails, the output stays provisional
 * (CAL-051-DRAFT) — usable for experiments, refused for release. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readPng } = require('./png.cjs');
const W = require('../src/wire.cjs');
const C = require('../src/paph-js.cjs');

const GATES = { families: 24, images: 60, positives: 60, perChannel: 10 };

function die(msg) { console.error('calibrate: ' + msg); process.exit(2); }

const args = process.argv.slice(2);
const bless = args.includes('--bless');
const rest = args.filter((a) => a !== '--bless');
if (!rest[0]) die('usage: node tools/calibrate.cjs corpus.json [outdir] [--bless]');
const manifestPath = path.resolve(rest[0]);
const outDir = path.resolve(rest[1] || path.join(__dirname, '..', 'docs', 'calibration'));
const base = path.dirname(manifestPath);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const fams = manifest.families || [];

/* ---- hash the corpus ---- */
const images = [];                 /* { fam, name, fp } */
for (let f = 0; f < fams.length; f++) {
  for (const rel of fams[f].images || []) {
    const p = path.resolve(base, rel);
    const im = readPng(fs.readFileSync(p));
    const h = W.hash(im.px, im.w, im.h);
    images.push({ fam: f, name: rel, fp: { t1: h.t1, t2: h.t2 } });
  }
}
console.log('corpus: ' + fams.length + ' families, ' + images.length + ' images');

/* ---- pairs ---- */
const pos = [], neg = [];
for (let i = 0; i < images.length; i++)
  for (let j = i + 1; j < images.length; j++) {
    if (images[i].fam === images[j].fam) pos.push([i, j]);
  }
/* deterministic negative sample: first image of each family against the
 * first of every later family, then second-vs-first, until ~4x positives */
outer:
for (let round = 0; round < 4; round++)
  for (let a = 0; a < fams.length; a++)
    for (let b = a + 1; b < fams.length; b++) {
      const ia = images.findIndex((im, ix) => im.fam === a && images.slice(0, ix).filter((v) => v.fam === a).length === round);
      const ib = images.findIndex((im) => im.fam === b);
      if (ia < 0 || ib < 0) continue;
      neg.push([ia, ib]);
      if (neg.length >= 4 * Math.max(pos.length, GATES.positives)) break outer;
    }
console.log('pairs: ' + pos.length + ' positive, ' + neg.length + ' negative');

/* ---- run the comparator, collect raw evidence per channel ---- */
const CHANNELS = C.CHANNEL_ORDER.slice();
const samples = {};                /* channel -> [{x, y01}] */
for (const ch of CHANNELS) samples[ch] = [];
samples.geometry = []; samples.diversity = [];

function collect(pair, label) {
  const r = C.compare(images[pair[0]].fp, images[pair[1]].fp);
  if (r.verdict === 'Indeterminate') return;
  for (const ch of CHANNELS) {
    const c = r.channels[ch];
    if (c && c.measurable) samples[ch].push({ x: c.raw, y: label });
  }
  if (r.geometric.measurable) samples.geometry.push({ x: r.geometric.raw, y: label });
  if (r.diversity.measurable) samples.diversity.push({ x: r.diversity.value, y: label });
}
for (const p of pos) collect(p, 1);
for (const n of neg) collect(n, 0);

/* ---- monotone fit: quantile bins -> positive rate -> PAV -> knots ---- */
function fitLut(pts, name) {
  const posN = pts.filter((p) => p.y === 1).length;
  if (posN < GATES.perChannel) return { lut: C.lutIdentity(), fitted: false, posN };
  const s = pts.slice().sort((a, b) => a.x - b.x);
  const BINS = Math.min(12, Math.max(4, (s.length / 8) | 0));
  const bins = [];
  for (let b = 0; b < BINS; b++) {
    const lo = ((s.length * b) / BINS) | 0, hi = ((s.length * (b + 1)) / BINS) | 0;
    if (hi <= lo) continue;
    let sx = 0, sy = 0;
    for (let i = lo; i < hi; i++) { sx += s[i].x; sy += s[i].y; }
    bins.push({ x: sx / (hi - lo), rate: sy / (hi - lo), n: hi - lo });
  }
  /* pool adjacent violators: enforce nondecreasing rate over x */
  const blocks = [];
  for (const b of bins) {
    blocks.push({ x: b.x * b.n, rate: b.rate * b.n, n: b.n });
    while (blocks.length > 1) {
      const t = blocks[blocks.length - 1], u = blocks[blocks.length - 2];
      if (t.rate / t.n >= u.rate / u.n) break;
      u.x += t.x; u.rate += t.rate; u.n += t.n; blocks.pop();
    }
  }
  const knots = [[0, 0]];
  for (const bl of blocks) {
    const x = Math.max(1, Math.min(9999, Math.round(bl.x / bl.n)));
    const y = Math.max(0, Math.min(10000, Math.round((bl.rate / bl.n) * 10000)));
    const last = knots[knots.length - 1];
    if (x > last[0] && y >= last[1]) knots.push([x, y]);
  }
  knots.push([10000, 10000]);
  return { lut: knots, fitted: true, posN };
}

const overrides = {};
const report = [];
const map = { local: 'lutLocal', dct: 'lutDct', region: 'lutRegion', topology: 'lutTopology',
              texture: 'lutTexture', palette: 'lutPalette', spatial: 'lutSpatial',
              geometry: 'lutGeometry', diversity: 'lutDiversity' };
let starved = 0;
for (const key of Object.keys(map)) {
  const fit = fitLut(samples[key] || [], key);
  overrides[map[key]] = fit.lut;
  report.push('  ' + key.padEnd(10) + (fit.fitted ? 'fitted' : 'identity (data-starved)') +
              '  positives=' + fit.posN + ' samples=' + (samples[key] || []).length);
  if (!fit.fitted) starved++;
}
console.log('channel fits:\n' + report.join('\n'));

/* ---- gates ---- */
const gateFail = [];
if (fams.length < GATES.families) gateFail.push('families ' + fams.length + ' < ' + GATES.families);
if (images.length < GATES.images) gateFail.push('images ' + images.length + ' < ' + GATES.images);
if (pos.length < GATES.positives) gateFail.push('positive pairs ' + pos.length + ' < ' + GATES.positives);
if (starved) gateFail.push(starved + ' channel(s) data-starved');

const provisional = !bless || gateFail.length > 0;
const profile = Object.assign(C.cal(), overrides, {
  provisional,
  name: provisional ? 'CAL-051-DRAFT' : 'CAL-051'
});
try { C.profileValidate(profile); }
catch (e) { die('fitted profile fails validation: ' + e.message); }

fs.mkdirSync(outDir, { recursive: true });
const id = C.profileIdHex16(profile);
const stem = path.join(outDir, (provisional ? 'draft-' : '') + 'pcal-051-' + id);
fs.writeFileSync(stem + '.json', JSON.stringify(profile, null, 1) + '\n');
fs.writeFileSync(stem + '.pcal', C.profileEncode(profile));
console.log('wrote ' + stem + '.{json,pcal}  id=' + id + '  name=' + profile.name);

if (gateFail.length) {
  console.log('SPEC-005.1 §24.4 gates NOT met — profile stays provisional:');
  for (const g of gateFail) console.log('  - ' + g);
  if (bless) process.exit(2);
} else if (!bless) {
  console.log('gates met; rerun with --bless to emit the non-provisional profile.');
} else {
  console.log('gates met; non-provisional profile emitted.');
}
