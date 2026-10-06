'use strict';
var W = require('../src/wire.cjs');
var F = require('./fixtures.cjs');
var A = require('assert');
var I = W._internal;

function fp(im, opts) { return W.hash(im.px, im.w, im.h, opts); }
var results = [];
function T(name, fn) {
  try { fn(); results.push([name, true]); }
  catch (e) { results.push([name, false, e && e.message]); }
}

var im = F.sprite(150, 110, 7);

T('roundtrip: t1/t2 parse back to themselves', function () {
  var h = fp(im);
  var d1 = W.parseT1(h.t1), d2 = W.parseT2(h.t2);
  A.strictEqual(d1.width, 150); A.strictEqual(d1.height, 110);
  A.strictEqual(d2.count, d1.kpCount);
  A.strictEqual(d2.t1crc, d1.crc);
  A.strictEqual(d1.profileId8, d2.profileId8);
});

T('determinism: same pixels, same bytes', function () {
  var a = fp(F.sprite(150, 110, 7)), b = fp(F.sprite(150, 110, 7));
  A.deepStrictEqual(Array.from(a.t1), Array.from(b.t1));
  A.deepStrictEqual(Array.from(a.t2), Array.from(b.t2));
  A.strictEqual(a.fingerprintId, b.fingerprintId);
});

T('region codes: exact D4 multiset invariance on 64-divisible dims', function () {
  /* the region grid and its 8x8 sub-blocks partition EXACTLY only when both
   * dimensions divide 64; there the D4-canonical codes must be a strictly
   * identical multiset under every image D4 element.  Other dimensions get
   * off-by-one partition drift that the comparator's regionT absorbs. */
  var sq = F.sprite(128, 128, 7);
  var h0 = fp(sq), codes0 = I.readRegionCodes(W.parseT1(h0.t1));
  var set0 = codes0.map(function (c) { return c[0] + ':' + c[1]; }).sort();
  for (var k = 1; k < 8; k++) {
    var hk = fp(F.d4(sq, k)), ck = I.readRegionCodes(W.parseT1(hk.t1));
    var sk = ck.map(function (c) { return c[0] + ':' + c[1]; }).sort();
    A.deepStrictEqual(sk, set0, 'region code multiset differs at k=' + k);
  }
});

T('coarse folds survive D4 and inversion (>=60% multiset overlap)', function () {
  /* fold16 is exactly invariant per descriptor, but sub-top pyramid levels
   * resample on integer boundaries that are not mirror-symmetric for
   * non-divisible dimensions, so a fraction of descriptors perturbs under
   * D4; NMS coordinate tie-breaks add selection drift.  The screen floors
   * sit at 6 of 128, so the wire contract is substantial survival. */
  function folds(h) { return Array.from(I.readCoarseFolds(W.parseT1(h.t1)))
                                 .filter(function (v) { return v !== 0; }); }
  function overlap(a, b) {
    var m = new Map(); a.forEach(function (v) { m.set(v, (m.get(v) || 0) + 1); });
    var hit = 0;
    b.forEach(function (v) { var c = m.get(v) || 0; if (c > 0) { hit++; m.set(v, c - 1); } });
    return hit / Math.max(a.length, b.length, 1);
  }
  var f0 = folds(fp(im));
  for (var k = 1; k < 8; k++) {
    var ov = overlap(f0, folds(fp(F.d4(im, k))));
    A.ok(ov >= 0.6, 'fold overlap under k=' + k + ' only ' + ov.toFixed(3));
  }
  var oi = overlap(f0, folds(fp(F.invert(im))));
  A.ok(oi >= 0.6, 'fold overlap under inversion only ' + oi.toFixed(3));
});

T('CRC tamper is detected on both tiers', function () {
  var h = fp(im);
  var t1 = new Uint8Array(h.t1); t1[300] ^= 0xff;
  A.throws(function () { W.parseT1(t1); }, /checksum/);
  var t2 = new Uint8Array(h.t2); t2[100] ^= 1;
  A.throws(function () { W.parseT2(t2); }, /checksum/);
});

