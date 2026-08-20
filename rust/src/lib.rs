//! PAPH — integer-only perceptual hash for pixel-art plagiarism detection.
//! Wire: PAPH-SPEC-003 (format 3, unchanged).  Comparator: PAPH-SPEC-004.2
//! (comparator 42) with 4 and 41 frozen beside it.  Zero dependencies, on
//! purpose.
pub mod assignment;
pub mod calibration;
pub mod compare;
pub mod coverage;
pub mod config;
pub mod front;
pub mod geom42;
pub mod golden;
pub mod keypoints;
pub mod lattice;
pub mod local_v4;
pub mod multimodel;
pub mod nulls;
pub mod sha256;
pub mod v4;
pub mod v41;
pub mod v42;
pub mod sections;
pub mod tables;
pub mod wire;

// ===================================================================== //
// C ABI export surface for WebAssembly.
//
// Deliberately NOT wasm-bindgen.  A consensus artefact should be auditable in
// one sitting: four exported functions and a length-prefixed byte block, with
// the JavaScript glue written by hand next to it.  wasm-bindgen would add a
// build-time code generator between the source and the shipped binary, and the
// binary is the thing two nodes have to agree about.
//
//   paph_alloc(len)                          -> ptr
//   paph_free(ptr, len)
//   paph_hash(cfg_ptr, px_ptr, w, h)         -> ptr to [u32 t1len][u32 t2len][t1][t2]
//   paph_compare(cfg_ptr, a1,a1n, a2,a2n, b1,b1n, b2,b2n) -> ptr to [u32 len][utf8 json]
//   paph_release(ptr)                        frees a returned block
//
// The config is a flat i32 array so the glue never has to serialise a struct.
// ===================================================================== //

use crate::config::{Config, Evidence, RagEndpoint, Scoring, MAX_KP_COUNT};
use crate::keypoints::{pattern, RotCache};

pub const CFG_FIELDS: usize = 21;

fn config_from(p: *const i32) -> Config {
    let mut c = Config::default();
    if p.is_null() {
        return c;
    }
    let v = unsafe { std::slice::from_raw_parts(p, CFG_FIELDS) };
    c.fold_matte = v[0] != 0;
    c.divide_upscale = v[1] != 0;
    c.matte_tol = v[2];
    c.peak_radius = v[3];
    c.fold_invert = v[4] != 0;
    c.local_windows = [v[5], v[6]];
    c.local_count = v[7].clamp(4, 128) as usize;
    c.kp_count = v[8].clamp(0, MAX_KP_COUNT as i32) as usize;
    c.sketch_count = v[9].clamp(0, 32) as usize;
    c.hamming_t = v[10];
    c.evidence = if v[11] == 1 { Evidence::Proportion } else { Evidence::Lift };
    c.confidence_at = v[12];
    c.scoring = if v[13] == 1 { Scoring::Weighted } else { Scoring::Gate };
    c.rag_endpoint = if v[14] == 1 { RagEndpoint::Rank } else { RagEndpoint::Quantile };
    c.geo_enabled = v[15] != 0;
    c.geo_conf_at = v[16];
    c.geo_eps = v[17];
    c.mirror_hypothesis = v[18] != 0;
    c.geo_min_corr = v[19].clamp(2, 64) as usize;
    c.kp_select = v[20].clamp(0, 1);
    c
}

