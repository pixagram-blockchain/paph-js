/* Emit the README's worked-example table from the console itself, so the
   documented numbers cannot drift from what the page actually says. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const { JSDOM } = await import('jsdom');
const DEMO = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo') + '/';
const dom = new JSDOM(readFileSync(DEMO + 'paph-js-console.html', 'utf8'),
  { url: 'file:///playground/paph-js-console.html', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
for (const p of ['../src/wire.cjs', '../src/paph-js.cjs', 'cal-core.cjs'])
  window.eval(readFileSync(DEMO + p, 'utf8'));
window.HTMLCanvasElement.prototype.getContext = function () {
  return { imageSmoothingEnabled: false, drawImage() {},
           createImageData: (w, h) => ({ data: new window.Uint8ClampedArray(w * h * 4), width: w, height: h }),
           putImageData() {},
           getImageData: (x, y, w, h) => ({ data: new window.Uint8ClampedArray(w * h * 4), width: w, height: h }) };
};
const pageHtml = readFileSync(DEMO + 'paph-js-console.html', 'utf8');
window.eval(pageHtml.slice(pageHtml.lastIndexOf('<script>') + 8, pageHtml.lastIndexOf('</script>')));
const API = window.paphConsole;
API.renderAll(); API.loadExample();
await new Promise((res, rej) => { const t0 = Date.now();
  const t = setInterval(() => {
    if (API.works().length === 11 && API.pairs().length === 55 &&
        !window.document.getElementById('measure').disabled) { clearInterval(t); res(); }
    else if (Date.now() - t0 > 180000) { clearInterval(t); rej(new Error('timeout')); }
  }, 40); });
const W = API.works(), m = API.metrics();
const want = ['A1_original|A2_identical', 'A1_original|A3_recolour', 'A1_original|A4_upscaled',
  'A1_original|B1_crop', 'A1_original|B2_mirror_crop', 'A1_original|C1_composite',
  'A1_original|E1_unrelated', 'E1_unrelated|E2_unrelated', 'G1_shared_asset|G2_shared_asset'];
const by = {};
for (const p of API.pairs()) by[W[p.i].name + '|' + W[p.j].name] = p;
const nice = n => n.replace(/_/g, ' ');
console.log('| pair | label | verdict | basis | structural | inliers | D |');
console.log('|---|---|---|---|---|---|---|');
for (const k of want) {
  const p = by[k]; if (!p) { console.log('MISSING ' + k); continue; }
  const [a, b] = k.split('|');
  const basis = p.live.basis.length ? p.live.basis.join('+') : '—';
  const inl = p.snap.totalInliers + (p.snap.geoWeak > 0 ? ' (weak)' : '');
  const d = p.snap.geoDiversity === null || p.snap.modelCount === 0 ? '—' : p.snap.geoDiversity;
  console.log(`| ${nice(a)} × ${nice(b)} | ${p.cat} | ${p.live.state} | ${basis} | ${p.live.structural} | ${inl} | ${d} |`);
}
console.log('\nfalseCert', m.falseCert.length, '| B', m.certB + '/' + m.nB, 'cert,', m.atRevB + '/' + m.nB, 'at review',
            '| CD', m.certCD + '/' + m.nCD, 'cert,', m.atRevCD + '/' + m.nCD, 'at review');
