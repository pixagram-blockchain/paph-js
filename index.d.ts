/* @pixagram/paph-js 5.1 — type surface.
 * Types mirror the frozen SPEC-005.1 report shape as emitted by the
 * reference; fields not listed are internal and may change without a
 * spec bump.  Verified against the reference at package time. */

export interface HashResult {
  t1: Uint8Array;                       /* Tier 1, 2560 bytes */
  t2: Uint8Array | null;                /* Tier 2, 32 + 32n bytes, n <= 512 */
  detail: {
    keypoints: Array<{
      x12: number; y12: number; level: number; oct: number; s8: number;
      region: number; coarse: number; divTag: number;
      w: [number, number, number, number];
    }>;
    regionCodes: Uint8Array | number[];
    maxDim: number; xmax: number; ymax: number;
    normalized: { w: number; h: number };
    opts: { foldMatte: boolean; divideUpscale: boolean; matteTol: number; kpCount: number };
  };
}

export interface Fingerprint { t1: Uint8Array; t2?: Uint8Array | null; }

export type Verdict =
  | 'Identical' | 'Copy' | 'Related' | 'Suspected' | 'Unrelated' | 'Indeterminate';

export interface ScreenReport {
  verdict: 'PASS' | 'REJECT';
  coarseMatches: number; regionPairs: number; sketchAgree: number;
  floors: { coarse: number; region: number; sketch: number };
  costClass: string; kpA: number; kpB: number;
}

export interface GeoModel {
  m: number;                            /* D4 element 0..7, A -> B */
  inverted: boolean;
  rotation: 0 | 90 | 180 | 270; mirrored: boolean;
  sQ16: number; scaleMilli: number;
  t: [number, number];
  inliers: number; indep: number;
  resMedBucket: number; mass: number; peakKey: number;
  pairs: Array<[number, number]>;
}

export interface ChannelReport {
  measurable: boolean; note?: string;
  raw: number; nullVal: number; margin: number; evidence: number;
  /* channel-specific extras (local): */
  alignedK?: number; alignedInverted?: boolean;
  matches?: number; pairs?: Array<[number, number]>;
  matchedK?: number; toneShift?: number;
  [extra: string]: unknown;
}

export interface CompareReport {
  comparator: 51; container: 3;
  calibrationId: string; calibrationName: string;
  swapped: boolean;
  verdict: Verdict;
  evidenceClass: string;
  basis: string[]; reasons: string[]; note: string | null;
  structural: { measurable: boolean; value: number; channelsMeasured: number };
  geometric: {
    measurable: boolean; note?: string;
    value: number; raw: number; control: number; margin: number;
    confidence: number; correspondences: number; totalInliers: number;
    independentEvidence: number;
    models: GeoModel[];
    topology: { models: number; primaryShare: number; klass: string };
    degraded: boolean; invGate: number; invertedFamilyRan: boolean;
    ctlMember: string;
  };
  diversity: {
    measurable: boolean; value: number;
    components: unknown; repeat: number; repetitionExtreme: boolean;
  };
  channels: {
    dct: ChannelReport; local: ChannelReport; region: ChannelReport;
    topology: ChannelReport; texture: ChannelReport; palette: ChannelReport;
    spatial: ChannelReport;
  };
  coverage: { a: object; b: object; source: string };
  assetRisk: { level: 'LOW' | 'ELEVATED' | 'HIGH'; note: string };
  screen: ScreenReport;
  brightness: { shift: number };
  budgetUsed: number;
  extractionProfileIds: [string, string];
  contentTags: [string, string];
}

export interface CalProfile {
  container: 3; comparator: 51; provisional: boolean; name: string;
  hammingT: number; confidenceAt: number; alignT: number;
  invGateT: number; workBudget: number;
  thresholds: number[]; weights: number[];
  [field: string]: unknown;
}

export function hash(px: Uint8Array | Uint8ClampedArray, w: number, h: number,
                     opts?: object): HashResult;
export function parseT1(t1: Uint8Array): { flags: number; [field: string]: unknown };
export function parseT2(t2: Uint8Array): { list: object[]; [field: string]: unknown };

export function screen(a: Fingerprint | Uint8Array, b: Fingerprint | Uint8Array): ScreenReport;
export function compare(a: Fingerprint | Uint8Array, b: Fingerprint | Uint8Array,
                        opts?: { profile?: CalProfile | Uint8Array }): CompareReport;

export function cal(): CalProfile;   /* default CAL-051-PROVISIONAL; merge your own overrides */
export function lutIdentity(): Array<[number, number]>;
export function lutEval(lut: Array<[number, number]>, x: number): number;
export function profileEncode(p: CalProfile): Uint8Array;
export function profileDecode(bytes: Uint8Array): CalProfile;
export function profileValidate(p: CalProfile): true;   /* throws RangeError on invalid */
export function profileId(p: CalProfile): Uint8Array;
export function profileIdHex16(p: CalProfile): string;
export function profileName(p: CalProfile): string;

export const WIRE_VERSION: 5;
export const TIER1_BYTES: 2560;
export const MAX_KP: 512;
export const EXTRACTION_PROFILE: 'PAPH5-E03';
export const extractionProfileId: string;
export const COMPARATOR: 51;
export const CONTAINER: 3;
export const SCALE: 10000;
export const CHANNEL_ORDER: string[];

export const wire: object;
export const comparator: object;

declare const _default: object;
export default _default;