/// Write the shipping defaults into a caller-provided i32 array.
#[no_mangle]
pub extern "C" fn paph_default_config(out: *mut i32) {
    let c = Config::default();
    let v = unsafe { std::slice::from_raw_parts_mut(out, CFG_FIELDS) };
    v[0] = c.fold_matte as i32;
    v[1] = c.divide_upscale as i32;
    v[2] = c.matte_tol;
    v[3] = c.peak_radius;
    v[4] = c.fold_invert as i32;
    v[5] = c.local_windows[0];
    v[6] = c.local_windows[1];
    v[7] = c.local_count as i32;
    v[8] = c.kp_count as i32;
    v[9] = c.sketch_count as i32;
    v[10] = c.hamming_t;
    v[11] = (c.evidence == Evidence::Proportion) as i32;
    v[12] = c.confidence_at;
    v[13] = (c.scoring == Scoring::Weighted) as i32;
    v[14] = (c.rag_endpoint == RagEndpoint::Rank) as i32;
    v[15] = c.geo_enabled as i32;
    v[16] = c.geo_conf_at;
    v[17] = c.geo_eps;
    v[18] = c.mirror_hypothesis as i32;
    v[19] = c.geo_min_corr as i32;
    v[20] = c.kp_select;
}

#[no_mangle]
pub extern "C" fn paph_version() -> u32 {
    crate::wire::VERSION as u32
}
#[no_mangle]
pub extern "C" fn paph_t1_bytes() -> u32 {
    crate::wire::T1_BYTES as u32
}
#[no_mangle]
pub extern "C" fn paph_config_fields() -> u32 {
    CFG_FIELDS as u32
}

#[no_mangle]
pub extern "C" fn paph_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub extern "C" fn paph_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        unsafe { drop(Vec::from_raw_parts(ptr, 0, len)) }
    }
}

/// Hand a Vec back to JavaScript as a length-prefixed block it can read and
/// then release.  The first 4 bytes are the payload length.
fn out_block(payload: Vec<u8>) -> *mut u8 {
    let mut v = Vec::with_capacity(payload.len() + 8);
    v.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    v.extend_from_slice(&(v.capacity() as u32).to_le_bytes());
    v.extend_from_slice(&payload);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub extern "C" fn paph_release(ptr: *mut u8) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        let len = u32::from_le_bytes([*ptr, *ptr.add(1), *ptr.add(2), *ptr.add(3)]) as usize;
        drop(Vec::from_raw_parts(ptr, len + 8, len + 8));
    }
}

/// -> [u32 payload_len][u32 _][u32 t1len][u32 t2len][t1][t2]
#[no_mangle]
pub extern "C" fn paph_hash(cfg: *const i32, px: *const u8, w: u32, h: u32) -> *mut u8 {
    let (w, h) = (w as usize, h as usize);
    let c = config_from(cfg);
    let pixels = unsafe { std::slice::from_raw_parts(px, w * h * 4) };
    let rot = RotCache::new(&pattern());
    let fp = crate::wire::hash(pixels, w, h, &c, &rot);
    let mut payload = Vec::with_capacity(8 + fp.t1.len() + fp.t2.len());
    payload.extend_from_slice(&(fp.t1.len() as u32).to_le_bytes());
    payload.extend_from_slice(&(fp.t2.len() as u32).to_le_bytes());
    payload.extend_from_slice(&fp.t1);
    payload.extend_from_slice(&fp.t2);
    out_block(payload)
}

/// -> [u32 payload_len][u32 _][utf8 json]
#[allow(clippy::too_many_arguments)]
#[no_mangle]
pub extern "C" fn paph_compare(
    cfg: *const i32,
    a1: *const u8, a1n: usize,
    a2: *const u8, a2n: usize,
    b1: *const u8, b1n: usize,
    b2: *const u8, b2n: usize,
) -> *mut u8 {
    let c = config_from(cfg);
    let s = |p: *const u8, n: usize| -> Option<&'static [u8]> {
        if p.is_null() || n == 0 { None } else { Some(unsafe { std::slice::from_raw_parts(p, n) }) }
    };
    let json = match crate::compare::compare(
        s(a1, a1n).unwrap_or(&[]),
        s(a2, a2n),
        s(b1, b1n).unwrap_or(&[]),
        s(b2, b2n),
        &c,
    ) {
        Ok(v) => crate::compare::to_json(&v),
        Err(e) => format!("{{\"error\":\"{}\"}}", e),
    };
    out_block(json.into_bytes())
}
