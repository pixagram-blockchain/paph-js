/* PAPH v4 conformance harness (SPEC-004 §20, milestone M4).
 * Order is the golden file's order: the port consumed these vectors FIRST and
 * was written against them; this file keeps it that way.  Behavioural
 * end-to-end checks (verdicts on real wires) come after the vectors, and
 * cross-engine equality on full reports lives in test/parity4.mjs. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const paph = require('../src/paph3.cjs');
const v4 = require('../src/paph4.cjs');
const cal = require('../demo/cal-core.cjs');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra ? '  ' + extra : '')); }
}
function head(s) { console.log('\n\x1b[1m' + s + '\x1b[0m'); }
function deq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const G = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'golden', 'GOLDEN-004.json'), 'utf8'));

/* ---------- vectors, section by section ---------- */
head('golden: header');
ok('spec / format / comparator', G.spec === 'PAPH-SPEC-004' && G.format === 3 && G.comparator === v4.COMPARATOR && G.container === v4.CONTAINER);

head('golden: sha256');
for (const t of G.sha256)
  ok('sha256("' + t.msg.slice(0, 12) + (t.msg.length > 12 ? '…' : '') + '")',
     v4.hex(v4.sha256(Buffer.from(t.msg, 'ascii'))) === t.digest);

head('golden: hash-profile identity');
ok('hash_profile_id(defaults)', v4.hex(v4.hashProfileId(paph.DEFAULT_CONFIG)) === G.hash_profile_id_default);

head('golden: CAL-001-PROVISIONAL');
{
  const p = v4.cal001();
  const bytes = v4.profileEncode(p);
  ok('name', v4.profileName(p) === G.profile_cal001.name);
  ok('artefact bytes', v4.hex(bytes) === G.profile_cal001.bytes, bytes.length + ' B');
  ok('length', bytes.length === G.profile_cal001.len);
  ok('id', v4.hex(v4.profileId(p)) === G.profile_cal001.id);
  const q = v4.profileDecode(bytes);
  ok('decode∘encode round-trips', v4.hex(v4.profileEncode(q)) === G.profile_cal001.bytes);
  let threw = false;
  try { v4.profileValidate(q); } catch (e) { threw = true; }
  ok('decoded profile validates', !threw);
  const bad = Uint8Array.from(bytes); bad[6] = 3;
  threw = false;
  try { v4.profileDecode(bad); } catch (e) { threw = true; }
  ok('wrong comparator rejected', threw);
}

head('golden: LUT evaluation');
{
  const pts = G.lut.points;
  let all = true;
  for (let i = 0; i < G.lut.x.length; i++)
    if (v4.lutEval(pts, G.lut.x[i]) !== G.lut.y[i]) all = false;
  ok('shaped LUT at ' + G.lut.x.length + ' probes', all);
}

head('golden: assignment');
for (const c of G.assignment) {
  const got = v4.assign(c.n, c.m, c.cost);
  const total = got.reduce((s, p) => s + c.cost[p[0] * c.m + p[1]], 0);
  ok(c.n + 'x' + c.m, deq(got, c.pairs) && total === c.total,
     got.length + ' pairs, cost ' + total);
}

head('golden: LN maps');
for (const t of G.nulls_local) {
  const hi = parseInt(t.code.slice(0, 8), 16) | 0, lo = parseInt(t.code.slice(8, 16), 16) | 0;
  let all = true;
  for (const m of v4.LOCAL_FAMILY) {
    const r = v4.applyLocal(m, hi, lo);
    const hx = (r[0] >>> 0).toString(16).padStart(8, '0') + (r[1] >>> 0).toString(16).padStart(8, '0');
    if (hx !== t[m]) all = false;
  }
  ok('code ' + t.code, all);
}

head('golden: GN offsets and permutations');
{
  let all = true;
  for (const n of Object.keys(G.shift_offsets))
    if (!deq(v4.shiftOffsets(+n), G.shift_offsets[n])) all = false;
  ok('shift offsets', all);
  const corr = G.shift_apply.b.map((j, k) => ({ i: k, j: j, d: k }));
  ok('shift by 3', deq(v4.applyShift(corr, 3).map(c => c.j), G.shift_apply.shift3_b));
  ok('reversal', deq(v4.applyReverse(corr).map(c => c.j), G.shift_apply.reverse_b));
}

head('golden: coverage');
for (const t of G.coverage) {
  const pts = [];
  for (let i = 0; i < t.points.length; i += 2) pts.push([t.points[i], t.points[i + 1]]);
  const c = v4.coverage(pts, t.g);
  ok(t.name, c.occupied === t.occupied && c.coverage === t.coverage &&
             c.bboxCells === t.bbox_cells && c.concentration === t.concentration);
}

