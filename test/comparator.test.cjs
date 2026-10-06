'use strict';
var W = require('../src/wire.cjs');
var C = require('../src/paph-js.cjs');
var F = require('./fixtures.cjs');
var A = require('assert');
var I = W._internal;

function fp(im, opts) { var h = W.hash(im.px, im.w, im.h, opts); return { t1: h.t1, t2: h.t2 }; }
var results = [];
function T(name, fn) {
  try { fn(); results.push([name, true]); }
  catch (e) { results.push([name, false, e && (e.stack ? e.message : String(e))]); }
}
function fixCrcT1(t1) {
  var c = I.crc32(t1, 0, t1.length - 4);
  t1[2556] = c & 255; t1[2557] = (c >>> 8) & 255;
  t1[2558] = (c >>> 16) & 255; t1[2559] = (c >>> 24) & 255;
  return t1;
}

var S0 = F.sprite(150, 110, 7);
var fS0 = fp(S0);

T('identical bytes -> Identical / IDENTICAL_BYTES', function () {
  var r = C.compare(fS0, fS0);
  A.strictEqual(r.verdict, 'Identical');
  A.strictEqual(r.evidenceClass, 'IDENTICAL_BYTES');
  A.strictEqual(r.structural.value, C.SCALE);
});

T('re-hash of identical pixels -> Identical', function () {
  A.strictEqual(C.compare(fS0, fp(F.sprite(150, 110, 7))).verdict, 'Identical');
});

T('all eight D4 elements certify and name the forward element', function () {
  for (var k = 1; k < 8; k++) {
    var r = C.compare(fS0, fp(F.d4(S0, k)));
    A.strictEqual(r.verdict, 'Copy', 'k=' + k + ' verdict ' + r.verdict + ' (' + r.basis.join(';') + ')');
    A.ok(r.geometric.models.length >= 1, 'k=' + k + ' no model');
    var m = r.geometric.models[0];
    A.strictEqual(m.m, k, 'k=' + k + ' primary element ' + m.m);
    A.strictEqual(m.rotation, I.D4_QUARTER[k] * 90, 'rotation label');
    A.strictEqual(m.mirrored, !!I.D4_MIRROR[k], 'mirror label');
    A.ok(Math.abs(m.scaleMilli - 1000) <= 12, 'k=' + k + ' scale ' + m.scaleMilli);
    A.strictEqual(r.channels.dct.matchedK, k, 'dct k');
    A.strictEqual(r.channels.local.alignedK, k, 'local alignment k');
  }
});

T('luminance inversion runs the inverted family and certifies', function () {
  var r = C.compare(fS0, fp(F.invert(S0)));
  A.strictEqual(r.verdict, 'Copy', r.basis.join(';'));
  A.ok(r.geometric.invertedFamilyRan, 'family gate');
  A.ok(r.geometric.models[0].inverted, 'primary inverted');
  A.ok(r.channels.local.alignedInverted, 'local aligned inverted');
});

T('tone shift is measured and does not defeat certification', function () {
  var r = C.compare(fS0, fp(F.shiftLum(S0, 40)));
  A.strictEqual(r.verdict, 'Copy', r.basis.join(';'));
  A.ok(Math.abs(r.brightness.shift + 40) <= 4, 'brightness shift ' + r.brightness.shift);
  A.ok(Math.abs(r.channels.palette.toneShift + 40) <= 6, 'palette shift ' + r.channels.palette.toneShift);
});

T('pixel-perfect upscales: equal content tags, certified', function () {
  var r2 = C.compare(fS0, fp(F.upscale(S0, 2)));
  var r3 = C.compare(fS0, fp(F.upscale(S0, 3)));
  A.strictEqual(r2.contentTags[0], r2.contentTags[1], '2x tag');
  A.strictEqual(r3.contentTags[0], r3.contentTags[1], '3x tag');
  A.ok(r2.verdict === 'Copy' || r2.verdict === 'Identical', '2x ' + r2.verdict);
  A.ok(r3.verdict === 'Copy' || r3.verdict === 'Identical', '3x ' + r3.verdict);
});