T('W-2: tier-2 reserved bits must be zero', function () {
  var h = fp(im);
  var t2 = new Uint8Array(h.t2);
  t2[32 + 30] = 1;                                   /* first record, reserved */
  var c = I.crc32(t2, 32, t2.length);
  t2[28] = c & 255; t2[29] = (c >>> 8) & 255; t2[30] = (c >>> 16) & 255; t2[31] = (c >>> 24) & 255;
  A.throws(function () { W.parseT2(t2); }, /reserved/);
});

T('unsupported wire version raises WIRE_UNSUPPORTED', function () {
  var h = fp(im);
  var t1 = new Uint8Array(h.t1); t1[4] = 4;
  var c = I.crc32(t1, 0, t1.length - 4);
  t1[2556] = c & 255; t1[2557] = (c >>> 8) & 255; t1[2558] = (c >>> 16) & 255; t1[2559] = (c >>> 24) & 255;
  try { W.parseT1(t1); A.fail('should throw'); }
  catch (e) { A.strictEqual(e.code, 'WIRE_UNSUPPORTED'); }
});

T('pixel-perfect upscales fold to the same content tag', function () {
  var h1 = fp(im), h2 = fp(F.upscale(im, 2)), h3 = fp(F.upscale(im, 3));
  var d1 = W.parseT1(h1.t1), d2 = W.parseT1(h2.t1), d3 = W.parseT1(h3.t1);
  A.strictEqual(d2.contentTag, d1.contentTag, '2x');
  A.strictEqual(d3.contentTag, d1.contentTag, '3x');
  A.ok(d2.flags & 4, 'F_UPSCALED set on 2x');
});

T('matte folding: no-op without a matte, folds and flags with one', function () {
  var nz = F.noise(120, 90, 5);
  var h0 = fp(nz, { foldMatte: false }), h1 = fp(nz, { foldMatte: true });
  A.strictEqual(W.parseT1(h0.t1).contentTag, W.parseT1(h1.t1).contentTag,
    'noise has no uniform border; folding must not change content');
  /* a flat border IS a matte and must fold with F_MATTE set */
  var bordered = F.blank(140, 110, [10, 10, 10]);
  for (var y = 0; y < 70; y++) for (var x = 0; x < 100; x++) {
    var s = (y * nz.w % (nz.w * nz.h)) ;
    F.put(bordered, 20 + x, 20 + y, [nz.px[((y * nz.w + x) % (nz.w * nz.h)) * 4],
                                     nz.px[((y * nz.w + x) % (nz.w * nz.h)) * 4 + 1],
                                     nz.px[((y * nz.w + x) % (nz.w * nz.h)) * 4 + 2]]);
  }
  var hb = fp(bordered, { foldMatte: true });
  A.ok(W.parseT1(hb.t1).flags & 1, 'F_MATTE expected on a bordered image');
});

T('keypoint wire order is content-derived (level shuffle stable)', function () {
  var h = fp(im), d2 = W.parseT2(h.t2), prev = null;
  for (var i = 0; i < d2.list.length; i++) {
    var k = d2.list[i], key = [k.w[0] >>> 0, k.w[1] >>> 0, k.w[2] >>> 0, k.w[3] >>> 0, k.x12, k.y12, k.level];
    if (prev) {
      var cmp = 0;
      for (var f = 0; f < 7 && !cmp; f++) cmp = prev[f] < key[f] ? -1 : (prev[f] > key[f] ? 1 : 0);
      A.ok(cmp <= 0, 'records out of order at ' + i);
    }
    prev = key;
  }
});

var pass = results.filter(function (r) { return r[1]; }).length;
results.forEach(function (r) {
  console.log((r[1] ? 'PASS ' : 'FAIL ') + r[0] + (r[1] ? '' : '  -- ' + r[2]));
});
console.log('wire: ' + pass + '/' + results.length);
if (pass !== results.length) process.exit(1);
