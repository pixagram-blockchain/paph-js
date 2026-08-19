/** PAPH v3 — integer-only perceptual hash for pixel-art plagiarism detection. */

export type Scoring = 'gate' | 'weighted';
export type Evidence = 'lift' | 'proportion';
export type RagEndpoint = 'quantile' | 'rank';
export type VerdictName = 'Identical' | 'Copy' | 'Suspected' | 'Related' | 'Unrelated';
export type ChannelName =
  | 'dct' | 'local' | 'shape' | 'topology' | 'runs' | 'palette' | 'silhouette';

export interface ConfigInit {
  // --- hash time: these change the wire ---
  foldMatte?: boolean;
  divideUpscale?: boolean;
  matteTol?: number;
  peakRadius?: number;
  foldInvert?: boolean;
  localWindows?: [number, number];
  localCount?: number;
  kpCount?: number;
  sketchCount?: number;
  // --- compare time: free to re-derive without re-hashing ---
  hammingT?: number;
  evidence?: Evidence;
  confidenceAt?: number;
  scoring?: Scoring;
  ragEndpoint?: RagEndpoint;
  geoEnabled?: boolean;
  geoConfAt?: number;
  geoEps?: number;
  geoMinCorr?: number;
  mirrorHypothesis?: boolean;
}

/** Frozen on construction — derive with `.with()` rather than mutating. */
export declare class Config implements Required<ConfigInit> {
  constructor(over?: ConfigInit);
  readonly foldMatte: boolean;
  readonly divideUpscale: boolean;
  readonly matteTol: number;
  readonly peakRadius: number;
  readonly foldInvert: boolean;
  readonly localWindows: [number, number];
  readonly localCount: number;
  readonly kpCount: number;
  readonly sketchCount: number;
  readonly hammingT: number;
  readonly evidence: Evidence;
  readonly confidenceAt: number;
  readonly scoring: Scoring;
  readonly ragEndpoint: RagEndpoint;
  readonly geoEnabled: boolean;
  readonly geoConfAt: number;
  readonly geoEps: number;
  readonly geoMinCorr: number;
  readonly mirrorHypothesis: boolean;
  with(over: ConfigInit): Config;
  toJSON(): Required<ConfigInit>;
  static defaults(): Config;
  static validate(c: ConfigInit): string | null;
}

export interface Fingerprint {
  /** always exactly 3952 bytes */
  t1: Uint8Array;
  /** 32 + 40n bytes, n <= 256 */
  t2: Uint8Array;
  kpCount: number;
  crc: number;
  width: number;
  height: number;
}

export interface Channel {
  /** 0..10000, chance-corrected */
  value: number;
  raw: number;
  /** what this measurement scores against a deliberately wrong answer */
  control: number;
  /** false means the channel ABSTAINED and contributed nothing */
  measurable: boolean;
  controlRan: boolean;
  note: string;
}

export interface GeoChannel extends Channel {
  inliers: number;
  chanceInliers: number;
  accepted: number;
  hypothesis: 'direct' | 'mirrored' | 'none';
  /** recovered similarity scale, Q16 */
  scaleQ16?: number;
}

export interface Verdict {
  verdict: VerdictName;
  /** human-readable reason, e.g. "certified — structure and geometry agree" */
  class: string;
  /** which axes certified, if any */
  basis: Array<'structural' | 'geometric' | 'bytes'>;
  /** 0..10000 */
  structural: number;
  /** 0..10000; 0 when the geometric channel abstained */
  geometric: number;
  weighted: number;
  gate: number;
  identical: boolean;
  /** false when too few secondary channels were measurable to corroborate */
  structuralCertifiable: boolean;
  /** true when the two wires were exchanged to reach canonical argument order */
  swapped: boolean;
  channels: Record<ChannelName, Channel>;
  geo: GeoChannel;
  abstained: string[];
  report: {
    dihedral: string | null;
    inverted: boolean;
    mirrored: boolean | null;
    recoveredScale?: number;
    inliers: number;
    chanceInliers: number;
    palette: { relation: string; exact?: number; of?: number } | string;
    sameExport: boolean | null;
    geoHypothesis: string;
    evidenceBoth?: { lift: number; proportion: number };
  };
}

