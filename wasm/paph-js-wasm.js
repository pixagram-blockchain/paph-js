/**
 * paph3 — WebAssembly backend.
 *
 * Hand-written glue over a five-function C ABI, deliberately not wasm-bindgen.
 * A consensus artefact should be auditable in one sitting: what crosses the
 * boundary is a flat i32 config array in and a length-prefixed byte block out,
 * and you can read the whole contract here without a code generator in the way.
 *
 * The API is identical to the JavaScript backend, so callers can switch on
 * `backend` and nothing else:
 *
 *     import { init, Config, Paph } from '@pixagram/paph-js/wasm';
 *     await init();                                  // once
 *     const engine = new Paph();                     // or new Paph({ hammingT: 4 })
 *     const fp = engine.hash(imageData);
 *     const verdict = engine.compare(fpA, fpB);
 */

/* Field order MUST match paph_default_config in rust/src/lib.rs. */
const FIELDS = [
  'foldMatte', 'divideUpscale', 'matteTol', 'peakRadius', 'foldInvert',
  'localWindow0', 'localWindow1', 'localCount', 'kpCount', 'sketchCount',
  'hammingT', 'evidenceIsProportion', 'confidenceAt', 'scoringIsWeighted',
  'ragEndpointIsRank', 'geoEnabled', 'geoConfAt', 'geoEps', 'mirrorHypothesis',
  'geoMinCorr', 'kpSelect'
];

let wasm = null;
let mem = null;

function refresh() {
  /* the buffer is detached on every memory growth, so never cache the view */
  if (!mem || mem.buffer !== wasm.memory.buffer) mem = new DataView(wasm.memory.buffer);
  return mem;
}
function u8() { return new Uint8Array(wasm.memory.buffer); }

/**
 * Load the module.  Pass a URL, an ArrayBuffer, a Response, or nothing to let
 * the loader find `paph.wasm` next to this file.
 */
export async function init(source) {
  if (wasm) return wasm;
  let bytes = source;
  if (bytes === undefined) {
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      const { readFile } = await import('node:fs/promises');
      const { fileURLToPath } = await import('node:url');
      bytes = await readFile(fileURLToPath(new URL('./paph.wasm', import.meta.url)));
    } else {
      bytes = new URL('./paph.wasm', import.meta.url);
    }
  }
  let mod;
  if (bytes instanceof URL || typeof bytes === 'string') {
    mod = await WebAssembly.instantiateStreaming(fetch(bytes), {}).catch(async function () {
      const r = await fetch(bytes);
      return WebAssembly.instantiate(await r.arrayBuffer(), {});
    });
  } else if (typeof Response !== 'undefined' && bytes instanceof Response) {
    mod = await WebAssembly.instantiateStreaming(bytes, {});
  } else {
    const ab = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
    mod = await WebAssembly.instantiate(ab, {});
  }
  wasm = mod.instance.exports;
  mem = null;
  if (wasm.paph_version() !== 3) throw new Error('paph3: wasm module reports a different version');
  return wasm;
}

export function ready() { return wasm !== null; }

function defaults() {
  const n = wasm.paph_config_fields();
  const p = wasm.paph_alloc(n * 4);
  wasm.paph_default_config(p);
  const d = refresh();
  const out = {};
  for (let i = 0; i < n; i++) out[FIELDS[i]] = d.getInt32(p + i * 4, true);
  wasm.paph_free(p, n * 4);
  return out;
}

/* the JS-facing config shape, mapped onto the flat i32 array the ABI takes */
function toFlat(cfg) {
  return [
    cfg.foldMatte ? 1 : 0,
    cfg.divideUpscale ? 1 : 0,
    cfg.matteTol | 0,
    cfg.peakRadius | 0,
    cfg.foldInvert ? 1 : 0,
    cfg.localWindows[0] | 0,
    cfg.localWindows[1] | 0,
    cfg.localCount | 0,
    cfg.kpCount | 0,
    cfg.sketchCount | 0,
    cfg.hammingT | 0,
    cfg.evidence === 'proportion' ? 1 : 0,
    cfg.confidenceAt | 0,
    cfg.scoring === 'weighted' ? 1 : 0,
    cfg.ragEndpoint === 'rank' ? 1 : 0,
    cfg.geoEnabled ? 1 : 0,
    cfg.geoConfAt | 0,
    cfg.geoEps | 0,
    cfg.mirrorHypothesis ? 1 : 0,
    cfg.geoMinCorr | 0,
    /* SPEC-004.2 §3 — 0 = the 4.1 strength/grid rule, 1 = the quality rule */
    cfg.kpSelect === 0 ? 0 : 1
  ];
}

