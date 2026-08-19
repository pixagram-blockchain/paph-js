//! The calibration profile artefact (SPEC-004 §8, Appendix B).
//!
//! Calibration is data, not code (P7): one immutable byte artefact, one
//! canonical encoding, SHA-256 identity.  The struct in memory is a *view* of
//! the bytes; decode(encode(p)) round-trips bit-exactly and the conformance
//! suite asserts it.  Anything that fails validation is PROFILE_UNSUPPORTED —
//! a profile is never "mostly loaded".

use crate::config::SCALE;
use crate::sha256::{hex, sha256};

pub const CONTAINER_VERSION: u16 = 1;
pub const COMPARATOR_VERSION: u16 = 4;
/// SPEC-004.1: container 2 carries nine per-channel tables; comparator 41.
pub const CONTAINER_V2: u16 = 2;
pub const COMPARATOR_V41: u16 = 41;
const MAGIC: &[u8; 4] = b"PCAL";
const FIXED: usize = 144; // bytes before the LUT block, Appendix B
const MAX_BREAKPOINTS: usize = 33;

/// Monotone breakpoint table (§8.3): x strictly increasing 0 → SCALE,
/// y non-decreasing, all in currency.  Evaluation is integer linear
/// interpolation with `idiv` truncation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lut(pub Vec<(u16, u16)>);

