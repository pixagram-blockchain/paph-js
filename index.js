/**
 * @pixagram/paph-js — PAPH 4.2.
 *
 * One wire, one comparator on the entry, one shipped calibration.  The wire is
 * the v3 fingerprint (tier 1 exactly 3952 bytes, tier 2 32 + 40n) and does not
 * move — SPEC-004.2 raised the Tier-2 budget from 256 keypoints to 512, which
 * the format already allowed: the record count was always a u16.  Comparator 42
 * decides what a pair of wires MEANS, and needs a container-3 calibration
 * artefact to do it.
 *
 * Comparator 41 is FROZEN, not deleted: `compare41` / `cal41` still compute, so
 * a verdict issued under 4.1 stays reproducible.
 *
 *     import { hash, compare, cal } from '@pixagram/paph-js';
 *
 *     const profile = cal();
 *     const a = hash(imageA, {}, profile.limits);
 *     const b = hash(imageB, {}, profile.limits);
 *     compare(a.t1, a.t2, b.t1, b.t2, {}, profile).verdict;   // 'Copy'
 *
 * Pin a layer if you would rather not go through the entry:
 *
 *     import { Config, Paph } from '@pixagram/paph-js/wire';   // fingerprints only
 *     import { init, Paph }   from '@pixagram/paph-js/wasm';   // await init() once
 */
import wire from './src/wire.js';
import paph from './src/paph-js.js';

export const VERSION = paph.VERSION;
export const COMPARATOR = paph.COMPARATOR;
export const CONTAINER = paph.CONTAINER;

export const hash = paph.hash;
export const compare = paph.compare;
export const screen = paph.screen;
export const cal = paph.cal;
export const calibration = paph.calibration;
export const profileEncode = paph.profileEncode;
export const profileDecode = paph.profileDecode;
export const profileId = paph.profileId;
export const profileName = paph.profileName;
export const legacyCal001 = paph.legacyCal001;

/** comparator 41, frozen — for reproducing verdicts issued under 4.1 */
export const compare41 = paph.compare41;
export const screen41 = paph.screen41;
export const cal41 = paph.cal41;
export const lutEval = paph.lutEval;
export const lutChannel = paph.lutChannel;

/** the wire layer */
export const Config = wire.Config;
export const Paph = wire.Paph;
export const parseT1 = wire.parseT1;
export const parseT2 = wire.parseT2;
export const WIRE_VERSION = wire.VERSION;
export const T1_BYTES = wire.T1_BYTES;
export const KP_MAX = wire.KP_MAX;
export const F_KPQ = wire.F_KPQ;
export const SECTIONS = wire.SECTIONS;
export const SECTION_OFFSETS = wire.SECTION_OFFSETS;
export const DEFAULT_CONFIG = wire.DEFAULT_CONFIG;

/**
 * Resolve the fastest available wire backend.  Both produce byte-identical
 * fingerprints — `npm run parity` is the check that says so — so the JavaScript
 * fallback is not a degraded mode, only a slower one.
 * @param {{ prefer?: 'wasm'|'js', wasm?: any }} [opts]
 */
export async function load(opts) {
  const prefer = (opts && opts.prefer) || 'wasm';
  if (prefer === 'js') return { backend: 'js', Config: wire.Config, Paph: wire.Paph };
  try {
    const w = await import('./wasm/paph-js-wasm.js');
    await w.init(opts && opts.wasm);
    return { backend: 'wasm', Config: w.Config, Paph: w.Paph };
  } catch (e) {
    return { backend: 'js', Config: wire.Config, Paph: wire.Paph, reason: String(e && e.message || e) };
  }
}

export default { ...wire, ...paph, load, wire };