function writeConfig(cfg) {
  const flat = toFlat(cfg);
  const p = wasm.paph_alloc(flat.length * 4);
  const d = refresh();
  for (let i = 0; i < flat.length; i++) d.setInt32(p + i * 4, flat[i], true);
  return { ptr: p, len: flat.length * 4 };
}

function writeBytes(bytes) {
  if (!bytes || !bytes.length) return { ptr: 0, len: 0 };
  const p = wasm.paph_alloc(bytes.length);
  u8().set(bytes, p);
  return { ptr: p, len: bytes.length };
}

function readBlock(ptr) {
  const d = refresh();
  const len = d.getUint32(ptr, true);
  return u8().slice(ptr + 8, ptr + 8 + len);
}

/**
 * Frozen on construction.  The whole point of SPEC-003 P1 is that these are
 * compare-time choices, so a config is a value you pass around and derive from,
 * not a mutable bag that drifts between two call sites.
 */
export class Config {
  constructor(over) {
    if (!wasm) throw new Error('paph3: call await init() before constructing a Config');
    const base = Config._defaults || (Config._defaults = defaults());
    this.foldMatte = !!base.foldMatte;
    this.divideUpscale = !!base.divideUpscale;
    this.matteTol = base.matteTol;
    this.peakRadius = base.peakRadius;
    this.foldInvert = !!base.foldInvert;
    this.localWindows = [base.localWindow0, base.localWindow1];
    this.localCount = base.localCount;
    this.kpCount = base.kpCount;
    this.kpSelect = base.kpSelect;
    this.sketchCount = base.sketchCount;
    this.hammingT = base.hammingT;
    this.evidence = base.evidenceIsProportion ? 'proportion' : 'lift';
    this.confidenceAt = base.confidenceAt;
    this.scoring = base.scoringIsWeighted ? 'weighted' : 'gate';
    this.ragEndpoint = base.ragEndpointIsRank ? 'rank' : 'quantile';
    this.geoEnabled = !!base.geoEnabled;
    this.geoConfAt = base.geoConfAt;
    this.geoEps = base.geoEps;
    this.mirrorHypothesis = !!base.mirrorHypothesis;
    this.geoMinCorr = base.geoMinCorr;
    if (over) {
      for (const k in over) {
        if (!(k in this)) throw new RangeError('paph3: unknown config key "' + k + '"');
        if (over[k] !== undefined) this[k] = over[k];
      }
    }
    const e = Config.validate(this);
    if (e) throw new RangeError('paph3: ' + e);
    Object.freeze(this);
    Object.freeze(this.localWindows);
  }
  with(over) {
    const m = {};
    for (const k in this) m[k] = this[k];
    if (over) for (const k in over) m[k] = over[k];
    return new Config(m);
  }
  toJSON() { const m = {}; for (const k in this) m[k] = this[k]; return m; }
  static defaults() { return new Config(); }
  static validate(c) {
    if (['gate', 'weighted'].indexOf(c.scoring) < 0) return 'scoring must be gate or weighted';
    if (['lift', 'proportion'].indexOf(c.evidence) < 0) return 'evidence must be lift or proportion';
    if (['quantile', 'rank'].indexOf(c.ragEndpoint) < 0) return 'ragEndpoint must be quantile or rank';
    if (!(c.hammingT >= 0 && c.hammingT <= 64)) return 'hammingT out of range';
    if (!(c.confidenceAt >= 1)) return 'confidenceAt must be at least 1';
    if (!(c.geoConfAt >= 1)) return 'geoConfAt must be at least 1';
    if (!(c.geoEps >= 1 && c.geoEps <= 32767)) return 'geoEps out of range';
    if (!(c.localCount >= 4 && c.localCount <= 128)) return 'localCount out of range (wire holds 128)';
    if (!(c.kpCount >= 0 && c.kpCount <= 512)) return 'kpCount out of range (tier 2 holds 512)';
    if (!(c.kpSelect === 0 || c.kpSelect === 1)) return 'kpSelect must be 0 (4.1) or 1 (4.2)';
    if (!(c.sketchCount >= 0 && c.sketchCount <= 32)) return 'sketchCount out of range (tier 1 holds 32)';
    if (!(c.geoMinCorr >= 2 && c.geoMinCorr <= 64)) return 'geoMinCorr out of range';
    return null;
  }
}

