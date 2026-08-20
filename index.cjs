/* CommonJS entry for @pixagram/paph-js — PAPH 4.2.
   One wire (tier 1 + tier 2, unchanged in format; Tier 2 now carries up to 512
   keypoints), one comparator on the entry (42), one shipped calibration.
   Comparator 41 stays reachable as compare41/cal41 so verdicts issued under 4.1
   remain reproducible.  The WebAssembly backend is ESM-only (it uses import.meta.url to
   find its own .wasm), so require() gets the JavaScript wire engine; use
   `await import('@pixagram/paph-js/wasm')` from CJS if you want WebAssembly. */
const wire = require('./src/wire.cjs');
const paph = require('./src/paph-js.cjs');

module.exports = Object.assign({}, paph, {
  /* the wire layer, for callers that only want fingerprints */
  wire: wire,
  Config: wire.Config,
  Paph: wire.Paph,
  parseT1: wire.parseT1,
  parseT2: wire.parseT2,
  WIRE_VERSION: wire.VERSION,
  T1_BYTES: wire.T1_BYTES,
  KP_MAX: wire.KP_MAX,
  F_KPQ: wire.F_KPQ,
  SECTIONS: wire.SECTIONS,
  SECTION_OFFSETS: wire.SECTION_OFFSETS,
  DEFAULT_CONFIG: wire.DEFAULT_CONFIG,
  load: async function (opts) {
    const prefer = (opts && opts.prefer) || 'wasm';
    if (prefer === 'js') return { backend: 'js', Config: wire.Config, Paph: wire.Paph };
    try {
      const w = await import('./wasm/paph-js-wasm.js');
      await w.init(opts && opts.wasm);
      return { backend: 'wasm', Config: w.Config, Paph: w.Paph };
    } catch (e) {
      return { backend: 'js', Config: wire.Config, Paph: wire.Paph, reason: String((e && e.message) || e) };
    }
  }
});
