/* Drive demo/paph4x.html headlessly: the bench must boot from its own inlined
   engines, hash its own samples, reach a comparator-41 verdict, and fill every
   section — including the sweep that reads each transform through BOTH
   comparators.  Needs jsdom; skips cleanly without it. */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch (e) {
  console.log('bench harness skipped — jsdom is not installed (npm i -D jsdom to run it)');
  process.exit(0);
}
const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'paph4x.html');
if (!existsSync(FILE)) {
  console.error('demo/paph4x.html is missing — run `npm run build:bench` first');
  process.exit(2);
}
const dom = new JSDOM(readFileSync(FILE, 'utf8'),
  { url: 'file:///bench/paph4x.html', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
/* canvas + ImageData stubs: jsdom has no 2D context */
window.ImageData = class { constructor(w, h) { this.width = w; this.height = h;
  this.data = new window.Uint8ClampedArray(w * h * 4); } };
const ctx = () => ({
  imageSmoothingEnabled: false, setTransform() {}, clearRect() {}, fillRect() {}, drawImage() {},
  putImageData() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
  save() {}, restore() {}, translate() {}, rotate() {}, fillText() {}, setLineDash() {},
  createLinearGradient: () => ({ addColorStop() {} }),
  createImageData: (w, h) => new window.ImageData(w, h),
  getImageData: (x, y, w, h) => new window.ImageData(w, h)
});
window.HTMLCanvasElement.prototype.getContext = ctx;
Object.defineProperty(window.HTMLCanvasElement.prototype, 'clientWidth', { get: () => 600 });
/* jsdom provides performance */
const html = readFileSync(FILE, 'utf8');
for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) window.eval(m[1]);

const API = window.paphjsx, $ = id => window.document.getElementById(id);
let pass = 0, fail = 0;
const ok = (n, c, x) => { (c ? pass++ : fail++); console.log('  ' + (c ? 'PASS' : 'FAIL') + ' ' + n + (x ? '  ' + x : '')); };

API.decide();   /* the page defers through rAF; the harness does not wait */
ok('the bench boots with both slots filled', !!API && !!API.slots().A && !!API.slots().B,
   API && API.slots().A ? API.slots().A.name + ' × ' + API.slots().B.name : '');
const r = API.report();
ok('it reaches a comparator-42 verdict', r && r.comparator === 42, r ? r.verdict + ' [' + r.basis.join('+') + ']' : '');
ok('the profile is CAL-004-PROPOSED, container 3', API.profile().container === 3 && API.profile().comparator === 42);
ok('the screen ran and reported its pools', !!API.screen() && typeof API.screen().poolDirect === 'number',
   API.screen() ? (API.screen().pass ? 'pass' : 'unscreened') + ' ' + API.screen().poolDirect + '/' + API.screen().poolMirror : '');
ok('the verdict readout is painted', /Comparator 42/.test($('readout').textContent));
ok('the lattice lit exactly one cell',
   [...window.document.querySelectorAll('#latGrid .cell.on')].length === 1);
ok('all seven channels rendered', window.document.querySelectorAll('#chans .chan').length === 7);
ok('a channel shows raw and post-table values',
   /after the .* table/.test($('chans').textContent));
ok('the ten calibration curves are drawn', window.document.querySelectorAll('#curves svg.curve').length === 10);
ok('the artefact identity is shown', /320 bytes/.test($('profId').textContent));
ok('the wire ribbon has every section', $('ribbon').children.length === window.paphWire.SECTIONS.length);
ok('the hex view has bytes', $('hexview').textContent.length > 100);
const drawn = /an accepted model kept it \((\d+)\)/.exec($('corrLegend').textContent);
ok('the drawn inliers match the comparator\'s count',
   !!drawn && (+drawn[1] === r.totalInliers || (r.geoWeakInliers > 0 && +drawn[1] === 0)),
   drawn ? 'drawn ' + drawn[1] + ' · reported ' + r.totalInliers : 'legend missing');
ok('the replay never contradicts the report', !/replay disagrees/.test($('corrLegend').textContent));
ok('cost reports the comparator and the screen',
   /Compare/.test($('costStats').textContent) && /Screen/.test($('costStats').textContent) &&
   /budget of 25 ms/.test($('costStats').textContent));

/* the sweep is the slow path — drive it and wait */
await new Promise((res, rej) => {
  API.sweep();
  const t0 = Date.now();
  const t = setInterval(() => {
    if (API.attackRows()) { clearInterval(t); res(); }
    else if (Date.now() - t0 > 120000) { clearInterval(t); rej(new Error('sweep never finished')); }
  }, 50);
});
const rows = API.attackRows();
ok('the attack sweep ran every transform plus the identity anchor',
   rows.length === Object.keys(API.transforms).length + 1, rows.length + ' rows');
ok('the anchor row reads Identical', rows.some(x => x.v === 'Identical'));
ok('every row carries a verdict and a screen result',
   rows.every(x => x.v && (x.screen === 'pass' || x.screen === 'unscreened')),
   rows.slice(0, 3).map(x => x.label + ': ' + x.v + ' / ' + x.screen).join(' | '));
ok('the mirror survives as a copy', rows.some(x => /mirror/i.test(x.label) && (x.v === 'Copy' || x.v === 'Identical')));
/* SPEC-004.2 §8 — a row that certified must say how independent its geometry was */
ok('every certified row carries a diversity reading',
   rows.filter(x => x.v === 'Copy' || x.v === 'Identical').every(x => typeof x.d === 'number'),
   rows.filter(x => x.v === 'Copy' || x.v === 'Identical').map(x => x.label + ' D=' + x.d).slice(0, 3).join(' | '));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
