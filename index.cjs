/* CommonJS entry for @pixagram/paph-js (PAPH 4.1).  The WASM backend is ESM-only (it uses import.meta.url to
   find its own .wasm), so require() gets the JavaScript engine; use
   `await import('@pixagram/paph-js/wasm')` from CJS if you want WebAssembly. */
const js = require('./src/paph3.cjs');
const v4 = require('./src/paph4.cjs');

/* A copy, not the module object itself: `require('@pixagram/paph-js/js')` must
   keep giving the bare v3 engine. */
module.exports = Object.assign({}, js, {
  /* the comparator layer — comparator 4 (SPEC-004) and 41 (SPEC-004.1) */
  v4: v4,
  compareV4: v4.compareV4,
  compareV41: v4.compareV41,
  screenV41: v4.screenV41,
  hashChecked: v4.hashChecked,
  cal001: v4.cal001,
  cal003: v4.cal003,
  profileEncode: v4.profileEncode,
  profileDecode: v4.profileDecode,
  profileId: v4.profileId,
  COMPARATOR: v4.COMPARATOR,
  COMPARATOR_V41: v4.COMPARATOR_V41
});
module.exports.load = async function (opts) {
  const prefer = (opts && opts.prefer) || 'wasm';
  if (prefer === 'js') return { backend: 'js', Config: js.Config, Paph: js.Paph };
  try {
    const w = await import('./wasm/paph3-wasm.js');
    await w.init(opts && opts.wasm);
    return { backend: 'wasm', Config: w.Config, Paph: w.Paph };
  } catch (e) {
    return { backend: 'js', Config: js.Config, Paph: js.Paph, reason: String((e && e.message) || e) };
  }
};