T('small pasted crop: flagged, never certified blindly', function () {
  var host = F.noise(200, 160, 777);
  var comp = F.pasteCrop(S0, 16, 16, 64, 48, host, 80, 60);
  var r = C.compare(fS0, fp(comp));
  A.ok(r.verdict === 'Suspected' || r.verdict === 'Related', r.verdict);
  A.ok(r.assetRisk.level !== 'LOW', 'asset risk ' + r.assetRisk.level);
  A.ok(r.geometric.models.length >= 1 && r.geometric.models[0].m === 0);
});

T('large pasted crop certifies through geometry', function () {
  var host = F.noise(200, 160, 778);
  var comp = F.pasteCrop(S0, 8, 4, 128, 100, host, 40, 30);
  var r = C.compare(fS0, fp(comp));
  A.strictEqual(r.verdict, 'Copy', r.verdict + ' (' + r.basis.join(';') + ')');
  A.ok(r.evidenceClass === 'GEO_ONLY' || r.evidenceClass === 'STRUCT_GEO', r.evidenceClass);
});

T('true negatives stay below Suspected', function () {
  var pairs = [
    ['sprite vs noise', fS0, fp(F.noise(150, 110, 3))],
    ['sprite vs stripes', fS0, fp(F.stripes(150, 110, 4))],
    ['sprite vs sprite2', fS0, fp(F.sprite(150, 110, 91))],
    ['tiles vs sprite', fp(F.tiles(160, 120, 42)), fS0]
  ];
  pairs.forEach(function (p) {
    var r = C.compare(p[1], p[2]);
    A.ok(r.verdict === 'Unrelated' || r.verdict === 'Related',
      p[0] + ' -> ' + r.verdict + ' S=' + r.structural.value + ' G=' + r.geometric.value);
    A.ok(r.geometric.value < 3500, p[0] + ' G=' + r.geometric.value);
  });
});

T('screen: rejects the unrelated, passes every true transform', function () {
  A.strictEqual(C.screen(fS0, fp(F.noise(150, 110, 3))).verdict, 'REJECT', 'noise');
  for (var k = 0; k < 8; k++)
    A.strictEqual(C.screen(fS0, fp(F.d4(S0, k))).verdict, 'PASS', 'd4 k=' + k);
  A.strictEqual(C.screen(fS0, fp(F.invert(S0))).verdict, 'PASS', 'inversion');
  A.strictEqual(C.screen(fS0, fp(F.shiftLum(S0, 40))).verdict, 'PASS', 'tone');
});

T('symmetry: swapped call maps field-exactly onto the canonical one', function () {
  var fB = fp(F.d4(S0, 5));
  var rab = C.compare(fS0, fB), rba = C.compare(fB, fS0);
  A.strictEqual(rab.swapped !== rba.swapped, true, 'exactly one direction is the swap');
  A.strictEqual(rab.verdict, rba.verdict);
  A.strictEqual(rab.structural.value, rba.structural.value);
  A.strictEqual(rab.geometric.value, rba.geometric.value);
  A.strictEqual(rab.diversity.value, rba.diversity.value);
  ['dct', 'region', 'texture', 'spatial'].forEach(function (n) {
    A.strictEqual(rab.channels[n].margin, rba.channels[n].margin, n + ' margin');
    A.strictEqual(C._internal.D4INV[rab.channels[n].matchedK], rba.channels[n].matchedK, n + ' k inverse');
  });
  A.strictEqual(rab.channels.palette.toneShift, -rba.channels.palette.toneShift);
  A.strictEqual(rab.brightness.shift, -rba.brightness.shift);
  var ma = rab.geometric.models[0], mb = rba.geometric.models[0];
  A.strictEqual(C._internal.D4INV[ma.m], mb.m, 'model element inverse');
  A.strictEqual(ma.inliers, mb.inliers);
  A.strictEqual(ma.indep, mb.indep);
  A.ok(Math.abs(ma.scaleMilli * mb.scaleMilli - 1000000) <= 4000, 'reciprocal scales');
  A.deepStrictEqual(ma.pairs.map(function (p) { return [p[1], p[0]]; }).sort(),
                    mb.pairs.slice().sort(), 'inlier pairs mirror');
  A.deepStrictEqual(rab.coverage.a, rba.coverage.b);
  A.deepStrictEqual(rab.coverage.b, rba.coverage.a);
});

