//! The integer keypoint pipeline (SPEC-003 §8).
//!
//! v2's keypoint half was the better detector — 0.82 recall against 0.45 — and
//! could not be stored, indexed or verified by a second party, because every
//! step of it was floating point.  Every one of those floats is replaceable:
//!
//! * `atan2`  -> argmax over 64 integer dot products (§8.4)
//! * RANSAC   -> Hough vote + closed-form fixed-point refit (§9.4)
//! * mirror   -> a bit permutation of the stored descriptor (§8.6)
//!
//! Nothing below uses a float, a PRNG, or a transcendental.

use crate::config::{clamp, idiv, Config};
use crate::front::Indexed;
use crate::tables::*;

pub const PATCH_R: i64 = 15;
/// A rotated pattern point reaches `ceil(PATCH_R * sqrt2)` from the keypoint,
/// and each sample is a 5x5 box on top of that.  v2 had no margin at all and
/// relied on the box window clamping at the edge, which makes the sums
/// non-comparable — three of 3588 mirrored descriptors disagreed until this
/// was 24.
pub const KP_MARGIN: i64 = 24;
pub const N_BITS: usize = 256;
pub const N_PAIRS: usize = 128;
pub const FAST_T: i32 = 18;
pub const NMS_R: i64 = 4;
pub const KP_PER_LEVEL: usize = 256;
/// The smallest level that still HAS an interior.  v2's floor of 96 was set for
/// a 119-736 px corpus and starves small pixel art — a 72 px sprite got ONE
/// scale, so it could not be matched against the same sprite inside a 220 px
/// scene, which is the collage case the whole stage exists for.
pub const LEVEL_MIN: i64 = 2 * KP_MARGIN + 4;

#[derive(Clone)]
pub struct Keypoint {
    pub desc: [u32; 8],
    pub x: i32,
    pub y: i32,
    pub level: u8,
    pub sec: u8,
    pub s: u16,
}

/// Symmetric arithmetic shift for a Q10 divide: `sh10(-v) == -sh10(v)` exactly.
/// The reflection identity in §8.6 depends on it.
#[inline(always)]
fn sh10(v: i64) -> i64 {
    if v >= 0 {
        (v + 512) >> 10
    } else {
        -((-v + 512) >> 10)
    }
}

/// The reflection-closed BRIEF pattern (SPEC-003 §8.6).
///
/// 128 pairs are drawn freely from an integer LCG.  Bits 128..255 use the same
/// pairs with y NEGATED.  Mirroring the patch sends the intensity centroid to
/// `theta -> pi - theta`, so `sector -> 32 - sector`, and
///
/// ```text
///     F . rotate(p, 32-k) == rotate(G.p, k),   F = diag(-1,1), G = diag(1,-1)
/// ```
///
/// Sampling the mirrored image at offset `u` equals sampling the original at
/// `F.u`, so bit *i* of the mirrored keypoint is exactly the bit the ORIGINAL
/// would produce with pattern `G.P_i` — i.e. bit *i+128*.  The mirrored
/// descriptor is therefore the stored one with its two halves exchanged:
/// mirror invariance for ZERO stored bytes.
///
/// Note the correction against SPEC-003 as first written: the second half is
/// the Y-mirrored pattern, not the x-mirrored one.  Verified 2949/2949.
pub fn pattern() -> Vec<i32> {
    let m: i64 = 0x7fff_ffff;
    let mut s: i32 = 0x1234567;
    // exact 32-bit, matching Math.imul on the JavaScript side
    let mut u = || -> i64 {
        s = s.wrapping_mul(1103515245).wrapping_add(12345) & 0x7fff_ffff;
        s as i64
    };
    let mut g = || -> i32 {
        // JS evaluates `(3 * M) >> 1` by coercing 3*M to int32 FIRST, which
        // wraps 6442450941 to 2147483645 before the shift.  Reproduce the wrap
        // rather than the arithmetic, or the two patterns diverge.
        let half3m = (((3i64 * m) as i32) >> 1) as i64;
        let c = u() + u() + u() - half3m;
        let v = if c >= 0 {
            idiv(c * 21 + m, 2 * m)
        } else {
            -idiv(-c * 21 + m, 2 * m)
        };
        clamp(v, -PATCH_R, PATCH_R) as i32
    };
    let mut p = vec![0i32; N_BITS * 4];
    for i in 0..N_PAIRS {
        let (ax, ay, bx, by) = (g(), g(), g(), g());
        let o = i * 4;
        p[o] = ax;
        p[o + 1] = ay;
        p[o + 2] = bx;
        p[o + 3] = by;
        let j = (i + N_PAIRS) * 4; // G . P_i  =  y negated
        p[j] = ax;
        p[j + 1] = -ay;
        p[j + 2] = bx;
        p[j + 3] = -by;
    }
    p
}

