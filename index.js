/**
 * @pixagram/paph-js — entry point.
 *
 * PAPH 4.1: the v3 wire, hashed by either of two engines, judged by
 * comparator 41.  The source files are named for the specification layer they
 * implement — `paph3.*` is the wire engine (SPEC-003), `paph4.*` is the
 * comparator (SPEC-004 and SPEC-004.1) — which is why a 4.1 package still
 * carries a paph3 module.  The wire has not moved and should not.
 *
 * Two backends, one API.  `load()` prefers WebAssembly and falls back to the
 * JavaScript engine; both produce byte-identical wires and identical verdicts,
 * which `npm run parity` checks.  Import a backend directly if you want to pin
 * one:
 *
 *     import { Config, Paph } from '@pixagram/paph-js/js';     // synchronous
 *     import { init, Paph }   from '@pixagram/paph-js/wasm';   // await init()
 */
import js from './src/paph3.js';
import v4mod from './src/paph4.js';

export const VERSION = js.VERSION;
export const T1_BYTES = js.T1_BYTES;
export const SECTIONS = js.SECTIONS;
export const SECTION_OFFSETS = js.SECTION_OFFSETS;
export const THRESHOLDS = js.THRESHOLDS;
export const DEFAULT_CONFIG = js.DEFAULT_CONFIG;

/** Synchronous JavaScript backend — always available. */
export const Config = js.Config;
export const Paph = js.Paph;
export const hash = js.hash;
export const compare = js.compare;
export const parseT1 = js.parseT1;
export const parseT2 = js.parseT2;

/* ---------------------------------------------------------- the comparator
 * SPEC-004 (comparator 4) and SPEC-004.1 (comparator 41) decide what a pair
 * of wires MEANS.  Hashing is v3 and unchanged; a comparator needs a
 * calibration profile, and each refuses the other's.
 */
export const v4 = v4mod;
export const compareV4 = v4mod.compareV4;
export const compareV41 = v4mod.compareV41;
export const screenV41 = v4mod.screenV41;
export const hashChecked = v4mod.hashChecked;
export const cal001 = v4mod.cal001;
export const cal003 = v4mod.cal003;
export const profileEncode = v4mod.profileEncode;
export const profileDecode = v4mod.profileDecode;
export const profileId = v4mod.profileId;
export const COMPARATOR = v4mod.COMPARATOR;
export const COMPARATOR_V41 = v4mod.COMPARATOR_V41;

/**
 * Resolve the fastest available backend.
 * @param {{ prefer?: 'wasm'|'js', wasm?: any }} [opts]
 * @returns {Promise<{ backend: string, Config: any, Paph: any }>}
 */
export async function load(opts) {
  const prefer = (opts && opts.prefer) || 'wasm';
  if (prefer === 'js') return { backend: 'js', Config: js.Config, Paph: js.Paph };
  try {
    const w = await import('./wasm/paph3-wasm.js');
    await w.init(opts && opts.wasm);
    return { backend: 'wasm', Config: w.Config, Paph: w.Paph };
  } catch (e) {
    /* no WebAssembly, or the module could not be fetched — the JS engine is
       not a degraded mode, it produces the same bytes, only slower */
    return { backend: 'js', Config: js.Config, Paph: js.Paph, reason: String(e && e.message || e) };
  }
}

export default { ...js, ...v4mod, load, v4: v4mod };
