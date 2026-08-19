/*! cal-core.js — PAPH v4 calibration core (SPEC-004 §19, milestone M5 tooling).
 *
 *  The pure logic under demo/paph4-calibration.html, kept engine-adjacent and
 *  requireable from node so test/v4.cjs can hold it to the one invariant the
 *  whole bench rests on: a pair's verdict recomputed from its SNAPSHOT under a
 *  profile equals the verdict the full comparator produces under that profile.
 *
 *  A snapshot stores everything the §14 lattice consumes EXCEPT the outputs of
 *  the three calibration LUTs — those are re-derived live from the stored raw
 *  margins, which is what makes threshold and LUT tuning instant over a whole
 *  corpus.  Fields that change the MEASUREMENT itself (hash-time fields,
 *  hammingT, confidence anchors, geoEps, model floors, gridG) are recorded as
 *  the profile the pair was measured under; editing those requires
 *  re-measuring from the stored wires, and the bench says so.  MIT. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.calCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var SCALE = 10000;
var CHANNEL_ORDER = ['dct', 'local', 'shape', 'topology', 'runs', 'palette', 'silhouette'];

/* §19.1 — the corpus partition.  A–D are positives, E–I negatives. */
var CATEGORIES = [
  { key: 'A', name: 'exact duplicates', positive: true },
  { key: 'B', name: 'benign transformations', positive: true },
  { key: 'C', name: 'partial copies', positive: true },
  { key: 'D', name: 'collages', positive: true },
  { key: 'E', name: 'same-generator negatives', positive: false },
  { key: 'F', name: 'repeated-pattern negatives', positive: false },
  { key: 'G', name: 'shared-template negatives', positive: false },
  { key: 'H', name: 'random unrelated', positive: false },
  { key: 'I', name: 'adversarial hard negatives', positive: false }
];
function isPositive(cat) { return 'ABCD'.indexOf(cat) >= 0; }

var RANK = { Indeterminate: 0, Unrelated: 1, Related: 2, Suspected: 3, Copy: 4, Identical: 5 };
function certified(v) { return v === 'Copy' || v === 'Identical'; }
function atLeastSuspected(v) { return RANK[v] >= RANK.Suspected; }

/* The measurement-side profile fields: identical values ⇒ snapshots transfer;
   any difference ⇒ the pair must be re-measured from its wires. */
var MEASUREMENT_FIELDS = ['hammingT', 'confidenceAt', 'geoConfAt', 'geoEps',
                          'geoMinCorr', 'minModelInliers', 'maxModels', 'gridG'];
function measurementKey(P) {
  return MEASUREMENT_FIELDS.map(function (f) { return f + ':' + P[f]; }).join(' ');
}

/* Everything the lattice consumes, with LUT outputs left OUT and their raw
   inputs kept IN. */
function makeSnapshot(report, P) {
  var six = [];
  for (var i = 0; i < 7; i++) {
    var name = CHANNEL_ORDER[i];
    if (name === 'local') continue;
    var ch = report.v3.channels[name];
    six.push([name, ch.value, ch.measurable]);
  }
  return {
    identical: report.v3.identical,
    six: six,
    localMeasurable: report.local.measurable,
    localMargin: report.local.margin,
    diversity: report.local.diversity,
    coverageMin: Math.min(report.local.coverageA.coverage, report.local.coverageB.coverage),
    geoMargin: report.geoMargin,
    geoRaw: report.geoRaw,
    geoCtl: report.geoCtl,
    totalInliers: report.totalInliers,
    topology: report.topology,
    anyMirror: report.models.some(function (m) { return m.mirror; }),
    geoMeas: report.geoMeasurable,
    v3Verdict: report.v3.verdict,
    v3Structural: report.v3.structural,
    measuredUnder: measurementKey(P)
  };
}

/* The instant loop: LUTs and lattice under a CANDIDATE profile, from a
   snapshot.  Mirrors compareV4's tail exactly — test/v4.cjs proves it. */