/// Rotated pattern per sector, built once.  Recomputing 1024 multiply-shifts
/// per keypoint is the single largest avoidable cost in the hash.
pub struct RotCache {
    tables: Vec<Vec<i64>>,
}
impl RotCache {
    pub fn new(pat: &[i32]) -> Self {
        let mut tables = Vec::with_capacity(64);
        for k in 0..64usize {
            let (c, s) = (RC10[k] as i64, RS10[k] as i64);
            let mut t = vec![0i64; N_BITS * 4];
            for i in 0..N_BITS {
                let o = i * 4;
                let (pax, pay) = (pat[o] as i64, pat[o + 1] as i64);
                let (pbx, pby) = (pat[o + 2] as i64, pat[o + 3] as i64);
                t[o] = sh10(pax * c - pay * s);
                t[o + 1] = sh10(pax * s + pay * c);
                t[o + 2] = sh10(pbx * c - pby * s);
                t[o + 3] = sh10(pbx * s + pby * c);
            }
            tables.push(t);
        }
        RotCache { tables }
    }
}

struct Level {
    d: Vec<u8>,
    op: Vec<u8>,
    w: usize,
    h: usize,
}

fn integral(map: &[u8], w: usize, h: usize) -> Vec<i64> {
    let mut s = vec![0i64; (w + 1) * (h + 1)];
    for y in 0..h {
        let mut row = 0i64;
        for x in 0..w {
            row += map[y * w + x] as i64;
            s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row;
        }
    }
    s
}

#[inline(always)]
fn box_win(s: &[i64], w: usize, cx: i64, cy: i64, r: i64) -> i64 {
    let ws = (w + 1) as i64;
    let (x0, y0, x1, y1) = (cx - r, cy - r, cx + r + 1, cy + r + 1);
    s[(y1 * ws + x1) as usize] - s[(y0 * ws + x1) as usize] - s[(y1 * ws + x0) as usize]
        + s[(y0 * ws + x0) as usize]
}

/// Levels indexed by `max(w, h)`, NOT by width.  v2 indexed by width, which
/// gave a 736x352 work seven scales and a 119x193 work one — a scale-coverage
/// asymmetry that depended on aspect ratio rather than size.
pub fn pyramid_dims(max_dim: i64) -> Vec<i64> {
    let mut out = vec![max_dim]; // level 0 ALWAYS exists
    let mut l = idiv(max_dim * 10 + 6, 13);
    while l >= LEVEL_MIN {
        out.push(l);
        l = idiv(l * 10 + 6, 13);
    }
    out
}

/// A keypoint's descriptor covers a 31 px patch AT ITS OWN LEVEL, so the
/// feature's size in normalised units is proportional to `1 / L_k`.  The scale
/// ratio between two keypoints is therefore `L_kA / L_kB` — recoverable from
/// the stored level index plus the work's maxDim, both of which are on the
/// wire.  Deriving scale from the index difference alone is wrong the moment
/// two works differ in size.
pub fn level_dim(max_dim: i64, k: usize) -> i64 {
    let mut l = max_dim;
    for _ in 0..k {
        l = idiv(l * 10 + 6, 13);
    }
    l.max(1)
}