impl Lut {
    pub fn identity() -> Lut {
        Lut(vec![(0, 0), (SCALE as u16, SCALE as u16)])
    }
    /// Neutral for a MULTIPLIER table (§10.4): constant SCALE, so
    /// `evidence · eval(D) / SCALE` is a no-op.  Identity is neutral for a
    /// margin→evidence mapping; for a modulation it would multiply by
    /// D/SCALE — the distinction Appendix C spells out.
    pub fn neutral() -> Lut {
        Lut(vec![(0, SCALE as u16), (SCALE as u16, SCALE as u16)])
    }
    pub fn validate(&self) -> Result<(), &'static str> {
        let p = &self.0;
        if p.len() < 2 || p.len() > MAX_BREAKPOINTS {
            return Err("lut breakpoint count");
        }
        if p[0].0 != 0 || p[p.len() - 1].0 as i64 != SCALE {
            return Err("lut must span 0..SCALE");
        }
        for w in p.windows(2) {
            if w[1].0 <= w[0].0 {
                return Err("lut x not strictly increasing");
            }
            if w[1].1 < w[0].1 {
                return Err("lut y not monotone");
            }
        }
        if p.iter().any(|&(_, y)| y as i64 > SCALE) {
            return Err("lut y out of currency");
        }
        Ok(())
    }
    pub fn eval(&self, x: i64) -> i64 {
        let x = x.clamp(0, SCALE);
        let p = &self.0;
        let mut i = 0;
        while i + 2 < p.len() && (p[i + 1].0 as i64) < x {
            i += 1;
        }
        // hold the last breakpoint exactly
        if i + 2 == p.len() && x >= p[i + 1].0 as i64 {
            return p[i + 1].1 as i64;
        }
        let (x0, y0) = (p[i].0 as i64, p[i].1 as i64);
        let (x1, y1) = (p[i + 1].0 as i64, p[i + 1].1 as i64);
        y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Profile {
    /// (container, comparator): (1, 4) or (2, 41) — SPEC-004.1 §A3
    pub container: u16,
    pub comparator: u16,
    pub name: [u8; 16],
    pub evidence_rule: u8, // 0 = Lift (bound; Proportion retired from decisions)
    pub scoring_rule: u8,  // 1 = Weighted (bound; Gate retired)
    pub rag_endpoint: u8,  // 1 = Rank
    pub grid_g: u8,
    pub hamming_t: i32,
    pub confidence_at: i32,
    pub geo_conf_at: i32,
    pub geo_eps: i32,
    pub geo_min_corr: i32,
    pub min_model_inliers: i32,
    pub max_models: i32,
    pub rep_extreme_at: i32,
    pub coverage_floor: i32,
    pub min_secondaries: i32,
    /// identical, struct strong/moderate/weak, struct solo,
    /// geo strong, geo weak, geo solo inliers, topology dominant at
    pub thresholds: [i32; 9],
    /// local, shape, topology, runs, dct, palette, silhouette
    pub weights: [i32; 7],
    /// max_width, max_height, max_pixels
    pub limits: [i32; 3],
    pub lut_local: Lut,
    pub lut_geometry: Lut,
    pub lut_diversity: Lut,
    /// container-2 per-channel tables (identity when decoded from container 1)
    pub lut_dct: Lut,
    pub lut_shape: Lut,
    pub lut_topology: Lut,
    pub lut_runs: Lut,
    pub lut_palette: Lut,
    pub lut_silhouette: Lut,
}

fn w32(b: &mut Vec<u8>, v: i32) {
    b.extend_from_slice(&v.to_le_bytes());
}
fn r32(b: &[u8], o: usize) -> i32 {
    i32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

impl Profile {
    pub fn name_str(&self) -> String {
        let end = self.name.iter().position(|&c| c == 0).unwrap_or(16);
        String::from_utf8_lossy(&self.name[..end]).into_owned()
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut b = Vec::with_capacity(FIXED + 64);
        b.extend_from_slice(MAGIC);
        b.extend_from_slice(&self.container.to_le_bytes());
        b.extend_from_slice(&self.comparator.to_le_bytes());
        b.extend_from_slice(&self.name);
        b.push(self.evidence_rule);
        b.push(self.scoring_rule);
        b.push(self.rag_endpoint);
        b.push(self.grid_g);
        for v in [
            self.hamming_t, self.confidence_at, self.geo_conf_at, self.geo_eps,
            self.geo_min_corr, self.min_model_inliers, self.max_models,
            self.rep_extreme_at, self.coverage_floor, self.min_secondaries,
        ] {
            w32(&mut b, v);
        }
        for v in self.thresholds {
            w32(&mut b, v);
        }
        for v in self.weights {
            w32(&mut b, v);
        }
        for v in self.limits {
            w32(&mut b, v);
        }
        debug_assert_eq!(b.len(), FIXED);
        for lut in self.lut_table() {
            b.extend_from_slice(&(lut.0.len() as u16).to_le_bytes());
            for &(x, y) in &lut.0 {
                b.extend_from_slice(&x.to_le_bytes());
                b.extend_from_slice(&y.to_le_bytes());
            }
        }
        b
    }

    /// The container's table list, canonical order (SPEC-004.1 §A3).
    fn lut_table(&self) -> Vec<&Lut> {
        let mut v = vec![&self.lut_local, &self.lut_geometry, &self.lut_diversity];
        if self.container == CONTAINER_V2 {
            v.extend([&self.lut_dct, &self.lut_shape, &self.lut_topology,
                      &self.lut_runs, &self.lut_palette, &self.lut_silhouette]);
        }
        v
    }

    /// A structural channel's table by name — identity semantics for any
    /// channel a container-1 profile never heard of.
    pub fn lut_channel(&self, name: &str) -> &Lut {
        match name {
            "dct" => &self.lut_dct,
            "shape" => &self.lut_shape,
            "topology" => &self.lut_topology,
            "runs" => &self.lut_runs,
            "palette" => &self.lut_palette,
            "silhouette" => &self.lut_silhouette,
            _ => &self.lut_local,
        }
    }

    pub fn decode(b: &[u8]) -> Result<Profile, &'static str> {
        if b.len() < FIXED + 3 * 2 {
            return Err("profile too short");
        }
        if &b[0..4] != MAGIC {
            return Err("bad profile magic");
        }
        let container = u16::from_le_bytes([b[4], b[5]]);
        let comparator = u16::from_le_bytes([b[6], b[7]]);
        let nlut = match (container, comparator) {
            (CONTAINER_VERSION, COMPARATOR_VERSION) => 3,
            (CONTAINER_V2, COMPARATOR_V41) => 9,
            (CONTAINER_VERSION, _) | (CONTAINER_V2, _) => {
                return Err("profile targets another comparator")
            }
            _ => return Err("unsupported container version"),
        };
        let mut name = [0u8; 16];
        name.copy_from_slice(&b[8..24]);
        let mut p = Profile {
            container,
            comparator,
            name,
            evidence_rule: b[24],
            scoring_rule: b[25],
            rag_endpoint: b[26],
            grid_g: b[27],
            hamming_t: r32(b, 28),
            confidence_at: r32(b, 32),
            geo_conf_at: r32(b, 36),
            geo_eps: r32(b, 40),
            geo_min_corr: r32(b, 44),
            min_model_inliers: r32(b, 48),
            max_models: r32(b, 52),
            rep_extreme_at: r32(b, 56),
            coverage_floor: r32(b, 60),
            min_secondaries: r32(b, 64),
            thresholds: [0; 9],
            weights: [0; 7],
            limits: [0; 3],
            lut_local: Lut(Vec::new()),
            lut_geometry: Lut(Vec::new()),
            lut_diversity: Lut(Vec::new()),
            lut_dct: Lut::identity(),
            lut_shape: Lut::identity(),
            lut_topology: Lut::identity(),
            lut_runs: Lut::identity(),
            lut_palette: Lut::identity(),
            lut_silhouette: Lut::identity(),
        };
        for i in 0..9 {
            p.thresholds[i] = r32(b, 68 + i * 4);
        }
        for i in 0..7 {
            p.weights[i] = r32(b, 104 + i * 4);
        }
        for i in 0..3 {
            p.limits[i] = r32(b, 132 + i * 4);
        }
        let mut o = FIXED;
        let mut luts = Vec::with_capacity(nlut);
        for _ in 0..nlut {
            if o + 2 > b.len() {
                return Err("truncated lut header");
            }
            let k = u16::from_le_bytes([b[o], b[o + 1]]) as usize;
            o += 2;
            if o + k * 4 > b.len() {
                return Err("truncated lut");
            }
            let mut pts = Vec::with_capacity(k);
            for i in 0..k {
                pts.push((
                    u16::from_le_bytes([b[o + i * 4], b[o + i * 4 + 1]]),
                    u16::from_le_bytes([b[o + i * 4 + 2], b[o + i * 4 + 3]]),
                ));
            }
            o += k * 4;
            luts.push(Lut(pts));
        }
        if o != b.len() {
            return Err("trailing bytes in profile");
        }
        if nlut == 9 {
            p.lut_silhouette = luts.pop().unwrap();
            p.lut_palette = luts.pop().unwrap();
            p.lut_runs = luts.pop().unwrap();
            p.lut_topology = luts.pop().unwrap();
            p.lut_shape = luts.pop().unwrap();
            p.lut_dct = luts.pop().unwrap();
        }
        p.lut_diversity = luts.pop().unwrap();
        p.lut_geometry = luts.pop().unwrap();
        p.lut_local = luts.pop().unwrap();
        p.validate()?;
        Ok(p)
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        match (self.container, self.comparator) {
            (CONTAINER_VERSION, COMPARATOR_VERSION) | (CONTAINER_V2, COMPARATOR_V41) => {}
            _ => return Err("container/comparator pair outside 4 or 4.1"),
        }
        if self.evidence_rule != 0 || self.scoring_rule != 1 || self.rag_endpoint != 1 {
            return Err("bound rule outside v4 (Proportion/Gate are retired)");
        }
        if !(2..=16).contains(&self.grid_g) {
            return Err("grid_g range");
        }
        if !(0..=128).contains(&self.hamming_t) {
            return Err("hamming_t range");
        }
        if self.confidence_at < 1 || self.geo_conf_at < 1 || self.geo_eps < 0 {
            return Err("confidence field range");
        }
        if !(2..=64).contains(&self.geo_min_corr) || !(2..=64).contains(&self.min_model_inliers) {
            return Err("model inlier floors");
        }
        if !(1..=8).contains(&self.max_models) {
            return Err("max_models range");
        }
        for v in [self.rep_extreme_at, self.coverage_floor] {
            if !(0..=SCALE as i32).contains(&v) {
                return Err("currency field range");
            }
        }
        if !(0..=6).contains(&self.min_secondaries) {
            return Err("min_secondaries range");
        }
        for (i, &t) in self.thresholds.iter().enumerate() {
            let hi = if i == 7 { 256 } else { SCALE as i32 }; // GEO_SOLO_INLIERS is a count
            if !(0..=hi).contains(&t) {
                return Err("threshold range");
            }
        }
        if self.weights.iter().any(|&w| w < 0 || w > SCALE as i32) {
            return Err("weight range");
        }
        if self.limits.iter().any(|&l| l <= 0) || self.limits[0] > 65535 || self.limits[1] > 65535 {
            return Err("limit range");
        }
        self.lut_local.validate()?;
        self.lut_geometry.validate()?;
        self.lut_diversity.validate()?;
        self.lut_dct.validate()?;
        self.lut_shape.validate()?;
        self.lut_topology.validate()?;
        self.lut_runs.validate()?;
        self.lut_palette.validate()?;
        self.lut_silhouette.validate()
    }

    /// calibration_profile_id = SHA-256 over the artefact bytes (§8.2).
    pub fn id(&self) -> [u8; 32] {
        sha256(&self.encode())
    }
    pub fn id_hex16(&self) -> String {
        hex(&self.id()[..8])
    }

    /// Appendix C — CAL-001-PROVISIONAL: v3 shipping constants plus every new
    /// mechanism switched to neutral, so that M1 changes only what §9.5
    /// changes.  Every "new" value is a hypothesis for §19 to test.
    pub fn cal001() -> Profile {
        let mut name = [0u8; 16];
        name[..16].copy_from_slice(b"CAL-001-PROVISIO");
        Profile {
            container: CONTAINER_VERSION,
            comparator: COMPARATOR_VERSION,
            name,
            evidence_rule: 0,
            scoring_rule: 1,
            rag_endpoint: 1,
            grid_g: 4,
            hamming_t: 8,
            confidence_at: 16,
            geo_conf_at: 16,
            geo_eps: 1600,
            geo_min_corr: 8,
            min_model_inliers: 6,
            max_models: 4,
            rep_extreme_at: 1500,
            coverage_floor: 2500,
            min_secondaries: 3,
            thresholds: [8000, 4500, 3000, 1500, 6750, 3500, 1200, 15, 6000],
            weights: [35, 25, 15, 10, 10, 5, 10],
            limits: [16384, 16384, 16_777_216],
            lut_local: Lut::identity(),
            lut_geometry: Lut::identity(),
            lut_diversity: Lut::neutral(),
            lut_dct: Lut::identity(),
            lut_shape: Lut::identity(),
            lut_topology: Lut::identity(),
            lut_runs: Lut::identity(),
            lut_palette: Lut::identity(),
            lut_silhouette: Lut::identity(),
        }
    }

    /// SPEC-004.1 Part II — CAL-003-PROPOSED: the comparator-41 default,
    /// every value derived from the 496-pair corpus (knees at measured
    /// quantiles, thresholds re-derived on the rescaled structural axis,
    /// geo-solo floor from the zero-leakage evidence).
    pub fn cal003() -> Profile {
        let mut name = [0u8; 16];
        name.copy_from_slice(b"CAL-003-PROPOSED");
        Profile {
            container: CONTAINER_V2,
            comparator: COMPARATOR_V41,
            name,
            evidence_rule: 0,
            scoring_rule: 1,
            rag_endpoint: 1,
            grid_g: 4,
            hamming_t: 8,
            confidence_at: 16,
            geo_conf_at: 16,
            geo_eps: 1600,
            geo_min_corr: 8,
            min_model_inliers: 6,
            max_models: 4,
            rep_extreme_at: 1500,
            coverage_floor: 2500,
            min_secondaries: 3,
            thresholds: [8000, 4000, 2400, 1000, 6000, 3500, 1200, 11, 6000],
            weights: [35, 25, 15, 10, 10, 5, 10],
            limits: [16384, 16384, 16_777_216],
            lut_local: Lut(vec![(0, 0), (5000, 1000), (8800, 4200), (9400, 8800), (10000, 10000)]),
            lut_geometry: Lut(vec![(0, 0), (1900, 1100), (3000, 3000), (10000, 10000)]),
            lut_diversity: Lut::neutral(),
            lut_dct: Lut::identity(),
            lut_shape: Lut::identity(),
            lut_topology: Lut::identity(),
            lut_runs: Lut(vec![(0, 0), (9100, 900), (9700, 4500), (10000, 10000)]),
            lut_palette: Lut(vec![(0, 0), (3000, 800), (6500, 4000), (10000, 10000)]),
            lut_silhouette: Lut::identity(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cal001_roundtrip_and_id() {
        let p = Profile::cal001();
        p.validate().unwrap();
        let b = p.encode();
        let q = Profile::decode(&b).unwrap();
        assert_eq!(p, q);
        assert_eq!(b, q.encode(), "one encoding per profile");
        let id = p.id_hex16();
        assert_eq!(id.len(), 16);
        println!("CAL-001-PROVISIONAL id: {} ({} bytes)", id, b.len());
    }

    #[test]
    fn cal003_matches_the_proposal_artefact() {
        let p = Profile::cal003();
        p.validate().unwrap();
        let b = p.encode();
        assert_eq!(b.len(), 270, "container-2 artefact length");
        let q = Profile::decode(&b).unwrap();
        assert_eq!(p, q);
        // the id emitted by the SPEC-004.1 proposal's own layout definition —
        // one byte of drift between the two and this line says so
        assert_eq!(
            hex(&p.id()),
            "75319777e4ff7fe6592365612cff9a85d653519166ff1308c8d3489d0247a422"
        );
        // container-1 decoders must refuse it cleanly
        let mut b1 = b.clone();
        b1[4] = 1; // claim container 1
        assert!(Profile::decode(&b1).is_err());
    }

    #[test]
    fn tampering_is_unsupported_not_creative() {
        let p = Profile::cal001();
        let mut b = p.encode();
        let orig = b.clone();
        b[0] = b'X';
        assert!(Profile::decode(&b).is_err()); // magic
        b = orig.clone();
        b[6] = 3;
        assert!(Profile::decode(&b).is_err()); // wrong comparator
        b = orig.clone();
        b.push(0);
        assert!(Profile::decode(&b).is_err()); // trailing bytes
        b = orig.clone();
        b.truncate(b.len() - 1);
        assert!(Profile::decode(&b).is_err()); // truncated lut
        // non-monotone lut
        let mut p2 = Profile::cal001();
        p2.lut_local = Lut(vec![(0, 5000), (5000, 100), (10000, 10000)]);
        assert!(p2.validate().is_err());
        // dip in x
        p2.lut_local = Lut(vec![(0, 0), (5000, 5000), (4000, 6000), (10000, 10000)]);
        assert!(p2.validate().is_err());
        // out-of-range scalar
        let mut p3 = Profile::cal001();
        p3.grid_g = 1;
        assert!(p3.validate().is_err());
        // id moves with any byte
        let mut p4 = Profile::cal001();
        p4.thresholds[1] += 1;
        assert_ne!(p4.id(), p.id());
    }

    #[test]
    fn lut_eval_interpolates_in_currency() {
        let id = Lut::identity();
        for x in [0, 1, 4999, 5000, 9999, 10000, 12000, -3] {
            assert_eq!(id.eval(x), x.clamp(0, SCALE));
        }
        let s = Lut(vec![(0, 0), (2000, 8000), (10000, 10000)]);
        s.validate().unwrap();
        assert_eq!(s.eval(0), 0);
        assert_eq!(s.eval(1000), 4000);
        assert_eq!(s.eval(2000), 8000);
        assert_eq!(s.eval(6000), 9000);
        assert_eq!(s.eval(10000), 10000);
        // truncation, not rounding
        let t = Lut(vec![(0, 0), (3, 2), (10000, 10000)]);
        assert_eq!(t.eval(1), 0);
        assert_eq!(t.eval(2), 1);
    }
}
