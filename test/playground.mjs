/* Headless drive-through of demo/paph41-playground.html: load works, measure pairs,
   tune a table, inspect a pair, run the shared-asset lab, export the profile.
   Cross-realm note: pixel buffers must be built with the window's own
   Uint8Array, or the engine's type check rejects them. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch (e) {
  console.log('playground harness skipped — jsdom is not installed (npm i -D jsdom to run it)');
  process.exit(0);
}
const DEMO = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo') + '/';
const dom = new JSDOM(readFileSync(DEMO + 'paph41-playground.html', 'utf8'),
  { url: 'file:///playground/paph41-playground.html', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
for (const p of ['../src/paph3.cjs', '../src/paph4.cjs', 'cal-core.cjs'])
  window.eval(readFileSync(DEMO + p, 'utf8'));
window.HTMLCanvasElement.prototype.getContext = function () {
  return { imageSmoothingEnabled: false, drawImage() {},
           createImageData: (w, h) => ({ data: new window.Uint8ClampedArray(w * h * 4), width: w, height: h }),
           putImageData() {},
           getImageData: (x, y, w, h) => ({ data: new window.Uint8ClampedArray(w * h * 4), width: w, height: h }) };
};
/* the page's own inline application, taken from the page itself */
const pageHtml = readFileSync(DEMO + 'paph41-playground.html', 'utf8');
const inline = pageHtml.slice(pageHtml.lastIndexOf('<script>') + 8, pageHtml.lastIndexOf('</script>'));
window.eval(inline);
const API = window.paph41, V4 = window.paph4;
const $ = id => window.document.getElementById(id);
let pass = 0, fail = 0;
const ok = (n, c, x) => { (c ? pass++ : fail++); console.log('  ' + (c ? 'PASS' : 'FAIL') + ' ' + n + (x ? '  ' + x : '')); };

API.renderAll();   /* in a browser DOMContentLoaded does this */
ok('console renders every scalar', $('scalars').children.length === 11);
ok('nine calibration tables drawn', $('luts').children.length === 9);
ok('profile identity shown', /container 2/.test($('profId').textContent) && /comparator 41/.test($('profId').textContent));
ok('empty state invites a measurement', /measure some pairs first/.test($('tiles').textContent));

function art(w, h, seed) {
  const px = new window.Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    px[o] = (x * 7 + y * 3 + seed) % 251; px[o + 1] = (y * 11 + x * 5) % 253;
    px[o + 2] = ((x ^ y) * 13) % 247; px[o + 3] = 255;
  }
  let s = seed;
  const r = m => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % Math.max(1, m); };
  for (let i = 0; i < 40; i++) {
    const bx = r(w - 10), by = r(h - 10), cr = r(256), cg = r(256), cb = r(256);
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) {
      const o = ((by + dy) * w + bx + dx) * 4;
      px[o] = cr; px[o + 1] = cg; px[o + 2] = cb;
    }
  }
  return { px, w, h };
}
const mirror = im => {
  const px = new window.Uint8Array(im.px.length);
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++)
    for (let c = 0; c < 4; c++) px[(y * im.w + x) * 4 + c] = im.px[(y * im.w + (im.w - 1 - x)) * 4 + c];
  return { px, w: im.w, h: im.h };
};
const base = art(128, 128, 42);
API.addWork('A1', base);
API.addWork('A2', mirror(base));
API.addWork('G1', art(128, 128, 9001));
ok('three works hashed and listed', API.works().length === 3 && $('works').children.length === 3, $('intakeStat').textContent);
ok('groups seeded from the filenames', API.works().map(w => w.group).join('') === 'AAG');
ok('measure button enabled', $('measure').disabled === false);

await new Promise((res, rej) => {
  API.measureAll();
  const t0 = Date.now();
  const t = setInterval(() => {
    if (API.pairs().length === 3 && !$('measure').disabled) { clearInterval(t); res(); }
    else if (Date.now() - t0 > 60000) { clearInterval(t); rej(new Error('measurement never finished')); }
  }, 25);
});
ok('three pairs measured', API.pairs().length === 3, $('intakeStat').textContent);
ok('pair table filled', $('pairWrap').querySelectorAll('tbody tr').length === 3);
ok('default labels: same group → B, cross group → E',
   API.pairs().map(p => p.cat).sort().join('') === 'BEE');