export type ImageInput =
  | ImageData
  | { px: Uint8Array | Uint8ClampedArray; w: number; h: number }
  | { pixels: Uint8Array | Uint8ClampedArray; width: number; height: number };

export declare class Paph {
  constructor(config?: Config | ConfigInit);
  readonly config: Config;
  readonly backend: 'js' | 'wasm';
  hash(image: ImageInput): Fingerprint;
  hash(bytes: Uint8Array | Uint8ClampedArray, width: number, height: number): Fingerprint;
  compare(a: Fingerprint, b: Fingerprint): Verdict;
  /** a new engine with a derived configuration; nothing is mutated */
  with(over: ConfigInit): Paph;
  parseTier1?(bytes: Uint8Array): unknown;
  parseTier2?(bytes: Uint8Array): unknown;
}

export declare const VERSION: number;
/** 3952 */
export declare const T1_BYTES: number;
export declare const SECTIONS: ReadonlyArray<{ id: number; name: string; len: number }>;
export declare const SECTION_OFFSETS: Readonly<Record<string, number>>;
export declare const THRESHOLDS: Readonly<Record<string, number>>;
export declare const DEFAULT_CONFIG: Readonly<Required<ConfigInit>>;

export declare function hash(image: ImageInput, opts?: ConfigInit): Fingerprint;
export declare function compare(a: Fingerprint, b: Fingerprint, opts?: ConfigInit): Verdict;
export declare function parseT1(bytes: Uint8Array): unknown;
export declare function parseT2(bytes: Uint8Array): unknown;

/**
 * Resolve the fastest available backend.  Both produce byte-identical wires
 * and identical verdicts — `npm run parity` is the check that says so — so the
 * JavaScript fallback is not a degraded mode, only a slower one.
 */
export declare function load(opts?: {
  prefer?: 'wasm' | 'js';
  wasm?: ArrayBuffer | Uint8Array | URL | string | Response;
}): Promise<{ backend: 'js' | 'wasm'; Config: typeof Config; Paph: typeof Paph; reason?: string }>;

/** Only exported from `@pixagram/paph-js/wasm`. */
export declare function init(source?: ArrayBuffer | Uint8Array | URL | string | Response): Promise<unknown>;
export declare function ready(): boolean;


/* ------------------------------------------------------------------------
 * The comparator layer — SPEC-004 (comparator 4) and SPEC-004.1 (41).
 *
 * Hashing is v3 and unchanged: the same 3952-byte Tier 1 and 32 + 40n
 * Tier 2 wires feed every comparator.  What a comparator adds is a
 * CALIBRATION PROFILE — an immutable artefact with its own SHA-256 identity —
 * and a verdict lattice that scores each channel against its own null.
 * A profile targets exactly one comparator, and the other refuses it.
 * ---------------------------------------------------------------------- */

/** A monotone calibration table: strictly increasing x from 0 to 10000. */
export type Lut = ReadonlyArray<readonly [number, number]>;

export interface Profile {
  /** 1 (comparator 4) or 2 (comparator 41, nine per-channel tables) */
  container: number;
  /** 4 or 41 */
  comparator: number;
  name: Uint8Array;
  evidenceRule: number; scoringRule: number; ragEndpoint: number; gridG: number;
  hammingT: number; confidenceAt: number; geoConfAt: number; geoEps: number;
  geoMinCorr: number; minModelInliers: number; maxModels: number;
  repExtremeAt: number; coverageFloor: number; minSecondaries: number;
  /** STRUCT_IDENTICAL, STRUCT_STRONG, STRUCT_MODERATE, STRUCT_WEAK, STRUCT_SOLO,
   *  GEO_STRONG, GEO_WEAK, GEO_SOLO_INLIERS, topology_dominant_at */
  thresholds: number[];
  /** local, shape, topology, runs, dct, palette, silhouette */
  weights: number[];
  /** max_width, max_height, max_pixels */
  limits: number[];
  lutLocal: Lut; lutGeometry: Lut; lutDiversity: Lut;
  /** container 2 only; identity when a container-1 profile is decoded */
  lutDct: Lut; lutShape: Lut; lutTopology: Lut;
  lutRuns: Lut; lutPalette: Lut; lutSilhouette: Lut;
}

