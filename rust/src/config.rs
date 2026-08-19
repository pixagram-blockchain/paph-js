//! Compare-time configuration.
//!
//! SPEC-003 P1: every knob here is a COMPARE-time choice.  Moving one
//! re-decides a pair without re-hashing anything, which is the whole argument
//! for the larger wire budget.  Three fields (`local_count`, `kp_count`,
//! `sketch_count`) do change the wire and are marked as such.

/// Fixed-point scale for every channel reading: 0 ..= 10000.
pub const SCALE: i64 = 10_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scoring {
    /// the weakest of evidence and corroboration — refuses to certify on one channel
    Gate,
    /// weighted mean over measurable channels
    Weighted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Evidence {
    /// purity x confidence
    Lift,
    /// share of achievable match
    Proportion,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RagEndpoint {
    /// survives a rebuilt palette
    Quantile,
    /// does not — so agreement means the palette was NOT rebuilt
    Rank,
}

#[derive(Clone, Copy, Debug)]
pub struct Config {
    // --- hash time: these DO change the wire ---
    pub fold_matte: bool,
    pub divide_upscale: bool,
    pub matte_tol: i32,
    pub peak_radius: i32,
    pub fold_invert: bool,
    pub local_windows: [i32; 2],
    pub local_count: usize,
    pub kp_count: usize,
    pub sketch_count: usize,

    // --- compare time: free to re-derive at any moment ---
    pub hamming_t: i32,
    pub evidence: Evidence,
    pub confidence_at: i32,
    pub scoring: Scoring,
    pub rag_endpoint: RagEndpoint,
    pub geo_enabled: bool,
    pub geo_conf_at: i32,
    pub geo_eps: i32,
    pub geo_min_corr: usize,
    pub mirror_hypothesis: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            fold_matte: true,
            divide_upscale: true,
            matte_tol: 24,
            peak_radius: 5,
            fold_invert: true,
            local_windows: [8, 16],
            local_count: 128,
            kp_count: 256,
            sketch_count: 32,

            hamming_t: 8,
            evidence: Evidence::Lift,
            confidence_at: 16,
            scoring: Scoring::Weighted,
            rag_endpoint: RagEndpoint::Rank,
            geo_enabled: true,
            geo_conf_at: 16,
            geo_eps: 1600,
            geo_min_corr: 8,
            mirror_hypothesis: true,
        }
    }
}

impl Config {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !(0..=64).contains(&self.hamming_t) {
            return Err("hammingT out of range");
        }
        if self.confidence_at < 1 {
            return Err("confidenceAt must be at least 1");
        }
        if self.geo_conf_at < 1 {
            return Err("geoConfAt must be at least 1");
        }
        if !(1..=32767).contains(&self.geo_eps) {
            return Err("geoEps out of range");
        }
        if !(4..=128).contains(&self.local_count) {
            return Err("localCount out of range (wire holds 128)");
        }
        if self.kp_count > 256 {
            return Err("kpCount out of range (tier 2 holds 256)");
        }
        if self.sketch_count > 32 {
            return Err("sketchCount out of range (tier 1 holds 32)");
        }
        Ok(())
    }
}

/// Verdict thresholds.
///
/// The structural side was derived from 16 real works rather than fixtures.
/// The geometric side is a PROPOSAL — SPEC-003 §14.7 says re-derive it on real
/// moderation reports, not on a 16-work corpus.
pub struct Thresholds;
impl Thresholds {
    pub const STRUCT_IDENTICAL: i64 = 8000;
    pub const STRUCT_STRONG: i64 = 4500;
    pub const STRUCT_MODERATE: i64 = 3000;
    pub const STRUCT_WEAK: i64 = 1500;
    pub const GEO_STRONG: i64 = 3500;
    pub const GEO_WEAK: i64 = 1200;
    /// geometry certifying on its own needs more than this many inliers
    pub const GEO_SOLO_INLIERS: i64 = 15;
    /// 1.5 x STRUCT_STRONG — structure certifying on its own
    pub const STRUCT_SOLO: i64 = 6750;
}

/// Channel weights for `Scoring::Weighted`.
pub fn weight(name: &str) -> i64 {
    match name {
        "local" => 35,
        "shape" => 25,
        "topology" => 15,
        "runs" => 10,
        "dct" => 10,
        "palette" => 5,
        "silhouette" => 10,
        _ => 0,
    }
}

// ---- small deterministic helpers, shared by every module ----

/// Integer divide, truncating toward zero — matches JavaScript's `(a / b) | 0`.
#[inline(always)]
pub fn idiv(a: i64, b: i64) -> i64 {
    if b == 0 {
        0
    } else {
        a / b
    }
}

#[inline(always)]
pub fn clamp(v: i64, lo: i64, hi: i64) -> i64 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

/// Exact integer square root.  No float seed: two engines must not be able to
/// disagree here, and the binary method is not measurably slower at this size.
#[inline]
pub fn isqrt(n: i64) -> i64 {
    if n <= 0 {
        return 0;
    }
    let mut x = n as u64;
    let mut r: u64 = 0;
    let mut bit: u64 = 1u64 << 62;
    while bit > x {
        bit >>= 2;
    }
    while bit != 0 {
        if x >= r + bit {
            x -= r + bit;
            r = (r >> 1) + bit;
        } else {
            r >>= 1;
        }
        bit >>= 2;
    }
    r as i64
}

/// Subtract a channel's own chance floor, in the 0..SCALE currency.
#[inline]
pub fn chance_correct(raw: i64, ctl: i64) -> i64 {
    if ctl >= SCALE {
        0
    } else {
        clamp((raw - ctl) * SCALE / (SCALE - ctl), 0, SCALE)
    }
}