T('structural-only: geometry and local abstain, structure still speaks', function () {
  var r = C.compare({ t1: fS0.t1 }, { t1: fp(F.d4(S0, 3)).t1 });
  A.strictEqual(r.geometric.measurable, false);
  A.strictEqual(r.channels.local.measurable, false);
  A.ok(r.verdict === 'Copy' || r.verdict === 'Suspected', r.verdict);
  A.ok(/both sides/.test(r.geometric.note));
  var r1 = C.compare(fS0, { t1: fp(F.d4(S0, 3)).t1 });
  A.ok(/side B/.test(r1.geometric.note), r1.geometric.note);
});

T('extraction profile mismatch -> Indeterminate PROFILE_MISMATCH', function () {
  var t1 = fixCrcT1(new Uint8Array(fS0.t1));
  t1[16] ^= 0xff; fixCrcT1(t1);
  var r = C.compare({ t1: t1 }, fS0);
  A.strictEqual(r.verdict, 'Indeterminate');
  A.deepStrictEqual(r.reasons, ['PROFILE_MISMATCH']);
});

T('legacy wire -> Indeterminate WIRE_UNSUPPORTED', function () {
  var t1 = new Uint8Array(fS0.t1); t1[4] = 4; fixCrcT1(t1);
  var r = C.compare({ t1: t1 }, fS0);
  A.strictEqual(r.verdict, 'Indeterminate');
  A.deepStrictEqual(r.reasons, ['WIRE_UNSUPPORTED']);
});

T('corruption -> Indeterminate CORRUPT (crc and tier linkage)', function () {
  var t1 = new Uint8Array(fS0.t1); t1[400] ^= 1;
  var r = C.compare({ t1: t1 }, fS0);
  A.strictEqual(r.verdict, 'Indeterminate');
  A.deepStrictEqual(r.reasons, ['CORRUPT']);
  var other = fp(F.sprite(150, 110, 8));
  var r2 = C.compare({ t1: fS0.t1, t2: other.t2 }, fS0);
  A.strictEqual(r2.verdict, 'Indeterminate');
  A.deepStrictEqual(r2.reasons, ['CORRUPT']);
  A.ok(/linkage/.test(r2.note), r2.note);
});

T('work budget: zero-hypothesis stop degrades geometry, not the verdict', function () {
  var P = C.cal(); P.workBudget = 1;
  var r = C.compare(fS0, fp(F.d4(S0, 5)), { profile: P });
  A.notStrictEqual(r.verdict, 'Indeterminate');
  A.strictEqual(r.geometric.measurable, false);
  A.ok(r.reasons.indexOf('WORK_LIMIT') >= 0, r.reasons.join(','));
});

T('determinism: two runs, one JSON', function () {
  var fB = fp(F.d4(S0, 6));
  A.strictEqual(JSON.stringify(C.compare(fS0, fB)), JSON.stringify(C.compare(fS0, fB)));
});