fn build_level(lum: &[u8], op: &[u8], w: usize, h: usize, lw: usize, lh: usize, fill: u8) -> Level {
    let mut d = vec![0u8; lw * lh];
    let mut o = vec![0u8; lw * lh];
    for j in 0..lh {
        let y0 = idiv(j as i64 * h as i64, lh as i64) as usize;
        let mut y1 = idiv((j as i64 + 1) * h as i64, lh as i64) as usize;
        if y1 <= y0 {
            y1 = y0 + 1;
        }
        for i in 0..lw {
            let x0 = idiv(i as i64 * w as i64, lw as i64) as usize;
            let mut x1 = idiv((i as i64 + 1) * w as i64, lw as i64) as usize;
            if x1 <= x0 {
                x1 = x0 + 1;
            }
            let (mut sum, mut cnt, mut tot) = (0i64, 0i64, 0i64);
            for y in y0..y1.min(h) {
                for x in x0..x1.min(w) {
                    tot += 1;
                    if op[y * w + x] != 0 {
                        sum += lum[y * w + x] as i64;
                        cnt += 1;
                    }
                }
            }
            let p = j * lw + i;
            d[p] = if cnt > 0 { idiv(sum, cnt) as u8 } else { fill };
            o[p] = if cnt * 4 >= tot * 3 { 1 } else { 0 };
        }
    }
    Level { d, op: o, w: lw, h: lh }
}

/// FAST-9, unchanged from v2 and already integer.  What is new is the border
/// margin and the 75% opacity floor — the same rule the local-fingerprint
/// windows use.  Without it a transparent background becomes a hard black edge
/// and the detector keys on the SILHOUETTE, which is what v2's keypoint half
/// did and why its recall and the structural half's could not be compared.
fn fast9(lv: &Level) -> Vec<(i64, i64, i64)> {
    let (w, h) = (lv.w, lv.h);
    let mut kps = Vec::new();
    let so = integral(&lv.op, w, h);
    let lo = KP_MARGIN;
    let hix = w as i64 - 1 - KP_MARGIN;
    let hiy = h as i64 - 1 - KP_MARGIN;
    if hix <= lo || hiy <= lo {
        return kps;
    }
    let area = (2 * PATCH_R + 1) * (2 * PATCH_R + 1);
    for y in lo..=hiy {
        for x in lo..=hix {
            let p = lv.d[(y as usize) * w + x as usize] as i32;
            let hi = p + FAST_T;
            let low = p - FAST_T;
            let (mut b, mut dk) = (0, 0);
            let mut q = 0;
            while q < 16 {
                let (dx, dy) = CIRC[q];
                let v = lv.d[((y + dy as i64) as usize) * w + (x + dx as i64) as usize] as i32;
                if v > hi {
                    b += 1;
                } else if v < low {
                    dk += 1;
                }
                q += 4;
            }
            if b < 3 && dk < 3 {
                continue;
            }
            if box_win(&so, w, x, y, PATCH_R) * 4 < area * 3 {
                continue;
            }
            let (mut br, mut dr, mut score) = (0u32, 0u32, 0i64);
            for k in 0..16usize {
                let (dx, dy) = CIRC[k];
                let v = lv.d[((y + dy as i64) as usize) * w + (x + dx as i64) as usize] as i32;
                if v > hi {
                    br |= 1 << k;
                }
                if v < low {
                    dr |= 1 << k;
                }
                score += (v - p).abs() as i64;
            }
            let arc = |mask: u32| -> bool {
                let mut run = 0;
                for k in 0..24usize {
                    if (mask >> (k & 15)) & 1 != 0 {
                        run += 1;
                        if run >= 9 {
                            return true;
                        }
                    } else {
                        run = 0;
                    }
                }
                false
            };
            if arc(br) || arc(dr) {
                kps.push((x, y, score));
            }
        }
    }
    kps
}

/// True-radius NMS over a total order.  v2 used a grid-approximate suppression
/// whose effective radius varied between 4 and 12 px depending on where a
/// keypoint fell inside its cell — so a 2 px shift could change which of two
/// nearby corners survived.  For an algorithm whose entire premise is finding
/// the SAME points twice, that is a real defect.
fn nms(mut kps: Vec<(i64, i64, i64)>, r: i64) -> Vec<(i64, i64, i64)> {
    kps.sort_by(|a, b| b.2.cmp(&a.2).then(a.1.cmp(&b.1)).then(a.0.cmp(&b.0)));
    let r2 = r * r;
    let mut kept: Vec<(i64, i64, i64)> = Vec::new();
    for k in kps {
        if kept.len() >= KP_PER_LEVEL {
            break;
        }
        let mut ok = true;
        for j in kept.iter() {
            let dx = j.0 - k.0;
            let dy = j.1 - k.1;
            if dx * dx + dy * dy <= r2 {
                ok = false;
                break;
            }
        }
        if ok {
            kept.push(k);
        }
    }
    kept
}