function relattice(v4, snap, P) {
  var localEv = 0;
  if (snap.localMeasurable)
    localEv = Math.trunc(v4.lutEval(P.lutLocal, snap.localMargin) *
                         v4.lutEval(P.lutDiversity, snap.diversity) / SCALE);
  var geoEv = v4.lutEval(P.lutGeometry, snap.geoMargin);
  var channels = [];
  var k = 0;
  for (var i = 0; i < 7; i++) {
    var name = CHANNEL_ORDER[i];
    if (name === 'local') channels.push(['local', localEv, snap.localMeasurable]);
    else { channels.push(snap.six[k]); k++; }
  }
  var out = v4.latticeV4({
    identical: snap.identical, channels: channels,
    geoMeasurable: snap.geoMeas, geoEvidence: geoEv,
    totalInliers: snap.totalInliers, topologyClass: snap.topology,
    diversity: snap.diversity, coverageMin: snap.coverageMin,
    anyMirrorModel: snap.anyMirror
  }, P);
  out.localEvidence = localEv;
  out.geoEvidence = geoEv;
  return out;
}

/* ------------------------------------------------------------ comparator 41
   SPEC-004.1: same snapshot idea, two differences.  The six non-local
   channels keep their RAW values in the snapshot and pass through the
   profile's per-channel tables at relattice time (A3), and the geometry
   measurement may be the weak signal (A1), which the snapshot records so the
   bench can show which pairs lean on it.  `v4Verdict` is optional: pass a
   comparator-4 report and the bench can show the demotion ledger. */
function makeSnapshot41(report, P, reportV4) {
  var s = makeSnapshot(report, P);
  s.comparator = 41;
  s.geoWeak = report.geoWeakInliers || 0;
  s.v4Verdict = reportV4 ? reportV4.verdict : null;
  s.v4Basis = reportV4 ? reportV4.basis.join('+') : null;
  return s;
}

function relattice41(v4, snap, P) {
  var localEv = 0;
  if (snap.localMeasurable)
    localEv = Math.trunc(v4.lutEval(P.lutLocal, snap.localMargin) *
                         v4.lutEval(P.lutDiversity, snap.diversity) / SCALE);
  var geoEv = v4.lutEval(P.lutGeometry, snap.geoMargin);
  var channels = [], k = 0;
  for (var i = 0; i < 7; i++) {
    var name = CHANNEL_ORDER[i];
    if (name === 'local') { channels.push(['local', localEv, snap.localMeasurable]); continue; }
    var six = snap.six[k]; k++;
    channels.push([six[0], v4.lutEval(v4.lutChannel(P, six[0]), six[1]), six[2]]);
  }
  var out = v4.latticeV4({
    identical: snap.identical, channels: channels,
    geoMeasurable: snap.geoMeas, geoEvidence: geoEv,
    totalInliers: snap.totalInliers, topologyClass: snap.topology,
    diversity: snap.diversity, coverageMin: snap.coverageMin,
    anyMirrorModel: snap.anyMirror
  }, P);
  out.localEvidence = localEv;
  out.geoEvidence = geoEv;
  out.channels = channels;
  return out;
}

/* The 4.1 scoreboard.  CERTIFIED and AT-REVIEW are reported separately and
   named separately — they are different questions, and reading one as the
   other is how a calibration gets mis-sold. */
function metrics41(v4, pairs, P) {
  var out = {
    n: pairs.length, stale: 0,
    falseCert: [], byCat: {}, arms: {},
    certB: 0, nB: 0, atRevB: 0, certCD: 0, nCD: 0, atRevCD: 0,
    reviewPos: [], reviewNeg: [], lostVs4: [], demotedVs4: [],
    negStructMax: 0, weakUsed: 0, weakPos: 0
  };
  var mkey = measurementKey(P);
  CATEGORIES.forEach(function (c) {
    out.byCat[c.key] = { n: 0, cert: 0, review: 0, below: 0 };
  });
  pairs.forEach(function (p, idx) {
    var r = relattice41(v4, p.snap, P);
    p.live = r;
    var v = r.state, pos = isPositive(p.cat);
    if (p.snap.measuredUnder !== mkey) out.stale++;
    if (!out.byCat[p.cat]) out.byCat[p.cat] = { n: 0, cert: 0, review: 0, below: 0 };
    var b = out.byCat[p.cat];
    b.n++;
    if (certified(v)) b.cert++; else if (v === 'Suspected') b.review++; else b.below++;
    if (certified(v)) {
      var arm = v + ':' + r.basis.join('+');
      out.arms[arm] = (out.arms[arm] || 0) + 1;
    }
    if (p.snap.geoWeak > 0) { out.weakUsed++; if (pos) out.weakPos++; }
    if (pos) {
      if (p.cat === 'B') { out.nB++; if (certified(v)) out.certB++; if (atLeastSuspected(v)) out.atRevB++; }
      if (p.cat === 'C' || p.cat === 'D') { out.nCD++; if (certified(v)) out.certCD++; if (atLeastSuspected(v)) out.atRevCD++; }
      if (v === 'Suspected') out.reviewPos.push(idx);
      if (p.snap.v4Verdict && certified(p.snap.v4Verdict) && !certified(v)) {
        (v === 'Suspected' ? out.demotedVs4 : out.lostVs4).push(idx);
      }
    } else {
      if (certified(v)) out.falseCert.push(idx);
      if (v === 'Suspected') out.reviewNeg.push(idx);
      if (r.structural > out.negStructMax) out.negStructMax = r.structural;
    }
  });
  return out;
}

