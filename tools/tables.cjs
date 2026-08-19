#!/usr/bin/env node
/**
 * Regenerate the frozen integer tables and check the identities they carry.
 *
 * They are literals in both engines rather than cos() calls on purpose: V8's
 * Math.cos and Rust's f64::cos may disagree in the last ulp, and after
 * round(x * 32768) that is a table entry off by one — in an artefact two
 * independent nodes are supposed to agree on byte for byte.
 *
 *   node tools/tables.js          check the shipped tables
 *   node tools/tables.js --print  emit them for pasting
 */
const P = require('../src/paph3.cjs');
const rnd = v => (v < 0 ? -Math.round(-v) : Math.round(v));

const C = [], S = [], RC = [], RS = [];
for (let k = 0; k < 64; k++) {
  const a = k * Math.PI / 32;
  C.push(rnd(Math.cos(a) * 32768)); S.push(rnd(Math.sin(a) * 32768));
  RC.push(rnd(Math.cos(a) * 1024)); RS.push(rnd(Math.sin(a) * 1024));
}
const RAYC = [], RAYS = [];
for (let k = 0; k < 32; k++) {
  RAYC.push(Math.round(Math.cos(k * Math.PI / 16) * 1024) | 0);
  RAYS.push(Math.round(Math.sin(k * Math.PI / 16) * 1024) | 0);
}
const SQ = [];
for (let d = -12; d <= 12; d++) SQ.push(rnd(Math.pow(1.3, d) * 65536));
const DCT = {};
for (const N of [4, 8, 16]) {
  const t = [];
  for (let u = 0; u < N; u++) for (let i = 0; i < N; i++)
    t.push(Math.round(Math.cos((2 * i + 1) * u * Math.PI / (2 * N)) * 16384) | 0);
  DCT[N] = t;
}

let bad = 0;
const check = (name, cond, note) => {
  if (!cond) bad++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${note ? '  ' + note : ''}`);
};

console.log('\nidentities the design rests on');
let sym = true;
for (let k = 0; k < 64; k++) {
  const m = (32 - k) & 63;
  if (C[m] !== -C[k] || S[m] !== S[k] || RC[m] !== -RC[k] || RS[m] !== RS[k]) sym = false;
}
check('COS64[32-k] === -COS64[k] and SIN64[32-k] === SIN64[k]', sym,
      'the mirror trick in §8.6 is exactly this');

console.log('\nshipped tables match a fresh generation');
const shipped = P._internal;
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
check('COS64', same(C, Array.from(shipped.COS64)));
check('SIN64', same(S, Array.from(shipped.SIN64)));
check('RC10 ', same(RC, Array.from(shipped.RC10)));
check('RS10 ', same(RS, Array.from(shipped.RS10)));

console.log('\nno transcendental survives into the wire path');
const raw = require('fs').readFileSync(__dirname + '/../src/paph3.cjs', 'utf8');
/* strip comments first — the file talks ABOUT Math.cos at length, and a check
   that cannot tell prose from code is a check that will be ignored */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
for (const fn of ['Math.cos', 'Math.sin', 'Math.log2', 'Math.pow', 'Math.tan']) {
  const hits = (src.match(new RegExp(fn.replace('.', '\\.'), 'g')) || []).length;
  check(fn.padEnd(9), hits === 0, hits ? hits + ' occurrence(s) — these must be frozen' : '');
}
check('Math.round', (src.match(/Math\.round/g) || []).length === 0);

if (process.argv.includes('--print')) {
  const fmt = a => { let o = '', l = '';
    for (const v of a) { const t = (l ? l + ', ' : '') + v; if (t.length > 92) { o += '  ' + l + ',\n'; l = '' + v; } else l = t; }
    return o + '  ' + l; };
  for (const [n, a] of [['COS64', C], ['SIN64', S], ['RC10', RC], ['RS10', RS],
                        ['RAYC', RAYC], ['RAYS', RAYS], ['SCALE_Q16', SQ],
                        ['DCT4', DCT[4]], ['DCT8', DCT[8]], ['DCT16', DCT[16]]])
    console.log('\n' + n + '\n' + fmt(a));
}
console.log(`\n${bad ? bad + ' check(s) failed' : 'all table checks passed'}\n`);
process.exit(bad ? 1 : 0);