head('golden: local channel (§10)');
function bagOf(b) {
  const n = b.codes.length;
  const X = { hi: new Int32Array(n), lo: new Int32Array(n),
              x: Int32Array.from(b.x), y: Int32Array.from(b.y), n: n };
  for (let i = 0; i < n; i++) {
    X.hi[i] = parseInt(b.codes[i].slice(0, 8), 16) | 0;
    X.lo[i] = parseInt(b.codes[i].slice(8, 16), 16) | 0;
  }
  return X;
}
{
  const P = v4.cal001();
  const KEYMAP = { matches: 'matches', w: 'w', cap: 'cap', ctl_w: 'ctlW', ctl_n: 'ctlN',
                   ctl_member: 'ctlMember', lift_raw: 'liftRaw', lift_ctl: 'liftCtl',
                   margin: 'margin', evidence: 'evidence', prop_raw: 'propRaw',
                   prop_ctl: 'propCtl', diversity: 'diversity', d_a: 'dA', d_b: 'dB' };
  for (const t of G.local_v4) {
    const r = v4.localV4Bags(bagOf(t.a), bagOf(t.b), P);
    let bad = [];
    for (const k of Object.keys(KEYMAP))
      if (r[KEYMAP[k]] !== t.expect[k]) bad.push(k + '=' + r[KEYMAP[k]] + '≠' + t.expect[k]);
    if (!deq(r.pairs, t.expect.pairs)) bad.push('pairs');
    if (r.coverageA.occupied !== t.expect.coverage_a_occupied) bad.push('covA.occupied');
    if (r.coverageA.concentration !== t.expect.coverage_a_concentration) bad.push('covA.concentration');
    ok(t.name, bad.length === 0, bad.join(' '));
  }
}

head('golden: confidence (§12.2)');
{
  let all = true;
  for (const t of G.conf) if (v4.conf(t.d1, t.d2) !== t.conf) all = false;
  ok('conf table (' + G.conf.length + ' entries)', all);
}

head('golden: lattice (§14)');
for (const t of G.lattice) {
  const r = v4.latticeV4({
    identical: t.in.identical, channels: t.in.channels,
    geoMeasurable: t.in.geo_measurable, geoEvidence: t.in.geo_evidence,
    totalInliers: t.in.total_inliers, topologyClass: t.in.topology,
    diversity: t.in.diversity, coverageMin: t.in.coverage_min,
    anyMirrorModel: t.in.mirror
  }, v4.cal001());
  ok(t.name, r.state === t.expect.state && deq(r.basis, t.expect.basis) &&
             r.structural === t.expect.structural && r.certifiable === t.expect.certifiable,
     r.state + ' [' + r.basis.join(',') + ']');
}

head('golden: limits (§16)');
ok('constants', v4.MAX_WIDTH === G.limits.max_width && v4.MAX_HEIGHT === G.limits.max_height &&
                v4.MAX_PIXELS === G.limits.max_pixels);

/* ---------- end-to-end on real wires ---------- */
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
function mirrorIm({ px, w, h }) {
  const o = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + (w - 1 - x)) << 2, d = (y * w + x) << 2;
    o[d] = px[s]; o[d + 1] = px[s + 1]; o[d + 2] = px[s + 2]; o[d + 3] = px[s + 3];
  }
  return { px: o, w, h };
}