export interface ModelRec {
  r00: number; r10: number; tx: number; ty: number;
  scaleQ16: number; mirror: boolean; inliers: number;
}

export interface CoverageRec {
  g: number; occupied: number; coverage: number;
  bboxCells: number; concentration: number; counts: ArrayLike<number>;
}

export interface V4Report {
  /** 4 or 41 */
  comparator: number;
  verdict: 'Identical' | 'Copy' | 'Suspected' | 'Related' | 'Unrelated' | 'Indeterminate';
  class: string;
  /** what carried the verdict: 'bytes', 'structural', 'geometric', and any rule that fired */
  basis: string[];
  /** populated only for Indeterminate: CORRUPT, PROFILE_MISMATCH, PROFILE_UNSUPPORTED, LIMIT */
  reasons: string[];
  structural: number;
  certifiable: boolean;
  v3: Verdict | null;
  local: unknown;
  models: ModelRec[];
  topology: number;
  totalInliers: number;
  coverage: CoverageRec | null;
  geometryEvidence: number;
  geoMeasurable: boolean;
  geoRaw: number; geoCtl: number; geoMargin: number; geoCtlMember: string;
  swapped: boolean;
  calibration: string;
  calibrationId: string;
  /** comparator 41 only — the §A1 weak-signal inlier count, 0 when a model was accepted */
  geoWeakInliers?: number;
  /** comparator 41 only — reserved for a screen result carried alongside a verdict */
  screen?: Screen | null;
}

/** SPEC-004.1 §A4 — correspondence pools only, no verification, no verdict. */
export interface Screen {
  /** a rejected pair is UNSCREENED, never Unrelated */
  pass: boolean;
  poolDirect: number;
  poolMirror: number;
}

/** Comparator 4 (SPEC-004). Requires a container-1 / comparator-4 profile. */
export declare function compareV4(
  aT1: Uint8Array, aT2: Uint8Array | null | undefined,
  bT1: Uint8Array, bT2: Uint8Array | null | undefined,
  opts: ConfigInit | undefined, profile: Profile,
  hashProfileA?: Uint8Array, hashProfileB?: Uint8Array
): V4Report;

/** Comparator 41 (SPEC-004.1). Requires a container-2 / comparator-41 profile. */
export declare function compareV41(
  aT1: Uint8Array, aT2: Uint8Array | null | undefined,
  bT1: Uint8Array, bT2: Uint8Array | null | undefined,
  opts: ConfigInit | undefined, profile: Profile,
  hashProfileA?: Uint8Array, hashProfileB?: Uint8Array
): V4Report;

/** The stage-1 screen: cheap, advisory, and never a verdict. */
export declare function screenV41(
  aT1: Uint8Array, aT2: Uint8Array | null | undefined,
  bT1: Uint8Array, bT2: Uint8Array | null | undefined,
  opts: ConfigInit | undefined, profile: Profile
): Screen;

/** Hash with the profile's declared limits enforced first (SPEC-004 §16). */
export declare function hashChecked(
  image: ImageInput, opts: ConfigInit | undefined, limits?: number[]
): Fingerprint;

/** CAL-001-PROVISIONAL — the comparator-4 profile. */
export declare function cal001(): Profile;
/** CAL-003-PROPOSED — the comparator-41 profile, pending M7 validation. */
export declare function cal003(): Profile;

export declare function profileEncode(p: Profile): Uint8Array;
export declare function profileDecode(bytes: Uint8Array): Profile;
/** SHA-256 over the encoded artefact — the identity a verdict cites. */
export declare function profileId(p: Profile): Uint8Array;

export declare const COMPARATOR: 4;
export declare const COMPARATOR_V41: 41;