function readImage(a, b, c) {
  if (a && a.data && a.width && a.height) return { px: a.data, w: a.width | 0, h: a.height | 0 };
  if (a && a.px && a.w && a.h) return { px: a.px, w: a.w | 0, h: a.h | 0 };
  if (a && a.pixels && a.width && a.height) return { px: a.pixels, w: a.width | 0, h: a.height | 0 };
  if (a && typeof b === 'number' && typeof c === 'number') return { px: a, w: b | 0, h: c | 0 };
  throw new TypeError('paph3: expected ImageData, {px,w,h}, {pixels,width,height} or (bytes,w,h)');
}

export class Paph {
  constructor(config) {
    if (!wasm) throw new Error('paph3: call await init() before constructing a Paph');
    this.config = (config instanceof Config) ? config : new Config(config);
    Object.freeze(this);
  }

  /** -> { t1: Uint8Array(3952), t2: Uint8Array, kpCount, crc } */
  hash(a, b, c) {
    const im = readImage(a, b, c);
    const cfg = writeConfig(this.config);
    const px = writeBytes(im.px instanceof Uint8Array ? im.px : new Uint8Array(im.px.buffer || im.px));
    let out;
    try {
      const p = wasm.paph_hash(cfg.ptr, px.ptr, im.w, im.h);
      const blk = readBlock(p);
      wasm.paph_release(p);
      const d = new DataView(blk.buffer, blk.byteOffset, blk.byteLength);
      const t1len = d.getUint32(0, true), t2len = d.getUint32(4, true);
      const t1 = blk.slice(8, 8 + t1len), t2 = blk.slice(8 + t1len, 8 + t1len + t2len);
      out = {
        t1, t2,
        kpCount: new DataView(t1.buffer, t1.byteOffset).getUint16(14, true),
        crc: new DataView(t1.buffer, t1.byteOffset).getUint32(60, true),
        width: new DataView(t1.buffer, t1.byteOffset).getUint16(8, true),
        height: new DataView(t1.buffer, t1.byteOffset).getUint16(10, true)
      };
    } finally {
      wasm.paph_free(cfg.ptr, cfg.len);
      if (px.ptr) wasm.paph_free(px.ptr, px.len);
    }
    return out;
  }

  /** Accepts either the objects hash() returned, or raw { t1, t2 } wires. */
  compare(A, B) {
    const cfg = writeConfig(this.config);
    const a1 = writeBytes(A.t1), a2 = writeBytes(A.t2);
    const b1 = writeBytes(B.t1), b2 = writeBytes(B.t2);
    let out;
    try {
      const p = wasm.paph_compare(cfg.ptr, a1.ptr, a1.len, a2.ptr, a2.len, b1.ptr, b1.len, b2.ptr, b2.len);
      const blk = readBlock(p);
      wasm.paph_release(p);
      out = JSON.parse(new TextDecoder().decode(blk));
    } finally {
      wasm.paph_free(cfg.ptr, cfg.len);
      for (const s of [a1, a2, b1, b2]) if (s.ptr) wasm.paph_free(s.ptr, s.len);
    }
    if (out.error) throw new Error('paph3: ' + out.error);
    return out;
  }

  with(over) { return new Paph(this.config.with(over)); }
}

Paph.prototype.backend = 'wasm';
export const backend = 'wasm';
export const T1_BYTES = 3952;
export const VERSION = 3;