ok('the mirrored pair certifies', /Copy/.test($('pairWrap').textContent));
ok('scoreboard leads with the hard gate', /false certifications/i.test($('tiles').textContent));

const before = $('tiles').textContent;
const P = API.profile();
const certBefore = API.pairs().filter(p => window.calCore.certified(p.live.state)).length;
const savedGeo = P.lutGeometry, savedLocal = P.lutLocal;
P.lutGeometry = [[0, 0], [10000, 0]];
API.renderAll();
ok('flattening the geometry table zeroes geometric evidence',
   API.pairs().every(p => p.live.geoEvidence === 0));
P.lutLocal = [[0, 0], [10000, 0]];
API.renderAll();
ok('flattening local as well drops every certification',
   certBefore > 0 && API.pairs().every(p => !window.calCore.certified(p.live.state) || p.live.basis[0] === 'bytes'),
   certBefore + ' certified before');
P.lutGeometry = savedGeo; P.lutLocal = savedLocal;
API.renderAll();
ok('restoring both tables restores every count', $('tiles').textContent === before);

const staleBefore = /stale pairs/.test($('tiles').textContent);
P.geoEps = P.geoEps + 200;
API.renderAll();
ok('a measurement-field edit raises the stale flag instead of lying',
   !staleBefore && /stale pairs/.test($('tiles').textContent));
P.geoEps = P.geoEps - 200;
API.renderAll();

API.select(0);
ok('inspector shows the lattice inputs', /structural/.test($('inspMain').textContent) &&
   /geometry evidence/.test($('inspMain').textContent) && /after table/.test($('inspMain').textContent));
ok('inspector reports the stage-1 screen', /pools/.test($('inspSide').textContent), '');

$('labDonor').value = '2'; $('labA').value = '0'; $('labB').value = '2';
$('labSize').value = '48'; $('labX').value = '8'; $('labY').value = '8';
API.lab();
ok('shared-asset lab returns a verdict and the asset share',
   /% of the smaller canvas/.test($('labOut').textContent),
   $('labOut').textContent.replace(/\s+/g, ' ').slice(0, 96));

/* --- the worked example: eleven generated works, every pair pre-labelled --- */
await new Promise((res, rej) => {
  API.loadExample();
  const t0 = Date.now();
  const t = setInterval(() => {
    if (API.works().length === 11 && API.pairs().length === 55 && !$('measure').disabled) { clearInterval(t); res(); }
    else if (Date.now() - t0 > 120000) { clearInterval(t); rej(new Error('the example never finished measuring')); }
  }, 40);
});
ok('worked example loads eleven works and 55 pairs', API.works().length === 11 && API.pairs().length === 55);
const cats = {};
API.pairs().forEach(p => { cats[p.cat] = (cats[p.cat] || 0) + 1; });
ok('its ground truth arrives with it', Object.keys(cats).sort().join('') === 'ABCDEG', JSON.stringify(cats));
const byName = {};
API.pairs().forEach(p => { byName[API.works()[p.i].name + '|' + API.works()[p.j].name] = p; });
ok('the exact duplicate reads Identical',
   byName['A1_original|A2_identical'].live.state === 'Identical',
   byName['A1_original|A2_identical'].live.state);
const m = API.metrics();
ok('the example has no false certifications under CAL-003',
   m.falseCert.length === 0, m.falseCert.length + ' false certs');
ok('and it certifies most of its near-duplicates',
   m.certB >= 1 && m.atRevB === m.nB, m.certB + '/' + m.nB + ' certified, ' + m.atRevB + '/' + m.nB + ' at review');
const shared = byName['G1_shared_asset|G2_shared_asset'];
ok('the shared-asset pair is present and labelled G',
   shared && shared.cat === 'G', shared ? shared.live.state + ' — the ANALYSIS-002 case' : 'missing');

ok('profile still encodes to the 270-byte container-2 artefact', V4.profileEncode(API.profile()).length === 270);
ok('and still hashes to the CAL-003 identity',
   V4.hex(V4.profileId(API.profile())) === '75319777e4ff7fe6592365612cff9a85d653519166ff1308c8d3489d0247a422');
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
