/* tools/make-golden.cjs — cut GOLDEN-051.json from the reference.
 *
 * The golden file freezes, per named case: sha-256 of every fingerprint
 * tier on both sides and the ENTIRE compare() report (it is deterministic
 * by SPEC-005.1; no projection, no editorial choices).  A port conforms
 * when it reproduces the tier hashes byte-for-byte and the report
 * field-for-field.  Regenerate ONLY on a spec bump:
 *
 *     node tools/make-golden.cjs
 */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../src/wire.cjs');
const C = require('../src/paph-js.cjs');
const F = require('../test/fixtures.cjs');

function sha(u8) { return u8 ? crypto.createHash('sha256').update(u8).digest('hex') : null; }
function fp(im) { const h = W.hash(im.px, im.w, im.h); return { t1: h.t1, t2: h.t2 }; }

function build() {
  const S0 = F.sprite(150, 110, 7);
  const fS0 = fp(S0);
  const T0 = F.tiles(128, 128, 3);

  const cases = [];
  function add(name, a, b, opts) {
    const r = C.compare(a, b, opts);
    cases.push({
      name,
      a: { t1: sha(a.t1), t2: sha(a.t2) },
      b: { t1: sha(b.t1), t2: sha(b.t2) },
      report: r
    });
  }

  add('identity-same-bytes', fS0, fS0);
  add('identity-rehash', fS0, fp(F.sprite(150, 110, 7)));
  add('d4-rot90', fS0, fp(F.d4(S0, 5)));
  add('d4-transpose', fS0, fp(F.d4(S0, 3)));
  add('inversion', fS0, fp(F.invert(S0)));
  add('d4-plus-inversion', fS0, fp(F.invert(F.d4(S0, 3))));
  add('tone-shift-40', fS0, fp(F.shiftLum(S0, 40)));
  add('upscale-2x', fS0, fp(F.upscale(S0, 2)));
  add('paste-small-crop', fS0, fp(F.pasteCrop(S0, 16, 16, 64, 48, F.noise(200, 160, 777), 80, 60)));
  add('paste-large-crop', fS0, fp(F.pasteCrop(S0, 0, 0, 130, 100, F.noise(200, 160, 778), 20, 18)));
  add('negative-noise', fS0, fp(F.noise(150, 110, 9)));
  add('structural-only', fS0, { t1: fp(F.d4(S0, 1)).t1, t2: null });
  add('tiles-rot90-repetition', fp(T0), fp(F.d4(T0, 5)));

  return {
    golden: 'GOLDEN-051',
    wire: W.WIRE_VERSION,
    comparator: C.COMPARATOR,
    extractionProfileId: W.extractionProfileId,
    pcal: C.profileName(C.cal()) + ':' + C.profileIdHex16(C.cal()),
    cases
  };
}

const out = build();
const dst = path.join(__dirname, '..', 'docs', 'golden', 'GOLDEN-051.json');
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', dst, out.cases.length, 'cases');