head('end-to-end: verdicts');
{
  const P = v4.cal001();
  const A = paph.hash(work(128, 128, 42));
  const B = paph.hash(work(128, 128, 1337));
  const rs = v4.compareV4(A.t1, A.t2, A.t1, A.t2, {}, P);
  ok('self is Identical', rs.verdict === 'Identical' && rs.structural === 10000 && deq(rs.basis, ['bytes']));
  ok('self local evidence', rs.local.measurable && rs.local.evidence > 7000, String(rs.local.evidence));
  ok('self geometry', rs.models.length > 0 && rs.geometryEvidence > 5000 && rs.topology >= 2,
     rs.totalInliers + ' inliers, evidence ' + rs.geometryEvidence);
  const ru = v4.compareV4(A.t1, A.t2, B.t1, B.t2, {}, P);
  ok('unrelated is not Copy/Identical', ru.verdict !== 'Copy' && ru.verdict !== 'Identical', ru.verdict);
  ok('unrelated earns less', ru.geometryEvidence < rs.geometryEvidence && ru.local.evidence < rs.local.evidence);

  const ab = v4.compareV4(A.t1, A.t2, B.t1, B.t2, {}, P);
  const ba = v4.compareV4(B.t1, B.t2, A.t1, A.t2, {}, P);
  ok('argument-order symmetry',
     ab.verdict === ba.verdict && ab.structural === ba.structural &&
     ab.geometryEvidence === ba.geometryEvidence && ab.totalInliers === ba.totalInliers &&
     ab.topology === ba.topology && ab.swapped !== ba.swapped &&
     deq(ab.local.coverageA, ba.local.coverageB) && deq(ab.local.coverageB, ba.local.coverageA));

  const M = paph.hash(mirrorIm(work(128, 128, 42)));
  const rm = v4.compareV4(A.t1, A.t2, M.t1, M.t2, {}, P);
  ok('mirrored copy carries mirror models',
     rm.models.length > 0 && rm.models.some(m => m.mirror) &&
     rm.verdict !== 'Unrelated' && rm.verdict !== 'Related', rm.verdict);
}

head('end-to-end: indeterminate and limits');
{
  const P = v4.cal001();
  const A = paph.hash(work(128, 128, 7));
  const bad = Uint8Array.from(A.t1); bad[0] ^= 0xff;
  const rc = v4.compareV4(A.t1, A.t2, bad, A.t2, {}, P);
  ok('corrupt wire → Indeterminate(CORRUPT)', rc.verdict === 'Indeterminate' && deq(rc.reasons, ['CORRUPT']));
  const rp = v4.compareV4(A.t1, A.t2, A.t1, A.t2, {}, P, new Uint8Array(32).fill(1), new Uint8Array(32).fill(2));
  ok('hash-profile mismatch', rp.verdict === 'Indeterminate' && deq(rp.reasons, ['PROFILE_MISMATCH']));
  const broken = v4.cal001(); broken.gridG = 1;
  const rb = v4.compareV4(A.t1, A.t2, A.t1, A.t2, {}, broken);
  ok('unsupported profile', rb.verdict === 'Indeterminate' && deq(rb.reasons, ['PROFILE_UNSUPPORTED']));
  let threw = '';
  try { v4.hashChecked(work(16, 16, 1), {}, [8, 8, 64]); } catch (e) { threw = String(e.message || e); }
  ok('hashChecked enforces (profiles lower only)', threw.indexOf('limit: ') === 0, threw);
  let okHash = false;
  try { okHash = !!v4.hashChecked(work(16, 16, 1), {}).t1; } catch (e) {}
  ok('hashChecked passes lawful input', okHash);
}

head('calibration core (demo/cal-core.cjs)');
{
  const P = v4.cal001();
  const A = paph.hash(work(128, 128, 42));
  const B = paph.hash(work(128, 128, 1337));
  const M = paph.hash(mirrorIm(work(128, 128, 42)));
  const mk = (a, b, cat) => {
    const r = v4.compareV4(a.t1, a.t2, b.t1, b.t2, {}, P);
    return { cat, snap: cal.makeSnapshot(r, P), report: r };
  };
  const pairs = [mk(A, A, 'A'), mk(A, M, 'B'), mk(A, B, 'H')];
  let exact = true;
  for (const p of pairs) {
    const r = cal.relattice(v4, p.snap, P);
    if (r.state !== p.report.verdict || r.localEvidence !== p.report.local.evidence ||
        r.geoEvidence !== p.report.geometryEvidence) exact = false;
  }
  ok('relattice(snapshot, CAL-001) ≡ full comparator', exact);
  const m0 = cal.metrics(v4, pairs, P);
  ok('scoreboard on the clean corpus',
     m0.falseCertEFG.length === 0 && m0.losses95.length === 0 && m0.bRecallV4 === 1 &&
     m0.byCat.A.n === 1 && m0.byCat.B.n === 1 && m0.byCat.H.n === 1);
  const hard = v4.cal001();
  hard.thresholds = P.thresholds.slice();
  /* close BOTH certification routes: the structural arms and the geo-solo
     arm (its inlier floor to the format maximum) */
  hard.thresholds[1] = 9999; hard.thresholds[4] = 10000; hard.thresholds[7] = 256;
  const m1 = cal.metrics(v4, pairs, hard);
  ok('§9.5 losses fire when a candidate drops a v3-certified copy',
     m1.losses95.length >= 1, m1.losses95.length + ' flagged');
  ok('measurement key detects a re-measure need',
     cal.measurementKey(P) === pairs[0].snap.measuredUnder &&
     cal.measurementKey(Object.assign({}, P, { geoEps: 999 })) !== pairs[0].snap.measuredUnder);
}


