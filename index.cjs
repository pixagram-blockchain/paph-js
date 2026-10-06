/* @pixagram/paph-js 5.1 — CommonJS entry.
 * Wire engine + comparator 51 under one roof; ./wire stays importable
 * on its own for extraction-only consumers. */
'use strict';
const wire = require('./src/wire.cjs');
const cmp = require('./src/paph-js.cjs');

module.exports = {
  /* extraction */
  hash: wire.hash, parseT1: wire.parseT1, parseT2: wire.parseT2,
  WIRE_VERSION: wire.WIRE_VERSION, TIER1_BYTES: wire.TIER1_BYTES,
  MAX_KP: wire.MAX_KP, EXTRACTION_PROFILE: wire.EXTRACTION_PROFILE,
  extractionProfileId: wire.extractionProfileId,
  /* comparison */
  compare: cmp.compare, screen: cmp.screen,
  COMPARATOR: cmp.COMPARATOR, CONTAINER: cmp.CONTAINER, SCALE: cmp.SCALE,
  CHANNEL_ORDER: cmp.CHANNEL_ORDER,
  /* calibration profiles */
  cal: cmp.cal, lutIdentity: cmp.lutIdentity, lutEval: cmp.lutEval,
  profileEncode: cmp.profileEncode, profileDecode: cmp.profileDecode,
  profileValidate: cmp.profileValidate, profileId: cmp.profileId,
  profileIdHex16: cmp.profileIdHex16, profileName: cmp.profileName,
  /* namespaced originals */
  wire: wire, comparator: cmp
};