/* §19.3 + §9.5 — the whole scoreboard, per category, plus the two hard gates
   and the before/after recall table the aggregation flip owes. */
function metrics(v4, pairs, P) {
  var states = ['Identical', 'Copy', 'Suspected', 'Related', 'Unrelated', 'Indeterminate'];
  var byCat = {};
  CATEGORIES.forEach(function (c) {
    byCat[c.key] = { n: 0, states: { Identical: 0, Copy: 0, Suspected: 0, Related: 0, Unrelated: 0, Indeterminate: 0 } };
  });
  var falseCertEFG = [], falseCertHI = [], losses95 = [], misses = [];
  var reviewPos = 0, reviewNeg = 0;
  var bV4 = { hit: 0, n: 0 }, bV3 = { hit: 0, n: 0 };
  var cdV4 = { hit: 0, n: 0 }, cdV3 = { hit: 0, n: 0 };
  var stale = 0;
  var mkey = measurementKey(P);

  pairs.forEach(function (p, idx) {
    if (!byCat[p.cat]) return;
    var r = relattice(v4, p.snap, P);
    var v = r.state;
    p.live = r; /* the bench reads this back for the ledger */
    byCat[p.cat].n++;
    byCat[p.cat].states[v]++;
    if (p.snap.measuredUnder !== mkey) stale++;
    var pos = isPositive(p.cat);
    if (pos) {
      if (certified(p.snap.v3Verdict) && !certified(v)) losses95.push(idx);
      if (!atLeastSuspected(v)) misses.push(idx);
      if (v === 'Suspected') reviewPos++;
      if (p.cat === 'B') { bV4.n++; bV3.n++; if (atLeastSuspected(v)) bV4.hit++; if (atLeastSuspected(p.snap.v3Verdict)) bV3.hit++; }
      if (p.cat === 'C' || p.cat === 'D') { cdV4.n++; cdV3.n++; if (atLeastSuspected(v)) cdV4.hit++; if (atLeastSuspected(p.snap.v3Verdict)) cdV3.hit++; }
    } else {
      if (certified(v)) {
        if ('EFG'.indexOf(p.cat) >= 0) falseCertEFG.push(idx); else falseCertHI.push(idx);
      }
      if (v === 'Suspected') reviewNeg++;
    }
  });

  return {
    states: states, byCat: byCat,
    falseCertEFG: falseCertEFG, falseCertHI: falseCertHI,
    losses95: losses95, misses: misses,
    reviewPos: reviewPos, reviewNeg: reviewNeg,
    bRecallV4: bV4.n ? bV4.hit / bV4.n : null, bRecallV3: bV3.n ? bV3.hit / bV3.n : null,
    cdRecallV4: cdV4.n ? cdV4.hit / cdV4.n : null, cdRecallV3: cdV3.n ? cdV3.hit / cdV3.n : null,
    bN: bV4.n, cdN: cdV4.n, stale: stale, total: pairs.length
  };
}

return { SCALE: SCALE, CHANNEL_ORDER: CHANNEL_ORDER, CATEGORIES: CATEGORIES,
         RANK: RANK, isPositive: isPositive, certified: certified,
         atLeastSuspected: atLeastSuspected,
         MEASUREMENT_FIELDS: MEASUREMENT_FIELDS, measurementKey: measurementKey,
         makeSnapshot: makeSnapshot, relattice: relattice, metrics: metrics,
         makeSnapshot41: makeSnapshot41, relattice41: relattice41, metrics41: metrics41 };
});