/* ================================================================== M6
 * SPEC-004.1 (comparator 41): golden sections first, then behaviour. */
{
  head('golden: assignment_sparse (SPEC-004.1 A2)');
  let allEq = true, allSorted = true;
  for (let i = 0; i < G.assignment_sparse.length; i++) {
    const c = G.assignment_sparse[i], cost = G.assignment[i].cost;
    const got = v4.assignSparse(c.n, c.m, cost);
    if (!deq(got, c.pairs)) allEq = false;
    const full = v4.assign(c.n, c.m, cost);
    const tot = p => p.reduce((s, e) => s + cost[e[0] * c.m + e[1]], 0);
    if (got.length !== full.length || tot(got) !== tot(full)) allEq = false;
    for (let k = 1; k < got.length; k++)
      if (got[k][0] < got[k - 1][0]) allSorted = false;
    ok('case ' + i + ' pairs+total (differs_from_full=' + c.differs_from_full + ')',
       deq(got, c.pairs) && tot(got) === c.total);
  }
  ok('sparse ≡ full in cardinality and cost on every case', allEq);
  ok('ascending row order', allSorted);

  head('golden: weak_geometry (SPEC-004.1 A1)');
  const wg = G.weak_geometry;
  const mkKp = r => {
    const d = new Uint32Array(8);
    for (let i = 0; i < 8; i++) d[i] = parseInt(r.d.slice(i * 8, i * 8 + 8), 16) >>> 0;
    return { desc: d, x: r.x, y: r.y, level: 0, sec: 0, s: 0 };
  };
  const wa = wg.a.map(mkKp), wb = wg.b.map(mkKp);
  const wo = { geoEps: 1600, geoMinCorr: 8, geoConfAt: 16, mirrorHypothesis: true };
  const wAM = paph._internal.mirrorSide(wa, 65535);
  const wpd = v4.correspondW(wa, wb), wpm = v4.correspondW(wAM, wb);
  ok('pool sizes', wpd.length === wg.pool_direct && wpm.length === wg.pool_mirror,
     wpd.length + '/' + wpm.length);
  const g41 = v4._internal.geoMeasure41(wa, wAM, wb, wpd, wpm, wo, 256, 256, 6, 4);
  ok('extraction accepts nothing', g41.mm.models.length === wg.models);
  ok('the weak signal carries the sub-floor model',
     g41.measure === wg.measure && g41.weak === wg.weak, g41.measure + '/' + g41.weak);
  const gc = v4._internal.gnControl41(wa, wAM, wb, wpd, wpm, wo, 256, 256, 6, 4);
  ok('control member ' + wg.ctl_member, gc.ctl === wg.ctl && gc.member === wg.ctl_member,
     gc.ctl + ' ' + gc.member);

  head('golden: profile_cal003 (SPEC-004.1 A3, container 2)');
  const p3c = v4.cal003();
  const b3 = v4.profileEncode(p3c);
  ok('length ' + G.profile_cal003.len, b3.length === G.profile_cal003.len);
  ok('bytes', v4.hex(b3) === G.profile_cal003.bytes);
  ok('calibration_profile_id', v4.hex(v4.profileId(p3c)) === G.profile_cal003.id);
  const q3 = v4.profileDecode(b3);
  ok('container-2 roundtrip', q3.comparator === 41 && q3.container === 2 &&
     deq(q3.lutRuns, p3c.lutRuns) && deq(q3.lutPalette, p3c.lutPalette));
  let c1rej = false;
  try { const bb = b3.slice(); bb[4] = 1; v4.profileDecode(bb); } catch (e) { c1rej = true; }
  ok('a container-1 decoder refuses it', c1rej);

  head('comparator 41: behaviour');
  const work = (seed, w, h) => {
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      px[o] = (x * 7 + y * 3 + seed) % 251; px[o + 1] = (y * 11 + x * 5) % 253;
      px[o + 2] = ((x ^ y) * 13) % 247; px[o + 3] = 255;
    }
    let s = seed;
    const rnd = m => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % Math.max(1, m); };
    for (let k = 0; k < 40; k++) {
      const bx = rnd(w - 10), by = rnd(h - 10);
      const cr = rnd(256), cg = rnd(256), cb = rnd(256);
      for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) {
        const o = ((by + dy) * w + bx + dx) * 4;
        px[o] = cr; px[o + 1] = cg; px[o + 2] = cb;
      }
    }
    return { px, w, h };
  };
  const mirrorImg = im => {
    const px = new Uint8Array(im.px.length);
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++)
      px.set(im.px.subarray((y * im.w + (im.w - 1 - x)) * 4, (y * im.w + (im.w - 1 - x)) * 4 + 4),
             (y * im.w + x) * 4);
    return { px, w: im.w, h: im.h };
  };
  const P41 = v4.cal003();
  const wi = work(5, 128, 96), wm = mirrorImg(wi);
  const fA = v4.hashChecked(wi, {}, P41.limits), fM = v4.hashChecked(wm, {}, P41.limits);
  const rSelf = v4.compareV41(fA.t1, fA.t2, fA.t1, fA.t2, {}, P41);
  ok('self → Identical under 41', rSelf.verdict === 'Identical' && rSelf.comparator === 41);
  ok('report carries geoWeakInliers and screen',
     rSelf.geoWeakInliers === 0 && rSelf.screen === null);
  const rMir = v4.compareV41(fA.t1, fA.t2, fM.t1, fM.t2, {}, P41);
  ok('mirrored copy → Copy with a mirror model',
     rMir.verdict === 'Copy' && rMir.models.some(m => m.mirror), rMir.verdict);
  const rBack = v4.compareV41(fM.t1, fM.t2, fA.t1, fA.t2, {}, P41);
  ok('argument-order symmetry', rMir.verdict === rBack.verdict &&
     rMir.structural === rBack.structural && rMir.totalInliers === rBack.totalInliers);
  const rWrong = v4.compareV41(fA.t1, fA.t2, fA.t1, fA.t2, {}, v4.cal001());
  ok('compareV41 refuses a comparator-4 profile',
     rWrong.verdict === 'Indeterminate' && rWrong.reasons[0] === v4.R_PROFILE_UNSUPPORTED);
  const rWrong4 = v4.compareV4(fA.t1, fA.t2, fA.t1, fA.t2, {}, P41);
  ok('compareV4 refuses a comparator-41 profile',
     rWrong4.verdict === 'Indeterminate' && rWrong4.reasons[0] === v4.R_PROFILE_UNSUPPORTED);
  head('comparator 41: the bench loop is the comparator');
  {
    const wu = work(1337, 128, 96);
    const fU = v4.hashChecked(wu, {}, P41.limits);
    const trio = [[fA, fA, 'self'], [fA, fM, 'mirrored'], [fA, fU, 'unrelated']];
    let exact = true, detail = '';
    for (const [x, y, nm] of trio) {
      const full = v4.compareV41(x.t1, x.t2, y.t1, y.t2, {}, P41);
      const snap = cal.makeSnapshot41(full, P41,
        v4.compareV4(x.t1, x.t2, y.t1, y.t2, {}, v4.cal001()));
      const re = cal.relattice41(v4, snap, P41);
      if (re.state !== full.verdict || re.structural !== full.structural ||
          re.geoEvidence !== full.geometryEvidence ||
          re.localEvidence !== full.local.evidence ||
          re.basis.join('+') !== full.basis.join('+')) {
        exact = false; detail = nm + ': ' + re.state + ' vs ' + full.verdict;
      }
    }
    ok('relattice41(snapshot, CAL-003) ≡ compareV41', exact, detail);
    /* the per-channel tables must actually reach the lattice through the
       snapshot path, or the bench would silently tune nothing */
    const flat = v4.cal003();
    flat.lutRuns = [[0, 0], [10000, 0]];
    const fullFlat = v4.compareV41(fA.t1, fA.t2, fU.t1, fU.t2, {}, flat);
    const snapFlat = cal.makeSnapshot41(
      v4.compareV41(fA.t1, fA.t2, fU.t1, fU.t2, {}, P41), P41);
    const reFlat = cal.relattice41(v4, snapFlat, flat);
    ok('a table edit moves the bench exactly as it moves the comparator',
       reFlat.structural === fullFlat.structural && reFlat.state === fullFlat.verdict,
       reFlat.structural + ' vs ' + fullFlat.structural);
  }

  const sc = v4.screenV41(fA.t1, fA.t2, fA.t1, fA.t2, {}, P41);
  ok('screen: self passes with the pool rule',
     sc.pass === true && sc.poolDirect >= 8, sc.poolDirect + '/' + sc.poolMirror);
}

console.log('\n\x1b[1m' + pass + ' passed, ' + (fail ? '\x1b[31m' : '') + fail + ' failed\x1b[0m');
process.exit(fail ? 1 : 0);
