/* test/golden.test.cjs — the reference must keep reproducing its own
 * golden vectors exactly: tier hashes byte-for-byte, reports
 * field-for-field.  Any diff is either a bug or an undocumented spec
 * change; both must be looked in the eye. */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../src/wire.cjs');
const C = require('../src/paph-js.cjs');
const F = require('../test/fixtures.cjs');

const G = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'golden', 'GOLDEN-051.json'), 'utf8'));

function sha(u8) { return u8 ? crypto.createHash('sha256').update(u8).digest('hex') : null; }
function fp(im) { const h = W.hash(im.px, im.w, im.h); return { t1: h.t1, t2: h.t2 }; }

const S0 = F.sprite(150, 110, 7);
const fS0 = fp(S0);
const T0 = F.tiles(128, 128, 3);

const inputs = {
  'identity-same-bytes': () => [fS0, fS0],
  'identity-rehash': () => [fS0, fp(F.sprite(150, 110, 7))],
  'd4-rot90': () => [fS0, fp(F.d4(S0, 5))],
  'd4-transpose': () => [fS0, fp(F.d4(S0, 3))],
  'inversion': () => [fS0, fp(F.invert(S0))],
  'd4-plus-inversion': () => [fS0, fp(F.invert(F.d4(S0, 3)))],
  'tone-shift-40': () => [fS0, fp(F.shiftLum(S0, 40))],
  'upscale-2x': () => [fS0, fp(F.upscale(S0, 2))],
  'paste-small-crop': () => [fS0, fp(F.pasteCrop(S0, 16, 16, 64, 48, F.noise(200, 160, 777), 80, 60))],
  'paste-large-crop': () => [fS0, fp(F.pasteCrop(S0, 0, 0, 130, 100, F.noise(200, 160, 778), 20, 18))],
  'negative-noise': () => [fS0, fp(F.noise(150, 110, 9))],
  'structural-only': () => [fS0, { t1: fp(F.d4(S0, 1)).t1, t2: null }],
  'tiles-rot90-repetition': () => [fp(T0), fp(F.d4(T0, 5))]
};

function firstDiff(a, b, p) {
  if (a === b) return null;
  if (typeof a !== typeof b) return p + ' type ' + typeof a + '!=' + typeof b;
  if (a && b && typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return p + ' keys ' + ka.length + '!=' + kb.length;
    for (const k of ka) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
    return null;
  }
  return p + ' ' + JSON.stringify(a) + ' != ' + JSON.stringify(b);
}

let pass = 0, fail = 0;
if (G.pcal !== C.profileName(C.cal()) + ':' + C.profileIdHex16(C.cal())) {
  console.log('FAIL pcal identity drifted: golden ' + G.pcal);
  fail++;
} else pass++;

for (const g of G.cases) {
  const mk = inputs[g.name];
  if (!mk) { console.log('FAIL no generator for golden case ' + g.name); fail++; continue; }
  const [a, b] = mk();
  const errs = [];
  if (sha(a.t1) !== g.a.t1) errs.push('a.t1');
  if (sha(a.t2) !== g.a.t2) errs.push('a.t2');
  if (sha(b.t1) !== g.b.t1) errs.push('b.t1');
  if (sha(b.t2) !== g.b.t2) errs.push('b.t2');
  const d = firstDiff(JSON.parse(JSON.stringify(C.compare(a, b))), g.report, 'report');
  if (d) errs.push(d);
  if (errs.length) { console.log('FAIL ' + g.name + ': ' + errs.join('; ')); fail++; }
  else { console.log('PASS golden ' + g.name); pass++; }
}
console.log('golden: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