T('pcal validation refuses malformed profiles', function () {
  var P = C.cal();
  A.doesNotThrow(function () { C.profileValidate(P); });
  var b1 = C.cal(); b1.lutLocal = [[0, 0]];
  A.throws(function () { C.profileValidate(b1); }, /2\.\.33/);
  var b2 = C.cal(); b2.lutDct = [[0, 5000], [4000, 200], [10000, 10000]];
  A.throws(function () { C.profileValidate(b2); }, /monotone/);
  var b3 = C.cal(); b3.comparator = 4;
  A.throws(function () { C.profileValidate(b3); }, /comparator/);
  var b4 = C.cal(); b4.ratioNum = 100; b4.ratioDen = 100;
  A.throws(function () { C.profileValidate(b4); }, /Lowe/);
  var b5 = C.cal(); b5.weights = [1, 2, 3];
  A.throws(function () { C.profileValidate(b5); }, /weights/);
  var enc = C.profileEncode(P);
  A.strictEqual(C.profileIdHex16(C.profileDecode(enc)), C.profileIdHex16(P));
  var bad = new Uint8Array(enc); bad[8] = 0;              /* name byte */
  A.notStrictEqual(C.profileIdHex16(C.profileDecode(fixName(bad))) , undefined);
  function fixName(b) { b[8] = 65; return b; }            /* still decodes */
});

T('lattice unit: paths and the R2 ruling V-1', function () {
  var L = C._internal.latticeVerdict, P = C.cal();
  function geo(v, inl, indep, models) {
    return { measurable: true, value: v, totalInliers: inl, independentEvidence: indep,
             models: models || [], topology: { primaryShare: 10000 } };
  }
  var noDiv = { measurable: false, value: 0, repetitionExtreme: false, components: null };
  var okDiv = { measurable: true, value: 6000, repetitionExtreme: false,
                components: { Dunique: 8000, Dspace: 6000 } };
  var repDiv = { measurable: true, value: 6000, repetitionExtreme: true,
                 components: { Dunique: 8000, Dspace: 6000 } };
  var S = function (v) { return { measurable: true, value: v }; };
  var mod = function (indep) { return { resMedBucket: 1, indep: indep,
    corr: [{ bx: 100, by: 100 }, { bx: 2000, by: 300 }, { bx: 3000, by: 3000 }, { bx: 900, by: 2500 }] }; };
  /* SG */
  var r = L({ S: S(5000), geo: geo(4000, 20, 15, [mod(15)]), div: okDiv, secondaries: 4 }, P);
  A.strictEqual(r.verdict, 'Copy'); A.strictEqual(r.evidenceClass, 'STRUCT_GEO');
  /* SS without geometry */
  r = L({ S: S(7000), geo: { measurable: false, value: 0, models: [], totalInliers: 0,
          independentEvidence: 0, topology: {} }, div: noDiv, secondaries: 3 }, P);
  A.strictEqual(r.verdict, 'Copy'); A.strictEqual(r.evidenceClass, 'STRUCT_SOLO');
  /* GO */
  r = L({ S: S(2000), geo: geo(4000, 14, 14, [mod(14)]), div: okDiv, secondaries: 1 }, P);
  A.strictEqual(r.verdict, 'Copy'); A.strictEqual(r.evidenceClass, 'GEO_ONLY');
  /* R2: extreme repetition with thin indep caps SG to Suspected */
  r = L({ S: S(5000), geo: geo(4000, 20, 8, [mod(8)]), div: repDiv, secondaries: 4 }, P);
  A.strictEqual(r.verdict, 'Suspected');
  A.ok(r.reasons.indexOf('R2_REPETITION') >= 0);
  /* R2 exemption: rich indep survives */
  r = L({ S: S(5000), geo: geo(4000, 20, 15, [mod(15)]), div: repDiv, secondaries: 4 }, P);
  A.strictEqual(r.verdict, 'Copy');
});

var pass = results.filter(function (r) { return r[1]; }).length;
results.forEach(function (r) {
  console.log((r[1] ? 'PASS ' : 'FAIL ') + r[0] + (r[1] ? '' : '  -- ' + r[2]));
});
console.log('comparator: ' + pass + '/' + results.length);
if (pass !== results.length) process.exit(1);