/// The r=7 disc, flattened once.
fn disc7() -> Vec<(i64, i64)> {
    let mut t = Vec::new();
    for dy in -7i64..=7 {
        for dx in -7i64..=7 {
            if dx * dx + dy * dy <= 49 {
                t.push((dx, dy));
            }
        }
    }
    t
}

/// Orientation as the argmax over `m10*cos(phi_k) + m01*sin(phi_k)`, which IS
/// round-to-nearest by construction — and because the tables satisfy
/// `COS64[32-k] = -COS64[k]` and `SIN64[32-k] = SIN64[k]`, it satisfies
/// `sector(-m10, m01) == (32 - sector(m10, m01)) & 63` exactly.
///
/// Returns -1 when the orientation is ambiguous.  A tie is the ONE case where
/// the mirror identity fails: the two tied sectors are adjacent and "lowest
/// index" is not preserved by `k -> 32-k`.  Rather than invent an asymmetric
/// tie-break that quietly breaks mirroring, REFUSE the keypoint — an
/// orientation this ambiguous produces a descriptor that is not repeatable
/// anyway.  Measured rate on real content: under 1%.
fn orient_sector(s3: &[i64], w: usize, x: i64, y: i64, disc: &[(i64, i64)]) -> i32 {
    let (mut m10, mut m01) = (0i64, 0i64);
    for &(dx, dy) in disc {
        let v = box_win(s3, w, x + dx, y + dy, 1); // 3x3 SUM, not mean
        m10 += dx * v;
        m01 += dy * v;
    }
    if m10 == 0 && m01 == 0 {
        return -1;
    }
    let (mut best_k, mut best_v, mut tied) = (0i32, i64::MIN, 0u32);
    for k in 0..64usize {
        let dot = m10 * COS64[k] as i64 + m01 * SIN64[k] as i64;
        if dot > best_v {
            best_v = dot;
            best_k = k as i32;
            tied = 1;
        } else if dot == best_v {
            tied += 1;
        }
    }
    if tied > 1 {
        -1
    } else {
        best_k
    }
}

fn describe(s: &[i64], w: usize, x: i64, y: i64, rot: &[i64]) -> [u32; 8] {
    let mut bits = [0u32; 8];
    let ws = (w + 1) as i64;
    for i in 0..N_BITS {
        let o = i * 4;
        let (ax, ay) = (x + rot[o], y + rot[o + 1]);
        let (bx, by) = (x + rot[o + 2], y + rot[o + 3]);
        // 5x5 box SUMS, not means: the divisor is constant so it cannot change
        // the comparison, and sums stay exact.  The box average is what makes
        // BRIEF work on dithered pixel art at all — a raw two-pixel test
        // measures the dither, not the drawing.  Ties resolve to 0, specified.
        let (a0, a1, ac0, ac1) = ((ay - 2) * ws, (ay + 3) * ws, ax - 2, ax + 3);
        let sa = s[(a1 + ac1) as usize] - s[(a0 + ac1) as usize] - s[(a1 + ac0) as usize]
            + s[(a0 + ac0) as usize];
        let (b0, b1, bc0, bc1) = ((by - 2) * ws, (by + 3) * ws, bx - 2, bx + 3);
        let sb = s[(b1 + bc1) as usize] - s[(b0 + bc1) as usize] - s[(b1 + bc0) as usize]
            + s[(b0 + bc0) as usize];
        if sa < sb {
            bits[i >> 5] |= 1u32 << (i & 31);
        }
    }
    bits
}

/// Descriptor of the horizontally mirrored patch: exchange the two halves.
pub fn mirror_desc(d: &[u32; 8]) -> [u32; 8] {
    [d[4], d[5], d[6], d[7], d[0], d[1], d[2], d[3]]
}

pub struct KpOut {
    pub list: Vec<Keypoint>,
    pub max_dim: i64,
    pub xmax: i32,
}

