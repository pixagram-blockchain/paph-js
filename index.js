/* @pixagram/paph-js 5.1 — ESM entry ("type": "module" makes .js ESM).
 * Thin wrapper over the CommonJS reference; one implementation, two faces. */
import mod from './index.cjs';

export const {
  hash, parseT1, parseT2,
  WIRE_VERSION, TIER1_BYTES, MAX_KP, EXTRACTION_PROFILE, extractionProfileId,
  compare, screen, COMPARATOR, CONTAINER, SCALE, CHANNEL_ORDER,
  cal, lutIdentity, lutEval,
  profileEncode, profileDecode, profileValidate,
  profileId, profileIdHex16, profileName,
  wire, comparator
} = mod;

export default mod;