pub fn keypoints(im: &Indexed, cfg: &Config, rot: &RotCache) -> KpOut {
    let (w, h) = (im.w, im.h);
    let n = w * h;
    let mut lum = vec![0u8; n];
    let mut op = vec![0u8; n];
    let mut lums: Vec<u8> = Vec::with_capacity(n);
    for i in 0..n {
        if im.idx[i] < 0 {
            op[i] = 0;
        } else {
            op[i] = 1;
            lum[i] = im.pal[im.idx[i] as usize].lum as u8;
            lums.push(lum[i]);
        }
    }
    lums.sort_unstable();
    let fill = if lums.is_empty() { 128 } else { lums[lums.len() >> 1] };
    for i in 0..n {
        if op[i] == 0 {
            lum[i] = fill;
        }
    }

    let max_dim = w.max(h) as i64;
    let dims = pyramid_dims(max_dim);
    let disc = disc7();
    let mut all: Vec<Keypoint> = Vec::new();

    for (li, &l) in dims.iter().enumerate() {
        let lw = (idiv(w as i64 * l, max_dim)).max(1) as usize;
        let lh = (idiv(h as i64 * l, max_dim)).max(1) as usize;
        if (lw as i64) < 2 * KP_MARGIN + 4 || (lh as i64) < 2 * KP_MARGIN + 4 {
            continue;
        }
        let lv = build_level(&lum, &op, w, h, lw, lh, fill);
        let raw = fast9(&lv);
        if raw.is_empty() {
            continue;
        }
        let kept = nms(raw, NMS_R);
        // Normalise strength by the LEVEL's own median before pooling.  v2
        // ranked pooled keypoints by raw FAST score, comparing scores computed
        // at different resolutions — downsampling smooths, so coarse levels
        // were systematically starved.
        let mut sc: Vec<i64> = kept.iter().map(|k| k.2).collect();
        sc.sort_unstable();
        let med = sc[sc.len() >> 1].max(1);
        let s = integral(&lv.d, lw, lh);
        for &(kx, ky, ks) in kept.iter() {
            let sec = orient_sector(&s, lw, kx, ky, &disc);
            if sec < 0 {
                continue; // ambiguous orientation, refused
            }
            let desc = describe(&s, lw, kx, ky, &rot.tables[sec as usize]);
            all.push(Keypoint {
                desc,
                level: li as u8,
                sec: sec as u8,
                x: clamp(idiv(idiv(kx * w as i64, lw as i64) * 65535, max_dim), 0, 65535) as i32,
                y: clamp(idiv(idiv(ky * h as i64, lh as i64) * 65535, max_dim), 0, 65535) as i32,
                s: clamp(idiv(ks * 1024, med), 0, 65535) as u16,
            });
        }
    }

    all.sort_by(|a, b| {
        b.s.cmp(&a.s)
            .then(a.level.cmp(&b.level))
            .then(a.y.cmp(&b.y))
            .then(a.x.cmp(&b.x))
    });

    // Spread the budget over an 8x8 spatial grid before capping.  Taking the
    // globally strongest `want` keypoints looks fair and is not: a busy host
    // out-scores a pasted figure and crowds every one of its keypoints out of
    // the budget, so the collage case the geometric stage EXISTS for is exactly
    // the one the cap silences.
    let want = cfg.kp_count;
    if all.len() > want {
        let mut cells: std::collections::BTreeMap<i64, Vec<usize>> = std::collections::BTreeMap::new();
        for (i, k) in all.iter().enumerate() {
            let gk = idiv(k.y as i64 * 8, 65536) * 8 + idiv(k.x as i64 * 8, 65536);
            cells.entry(gk).or_default().push(i);
        }
        let mut picked: Vec<usize> = Vec::with_capacity(want);
        let mut round = 0usize;
        loop {
            let mut took = 0;
            for bucket in cells.values() {
                if picked.len() >= want {
                    break;
                }
                if round < bucket.len() {
                    picked.push(bucket[round]);
                    took += 1;
                }
            }
            if took == 0 || picked.len() >= want {
                break;
            }
            round += 1;
        }
        let mut next: Vec<Keypoint> = Vec::with_capacity(picked.len());
        for i in picked {
            next.push(all[i].clone());
        }
        all = next;
    }
    all.truncate(want);

    // wire order is content-derived and total, so two identical keypoint sets
    // serialise identically and comparison is order-independent
    all.sort_by(|a, b| {
        a.desc[0]
            .cmp(&b.desc[0])
            .then(a.desc[1].cmp(&b.desc[1]))
            .then(a.x.cmp(&b.x))
            .then(a.y.cmp(&b.y))
            .then(a.level.cmp(&b.level))
    });

    KpOut {
        list: all,
        max_dim,
        xmax: clamp(idiv((w as i64 - 1) * 65535, max_dim), 0, 65535) as i32,
    }
}
