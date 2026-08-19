//! Tier-1 section builders (SPEC-003 §6).
//!
//! Every byte written here is produced by integer arithmetic over frozen
//! tables.  Two independent implementations must be able to agree on all
//! 3952 of them; `test/parity.js` checks that against the JavaScript engine.

use crate::config::{clamp, idiv, Config};
use crate::front::Indexed;
use crate::tables::*;
use std::collections::HashMap;

pub const PAL_N: usize = 24;
pub const RAG_N: usize = 48;
pub const SHAPE_N: usize = 8;
pub const SHAPE_BYTES: usize = 41;
pub const Q: i32 = 14;
pub const QONE: i64 = 1 << Q;
pub const R: i32 = 10;
pub const RONE: i64 = 1 << R;

// ---------------------------------------------------------------- DCT

fn dct2(src: &[i32], n: usize) -> Vec<i32> {
    let t = cos_table(n);
    let mut tmp = vec![0i64; n * n];
    let mut out = vec![0i32; n * n];
    for j in 0..n {
        for u in 0..n {
            let mut s = 0i64;
            for i in 0..n {
                s += src[j * n + i] as i64 * t[u * n + i] as i64;
            }
            tmp[j * n + u] = (s + (QONE >> 1)) >> Q;
        }
    }
    for u in 0..n {
        for v in 0..n {
            let mut s = 0i64;
            for j in 0..n {
                s += tmp[j * n + u] * t[v * n + j] as i64;
            }
            out[v * n + u] = ((s + (QONE >> 1)) >> Q) as i32;
        }
    }
    out
}

/// One SIGN BIT plus a Gray-coded magnitude bucket, taken against the order
/// statistics of |coef| in the block's own distribution.
///
/// Bucketing the SIGNED value would cost the dihedral group: under a
/// horizontal flip a 2-D DCT negates every coefficient with odd horizontal
/// frequency, and a signed percentile bucket cannot be negated after the fact.
/// Split the sign off and all eight symmetries become bit operations on the
/// stored code — a mirrored or quarter-turned copy is then found at compare
/// time for zero extra bytes.  Bucketing |coef| against its own block also
/// makes the code invariant to a global contrast scale.
fn quantise_block(co: &[i32], bits: usize, keep_dc: bool, bytes: &mut [u8], off: usize) -> usize {
    let n = co.len();
    let mbits = bits - 1;
    let mut mags: Vec<i32> = Vec::with_capacity(n);
    for i in (if keep_dc { 0 } else { 1 })..n {
        mags.push(co[i].abs());
    }
    mags.sort_unstable();
    let levels = 1usize << mbits;
    let mut cuts = vec![0i32; if levels > 1 { levels - 1 } else { 1 }];
    for i in 1..levels {
        let p = idiv(i as i64 * mags.len() as i64, levels as i64);
        cuts[i - 1] = if mags.is_empty() {
            0
        } else {
            mags[clamp(p, 0, mags.len() as i64 - 1) as usize]
        };
    }
    let gray: &[i32] = match mbits {
        1 => &GRAY1,
        2 => &GRAY2,
        _ => &GRAY3,
    };
    let mut bit = 0usize;
    for i in 0..n {
        let mut sgn = 0i32;
        let mut q = 0usize;
        if !(i == 0 && !keep_dc) {
            let v = co[i];
            sgn = if v < 0 { 1 } else { 0 };
            let m = v.abs();
            while q < levels - 1 && m >= cuts[q] {
                q += 1;
            }
        }
        let code = (sgn << mbits) | gray[q];
        for k in (0..bits).rev() {
            if (code >> k) & 1 != 0 {
                bytes[off + (bit >> 3)] |= 0x80 >> (bit & 7);
            }
            bit += 1;
        }
    }
    (n * bits) >> 3
}

/// 256 B: one 16x16 block at 2 bits, four 8x8 at 2 bits, sixteen 4x4 at 4 bits.
/// DC is ALWAYS dropped (SPEC-003 §6.3) so the index bucket cannot degenerate
/// into "is this picture bright".
pub fn hierarchical_dct(thumb: &[i32]) -> Vec<u8> {
    let mut out = vec![0u8; 256];
    quantise_block(&dct2(thumb, 16), 2, false, &mut out, 0);
    let mut off = 64usize;
    for qy in 0..2 {
        for qx in 0..2 {
            let mut blk = vec![0i32; 64];
            for y in 0..8 {
                for x in 0..8 {
                    blk[y * 8 + x] = thumb[(qy * 8 + y) * 16 + qx * 8 + x];
                }
            }
            off += quantise_block(&dct2(&blk, 8), 2, false, &mut out, off);
        }
    }
    for ty in 0..4 {
        for tx in 0..4 {
            let mut t4 = vec![0i32; 16];
            for y in 0..4 {
                for x in 0..4 {
                    t4[y * 4 + x] = thumb[(ty * 4 + y) * 16 + tx * 4 + x];
                }
            }
            off += quantise_block(&dct2(&t4, 4), 4, false, &mut out, off);
        }
    }
    out
}

// ------------------------------------------------------- area majority

pub fn area_majority(im: &Indexed, nw: usize, nh: usize) -> Vec<i32> {
    let (w, h) = (im.w, im.h);
    let mut out = vec![0i32; nw * nh];
    let mut tally = vec![0i32; im.pal.len() + 1]; // slot 0 = transparent
    for j in 0..nh {
        let y0 = idiv(j as i64 * h as i64, nh as i64) as usize;
        let mut y1 = idiv((j as i64 + 1) * h as i64, nh as i64) as usize;
        if y1 <= y0 {
            y1 = y0 + 1;
        }
        for i in 0..nw {
            let x0 = idiv(i as i64 * w as i64, nw as i64) as usize;
            let mut x1 = idiv((i as i64 + 1) * w as i64, nw as i64) as usize;
            if x1 <= x0 {
                x1 = x0 + 1;
            }
            for v in tally.iter_mut() {
                *v = 0;
            }
            for y in y0..y1.min(h) {
                for x in x0..x1.min(w) {
                    tally[(im.idx[y * w + x] + 1) as usize] += 1;
                }
            }
            let (mut best, mut bn, mut brank) = (-1i32, 0i32, -1i32);
            for v in 0..tally.len() {
                if tally[v] == 0 {
                    continue;
                }
                let rank = if v == 0 { -1 } else { im.pal[v - 1].lum_order };
                if tally[v] > bn || (tally[v] == bn && rank > brank) {
                    bn = tally[v];
                    best = v as i32 - 1;
                    brank = rank;
                }
            }
            out[j * nw + i] = best;
        }
    }
    out
}

/// 16x16 luminance thumbnail.  Cells with no opaque pixel take the MEDIAN
/// opaque luminance, not 0: filling holes with black manufactures an edge that
/// the same sprite composited on a host would not have, and the two maps of one
/// drawing then share almost nothing.
pub fn thumbnail16(im: &Indexed) -> Vec<i32> {
    let m = area_majority(im, 16, 16);
    let mut lums: Vec<i32> = im.pal.iter().map(|p| p.lum).collect();
    lums.sort_unstable();
    let fill = if lums.is_empty() { 128 } else { lums[lums.len() >> 1] };
    (0..256)
        .map(|i| if m[i] < 0 { fill } else { im.pal[m[i] as usize].lum })
        .collect()
}

// -------------------------------------------------------- brightness

pub fn brightness_record(thumb: &[i32]) -> Vec<u8> {
    let mut out = vec![0u8; 8];
    let s: i64 = thumb.iter().map(|&v| v as i64).sum();
    out[0] = clamp(idiv(s, 256), 0, 255) as u8;
    let mut srt = thumb.to_vec();
    srt.sort_unstable();
    out[1] = srt[12] as u8;
    out[2] = srt[64] as u8;
    out[3] = srt[128] as u8;
    out[4] = srt[192] as u8;
    out[5] = srt[243] as u8;
    out[6] = clamp((srt[243] - srt[12]) as i64, 0, 255) as u8;
    let mut q = 0i32;
    for qy in 0..2 {
        for qx in 0..2 {
            let mut t = 0i64;
            for y in 0..8 {
                for x in 0..8 {
                    t += thumb[(qy * 8 + y) * 16 + qx * 8 + x] as i64;
                }
            }
            let m = idiv(t, 64);
            q = (q << 2)
                | (if m > out[0] as i64 { 2 } else { 0 })
                | (if m > out[2] as i64 { 1 } else { 0 });
        }
    }
    out[7] = (q & 255) as u8;
    out
}

// ----------------------------------------------------------- palette

pub fn identity_palette(im: &Indexed) -> (Vec<u8>, usize) {
    let mut out = vec![0u8; PAL_N * 4];
    let n = PAL_N.min(im.pal.len());
    let max_n = if n > 0 { im.pal[0].n as i64 } else { 1 };
    for i in 0..n {
        let p = &im.pal[i];
        let o = i << 2;
        out[o] = i as u8;
        out[o + 1] = clamp(idiv(p.n as i64 * 255 + (max_n >> 1), max_n), 0, 255) as u8;
        out[o + 2] = if im.pal.len() > 1 {
            clamp(idiv(p.lum_order as i64 * 255, im.pal.len() as i64 - 1), 0, 255) as u8
        } else {
            0
        };
        out[o + 3] = p.quantile as u8;
    }
    (out, n)
}

/// BOTH endpoint encodings, on purpose.  Quantile survives a rebuilt palette;
/// rank does not — which is exactly why rank agreement is STRONGER evidence
/// when it occurs: it means the palette was not rebuilt.  v2 forced the choice
/// at hash time.
pub fn sparse_rag(im: &Indexed) -> (Vec<u8>, usize) {
    let (w, h) = (im.w, im.h);
    let n_max = (im.pal.len() as i64 - 1).max(1);
    let rank_of = |v: usize| -> i64 { clamp(idiv(im.pal[v].lum_order as i64 * 255, n_max), 0, 255) };
    let mut acc: HashMap<i32, i64> = HashMap::new();
    let mut total = 0i64;
    let add = |a: i32, b: i32, acc: &mut HashMap<i32, i64>, total: &mut i64| {
        if a < 0 || b < 0 || a == b {
            return;
        }
        let (qa, qb) = (im.pal[a as usize].quantile as i64, im.pal[b as usize].quantile as i64);
        let (ra, rb) = (rank_of(a as usize), rank_of(b as usize));
        let (qlo, qhi) = if qa < qb { (qa, qb) } else { (qb, qa) };
        let (rlo, rhi) = if ra < rb { (ra, rb) } else { (rb, ra) };
        if qlo == qhi && rlo == rhi {
            return;
        }
        // NOTE the i32: (qlo << 24) overflows into the sign bit exactly as it
        // does in JavaScript, and the tie-break below is therefore SIGNED.
        let k = ((qlo as i32) << 24) | ((qhi as i32) << 16) | ((rlo as i32) << 8) | rhi as i32;
        *acc.entry(k).or_insert(0) += 1;
        *total += 1;
    };
    for y in 0..h {
        for x in 0..w {
            let p = im.idx[y * w + x];
            if x + 1 < w {
                add(p, im.idx[y * w + x + 1], &mut acc, &mut total);
            }
            if y + 1 < h {
                add(p, im.idx[(y + 1) * w + x], &mut acc, &mut total);
            }
        }
    }
    let mut list: Vec<(i32, i64)> = acc.into_iter().collect();
    list.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    list.truncate(RAG_N);
    let mut out = vec![0u8; RAG_N * 6];
    for (i, &(k, cnt)) in list.iter().enumerate() {
        let o = i * 6;
        let k = k as u32;
        out[o] = ((k >> 24) & 255) as u8;
        out[o + 1] = ((k >> 16) & 255) as u8;
        out[o + 2] = ((k >> 8) & 255) as u8;
        out[o + 3] = (k & 255) as u8;
        let nrm = if total > 0 { clamp(idiv(cnt * 65535, total), 0, 65535) } else { 0 };
        out[o + 4] = (nrm & 255) as u8;
        out[o + 5] = ((nrm >> 8) & 255) as u8;
    }
    (out, list.len())
}

// ------------------------------------------------------------ shapes

struct Comp {
    id: i32,
    area: i64,
    cx: i64,
    cy: i64,
    minx: i64,
    maxx: i64,
    miny: i64,
    maxy: i64,
}

fn components(lab: &[i8], w: usize, h: usize) -> (Vec<i32>, Vec<Comp>) {
    let mut id = vec![-1i32; w * h];
    let mut out: Vec<Comp> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    for s in 0..w * h {
        if id[s] >= 0 || lab[s] < 0 {
            continue;
        }
        let cid = out.len() as i32;
        let (mut area, mut sx, mut sy) = (0i64, 0i64, 0i64);
        let (mut minx, mut maxx, mut miny, mut maxy) = (w as i64, -1i64, h as i64, -1i64);
        stack.clear();
        stack.push(s);
        id[s] = cid;
        while let Some(p) = stack.pop() {
            let x = (p % w) as i64;
            let y = (p / w) as i64;
            area += 1;
            sx += x;
            sy += y;
            minx = minx.min(x);
            maxx = maxx.max(x);
            miny = miny.min(y);
            maxy = maxy.max(y);
            if x > 0 && id[p - 1] < 0 && lab[p - 1] == lab[p] {
                id[p - 1] = cid;
                stack.push(p - 1);
            }
            if (x as usize) < w - 1 && id[p + 1] < 0 && lab[p + 1] == lab[p] {
                id[p + 1] = cid;
                stack.push(p + 1);
            }
            if y > 0 && id[p - w] < 0 && lab[p - w] == lab[p] {
                id[p - w] = cid;
                stack.push(p - w);
            }
            if (y as usize) < h - 1 && id[p + w] < 0 && lab[p + w] == lab[p] {
                id[p + w] = cid;
                stack.push(p + w);
            }
        }
        out.push(Comp {
            id: cid,
            area,
            cx: idiv(sx, area),
            cy: idiv(sy, area),
            minx,
            maxx,
            miny,
            maxy,
        });
    }
    (id, out)
}

/// Connected components over an 8-band luminance-QUANTILE label map, modally
/// downsampled: quantile bands survive a tone curve and a rebuilt palette, and
/// the modal downsample kills the dither confetti that would otherwise shatter
/// every region into noise.
pub fn shape_signatures(im: &Indexed) -> (Vec<u8>, usize) {
    let long = im.w.max(im.h) as i64;
    let cell = idiv(long + 127, 128).max(1);
    let gw = (idiv(im.w as i64 + cell - 1, cell)).max(4) as usize;
    let gh = (idiv(im.h as i64 + cell - 1, cell)).max(4) as usize;
    let m = area_majority(im, gw, gh);
    let lab: Vec<i8> = m
        .iter()
        .map(|&v| if v < 0 { -1i8 } else { im.pal[v as usize].band as i8 })
        .collect();
    let (cid, comps) = components(&lab, gw, gh);
    let (w, h) = (gw, gh);

    let mut order: Vec<usize> = (0..comps.len()).collect();
    order.sort_by(|&a, &b| {
        comps[b]
            .area
            .cmp(&comps[a].area)
            .then(comps[a].miny.cmp(&comps[b].miny))
            .then(comps[a].minx.cmp(&comps[b].minx))
    });
    order.truncate(SHAPE_N);

    let mut out = vec![0u8; SHAPE_BYTES * SHAPE_N];
    for (s, &ci) in order.iter().enumerate() {
        let c = &comps[ci];
        let o = s * SHAPE_BYTES;

        // perimeter: cells with a 4-neighbour outside the component
        let mut per = 0i64;
        for y in c.miny..=c.maxy {
            for x in c.minx..=c.maxx {
                let p = (y as usize) * w + x as usize;
                if cid[p] != c.id {
                    continue;
                }
                if x == 0
                    || y == 0
                    || x == w as i64 - 1
                    || y == h as i64 - 1
                    || cid[p - 1] != c.id
                    || cid[p + 1] != c.id
                    || cid[p - w] != c.id
                    || cid[p + w] != c.id
                {
                    per += 1;
                }
            }
        }

        // holes: complement components inside the bbox that never touch its border
        let bw = (c.maxx - c.minx + 1) as usize;
        let bh = (c.maxy - c.miny + 1) as usize;
        let mut holes = 0i64;
        let mut seen = vec![0u8; bw * bh];
        let mut st: Vec<usize> = Vec::new();
        for y in 0..bh {
            for x in 0..bw {
                let q = y * bw + x;
                if seen[q] != 0 || cid[(y + c.miny as usize) * w + x + c.minx as usize] == c.id {
                    continue;
                }
                let mut touch = false;
                st.clear();
                st.push(q);
                seen[q] = 1;
                while let Some(r) = st.pop() {
                    let rx = r % bw;
                    let ry = r / bw;
                    if rx == 0 || ry == 0 || rx == bw - 1 || ry == bh - 1 {
                        touch = true;
                    }
                    let nb: [i64; 4] = [
                        if rx > 0 { r as i64 - 1 } else { -1 },
                        if rx < bw - 1 { r as i64 + 1 } else { -1 },
                        if ry > 0 { r as i64 - bw as i64 } else { -1 },
                        if ry < bh - 1 { r as i64 + bw as i64 } else { -1 },
                    ];
                    for t in nb {
                        if t < 0 {
                            continue;
                        }
                        let t = t as usize;
                        if seen[t] != 0 {
                            continue;
                        }
                        let tx = t % bw;
                        let ty = t / bw;
                        if cid[(ty + c.miny as usize) * w + tx + c.minx as usize] == c.id {
                            continue;
                        }
                        seen[t] = 1;
                        st.push(t);
                    }
                }
                if !touch {
                    holes += 1;
                }
            }
        }

        // the centroid must sit inside the component or the rays start outside
        let (mut cx, mut cy) = (c.cx, c.cy);
        if cid[(cy as usize) * w + cx as usize] != c.id {
            let mut bd = i64::MAX;
            for y in c.miny..=c.maxy {
                for x in c.minx..=c.maxx {
                    if cid[(y as usize) * w + x as usize] != c.id {
                        continue;
                    }
                    let d = (x - c.cx) * (x - c.cx) + (y - c.cy) * (y - c.cy);
                    if d < bd {
                        bd = d;
                        cx = x;
                        cy = y;
                    }
                }
            }
        }

        // 32 rays, integer DDA, distance to the FIRST contour crossing
        let mut rad = [0i64; 32];
        let mut rmax = 1i64;
        for k in 0..32 {
            let mut t2 = 0i64;
            let lim = (bw + bh) as i64;
            for step in 1..=lim {
                let px2 = cx + ((RAYC[k] as i64 * step + (RONE >> 1)) >> R);
                let py2 = cy + ((RAYSN[k] as i64 * step + (RONE >> 1)) >> R);
                if px2 < 0 || py2 < 0 || px2 >= w as i64 || py2 >= h as i64 {
                    break;
                }
                if cid[(py2 as usize) * w + px2 as usize] != c.id {
                    break;
                }
                t2 = step;
            }
            rad[k] = t2;
            rmax = rmax.max(t2);
        }

        let aspect = clamp(idiv(bw as i64 * 256, (bh as i64).max(1)), 0, 65535);
        let a = c.area as u32;
        out[o] = (a & 255) as u8;
        out[o + 1] = ((a >> 8) & 255) as u8;
        out[o + 2] = ((a >> 16) & 255) as u8;
        out[o + 3] = ((a >> 24) & 255) as u8;
        out[o + 4] = (per & 255) as u8;
        out[o + 5] = ((per >> 8) & 255) as u8;
        out[o + 6] = (aspect & 255) as u8;
        out[o + 7] = ((aspect >> 8) & 255) as u8;
        out[o + 8] = clamp(holes, 0, 255) as u8;
        for k in 0..32 {
            out[o + 9 + k] = clamp(idiv(255 * rad[k], rmax), 0, 255) as u8;
        }
    }
    (out, order.len())
}

// -------------------------------------------------------------- runs

fn run_bin(n: i32) -> usize {
    let mut i = 0;
    while RUN_LADDER[i] < n {
        i += 1;
    }
    i
}

/// Contiguous same-index runs along H, V and the main diagonal, binned on a log
/// ladder.  Captures stroke texture with no colour in it at all.
pub fn run_lengths(im: &Indexed) -> Vec<u8> {
    let (w, h) = (im.w, im.h);
    let mut hist = [[0i64; 16], [0i64; 16], [0i64; 16]];
    let walk = |vals: &dyn Fn(usize) -> i32, len: usize, hi: usize, hist: &mut [[i64; 16]; 3]| {
        if len == 0 {
            return;
        }
        let mut run = 1i32;
        let mut prev = vals(0);
        for i in 1..len {
            let v = vals(i);
            if v == prev {
                run += 1;
            } else {
                hist[hi][run_bin(run)] += 1;
                run = 1;
                prev = v;
            }
        }
        hist[hi][run_bin(run)] += 1;
    };
    for y in 0..h {
        walk(&|i| im.idx[y * w + i], w, 0, &mut hist);
    }
    for x in 0..w {
        walk(&|i| im.idx[i * w + x], h, 1, &mut hist);
    }
    for d in -(h as i64 - 1)..w as i64 {
        let x0 = if d > 0 { d as usize } else { 0 };
        let y0 = if d > 0 { 0 } else { (-d) as usize };
        let n = (w - x0).min(h - y0);
        if n < 2 {
            continue;
        }
        walk(&|i| im.idx[(y0 + i) * w + x0 + i], n, 2, &mut hist);
    }
    let mut out = vec![0u8; 48];
    for s in 0..3 {
        let tot: i64 = hist[s].iter().sum();
        for i in 0..16 {
            out[s * 16 + i] = if tot > 0 {
                clamp(idiv(hist[s][i] * 255, tot), 0, 255) as u8
            } else {
                0
            };
        }
    }
    out
}

// ------------------------------------------------- local fingerprints

/// D4 index maps, built once.
fn d4_maps() -> [[usize; 64]; 8] {
    let mut m = [[0usize; 64]; 8];
    for y in 0..8usize {
        for x in 0..8usize {
            let i = y * 8 + x;
            m[0][i] = y * 8 + x;
            m[1][i] = y * 8 + (7 - x);
            m[2][i] = (7 - y) * 8 + x;
            m[3][i] = (7 - y) * 8 + (7 - x);
            m[4][i] = x * 8 + y;
            m[5][i] = x * 8 + (7 - y);
            m[6][i] = (7 - x) * 8 + y;
            m[7][i] = (7 - x) * 8 + (7 - y);
        }
    }
    m
}

/// `med2` is the SUM of the two central order statistics, so the test is
/// `2v > s[31] + s[32]`.  Splitting at `s[32]` alone is not the symmetric
/// middle of 64 values, and an asymmetric threshold does not survive a
/// complement — which is exactly what the inversion fold needs it to do.
fn bits_of(g: &[i32; 64], med2: i64) -> (u32, u32) {
    let mut hi = 0u32;
    let mut lo = 0u32;
    for i in 0..32 {
        if 2 * g[i] as i64 > med2 {
            hi |= 1u32 << (31 - i);
        }
    }
    for i in 32..64 {
        if 2 * g[i] as i64 > med2 {
            lo |= 1u32 << (63 - i);
        }
    }
    (hi, lo)
}

/// Canonical over D4 x {identity, complement} — sixteen variants.
///
/// Complementing the bits is what an INVERTED palette does to this descriptor:
/// the median test simply reverses.  Folding the complement into the canonical
/// form makes an inverted copy produce byte-identical fingerprints, which a
/// `min(d, 64 - d)` distance at compare time cannot do — complementation
/// commutes with D4, so the canonical form of the complement is the complement
/// of the lexicographic MAXIMUM, not of the minimum, and the two do not meet.
/// The cost is real: light/dark polarity is discarded.
fn canonical64(cell: &[i32; 64], fold_invert: bool, maps: &[[usize; 64]; 8]) -> (u32, u32) {
    let mut srt = *cell;
    srt.sort_unstable();
    let med2 = srt[31] as i64 + srt[32] as i64;
    let mut best: Option<(u32, u32)> = None;
    let mut var = [0i32; 64];
    for m in maps.iter() {
        for k in 0..64 {
            var[k] = cell[m[k]];
        }
        let b = bits_of(&var, med2);
        if best.is_none() || b < best.unwrap() {
            best = Some(b);
        }
        if fold_invert {
            let c = (!b.0, !b.1);
            if c < best.unwrap() {
                best = Some(c);
            }
        }
    }
    best.unwrap_or((0, 0))
}

fn mix64(hi: u32, lo: u32) -> u32 {
    let mut a = hi ^ 0x9e37_79b9;
    let mut b = lo ^ 0x85eb_ca6b;
    a = (a ^ (a >> 16)).wrapping_mul(0x7feb_352d);
    b = (b ^ (b >> 15)).wrapping_mul(0x846c_a68b);
    a ^= b;
    a = (a ^ (a >> 13)).wrapping_mul(0xc2b2_ae35);
    a ^ (a >> 16)
}

fn integral_u8(map: &[u8], w: usize, h: usize) -> Vec<i64> {
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

pub struct Region {
    pub hi: u32,
    pub lo: u32,
    pub x: i64,
    pub y: i64,
    pub size: i64,
    pub key: u32,
}

/// Candidate positions: a STRICT LOCAL MAXIMUM of a content function, decided
/// inside a fixed pixel radius and nowhere else.  Ties break on a hash of the
/// patch GRADIENT rather than position, because position is what a crop
/// changes — and gradient rather than level, because level does not survive an
/// inversion and the complement fold then never gets the chance to fire.
fn content_peaks(qmap: &[i32], sw: usize, sh: usize, r: usize) -> Vec<(i64, i64, i64)> {
    let n = sw * sh;
    let mut sal = vec![0i64; n];
    let mut pack = vec![-1i64; n];
    for y in 1..sh.saturating_sub(1) {
        for x in 1..sw.saturating_sub(1) {
            let p = y * sw + x;
            let c = qmap[p];
            if c < 0 {
                continue;
            }
            let mut e = 0i64;
            let mut t: u32 = 0;
            for dy in -1i64..=1 {
                for dx in -1i64..=1 {
                    let v = qmap[(p as i64 + dy * sw as i64 + dx) as usize];
                    let g = if v < 0 { 64 } else { (v - c).abs() };
                    e += g as i64;
                    t = t.wrapping_mul(31).wrapping_add(g as u32);
                }
            }
            sal[p] = e;
            let tie = mix64(t, e as u32);
            pack[p] = if e > 0 { e * 4294967296 + tie as i64 } else { -1 };
        }
    }
    // separable running max with a monotonic deque — the direct (2r+1)^2 test
    // was 31M comparisons on a 736x352 work and dominated hashing
    let mut row_max = vec![i64::MIN; n];
    let mut q: Vec<usize> = Vec::with_capacity(sw.max(sh) + 1);
    for y in 0..sh {
        let base = y * sw;
        q.clear();
        let mut head = 0usize;
        for x in 0..sw + r {
            if x < sw {
                while q.len() > head && pack[base + q[q.len() - 1]] <= pack[base + x] {
                    q.pop();
                }
                q.push(x);
            }
            if x >= r {
                let cx = x - r;
                while q.len() > head && (q[head] as i64) < cx as i64 - r as i64 {
                    head += 1;
                }
                row_max[base + cx] = pack[base + q[head]];
            }
        }
    }
    let mut col_max = vec![i64::MIN; n];
    for x in 0..sw {
        q.clear();
        let mut head = 0usize;
        for y in 0..sh + r {
            if y < sh {
                while q.len() > head && row_max[q[q.len() - 1] * sw + x] <= row_max[y * sw + x] {
                    q.pop();
                }
                q.push(y);
            }
            if y >= r {
                let cy = y - r;
                while q.len() > head && (q[head] as i64) < cy as i64 - r as i64 {
                    head += 1;
                }
                col_max[cy * sw + x] = row_max[q[head] * sw + x];
            }
        }
    }
    let mut pts = Vec::new();
    if sh > 2 * r && sw > 2 * r {
        for y in r..sh - r {
            for x in r..sw - r {
                let p = y * sw + x;
                if pack[p] > 0 && pack[p] == col_max[p] {
                    pts.push(((x as i64) << 1, (y as i64) << 1, sal[p]));
                }
            }
        }
    }
    pts
}

fn offsets(c2: i64, win: i64, span: i64) -> Vec<i64> {
    let num = c2 + 1 - win;
    let base = num >> 1;
    let list: Vec<i64> = if num & 1 != 0 { vec![base, base + 1] } else { vec![base] };
    let mut out: Vec<i64> = Vec::new();
    for v in list {
        let v = clamp(v, 0, span - win);
        if !out.contains(&v) {
            out.push(v);
        }
    }
    out
}

pub struct LocalOut {
    pub bytes: Vec<u8>,
    pub pos: Vec<u8>,
    pub count: usize,
}

/// The collage channel, and the one that decides whether a sprite buried in a
/// busy scene is ever found.  Keeps the `localCount` SMALLEST scrambled keys —
/// a MinHash selection, so the decision to keep a window depends only on that
/// window's own content and a drawing hashed alone nominates the same windows
/// as the same drawing pasted into a scene.
pub fn local_fingerprints(im: &Indexed, cfg: &Config) -> LocalOut {
    let (sw, sh) = (im.w, im.h);
    let qmap: Vec<i32> = im
        .idx
        .iter()
        .map(|&v| if v < 0 { -1 } else { im.pal[v as usize].quantile })
        .collect();
    let op: Vec<u8> = im.idx.iter().map(|&v| if v < 0 { 0u8 } else { 1u8 }).collect();
    let so = integral_u8(&op, sw, sh);
    let maps = d4_maps();
    let pts = content_peaks(&qmap, sw, sh, cfg.peak_radius as usize);

    let mut cand: Vec<Region> = Vec::new();
    let mut cell = [0i32; 64];
    let mut scratch = [0i32; 4096];
    for &win in cfg.local_windows.iter() {
        let win = win as i64;
        if (sw as i64) < win || (sh as i64) < win {
            continue;
        }
        let area = win * win;
        let q = (win >> 3) as usize;
        for &(x2, y2, _sal) in pts.iter() {
            for &x in offsets(x2, win, sw as i64).iter() {
                for &y in offsets(y2, win, sh as i64).iter() {
                    if x < 0 || y < 0 || x + win > sw as i64 || y + win > sh as i64 {
                        continue;
                    }
                    // the opacity floor is what lets a sprite hashed on its own
                    // match the same sprite composited onto a host: admit
                    // half-transparent windows and the bits encode the
                    // SILHOUETTE, which the composite does not have
                    let (x0, y0) = (x as usize, y as usize);
                    let w1 = w_box(&so, sw, x0, y0, win as usize);
                    if w1 * 4 < area * 3 {
                        continue;
                    }
                    for cy in 0..8usize {
                        for cx in 0..8usize {
                            if q == 1 {
                                let v1 = qmap[(y0 + cy) * sw + x0 + cx];
                                cell[cy * 8 + cx] = if v1 < 0 { 257 } else { 2 * (v1 + 1) };
                            } else {
                                let mut nv = 0usize;
                                for by in 0..q {
                                    for bx in 0..q {
                                        let vq = qmap[(y0 + cy * q + by) * sw + x0 + cx * q + bx];
                                        let val = if vq < 0 { 257 } else { 2 * (vq + 1) };
                                        let mut j = nv;
                                        while j > 0 && scratch[j - 1] > val {
                                            scratch[j] = scratch[j - 1];
                                            j -= 1;
                                        }
                                        scratch[j] = val;
                                        nv += 1;
                                    }
                                }
                                cell[cy * 8 + cx] = scratch[nv >> 1];
                            }
                        }
                    }
                    let (hi, lo) = canonical64(&cell, cfg.fold_invert, &maps);
                    // an all-zero code collides with every featureless patch in
                    // every work ever hashed, INCLUDING its own rotations, so it
                    // poisons the empirical null as well as the count
                    let pc = hi.count_ones() + lo.count_ones();
                    if pc < 6 || pc > 58 {
                        continue;
                    }
                    cand.push(Region { hi, lo, x, y, size: win, key: mix64(hi, lo) });
                }
            }
        }
    }

    cand.sort_by(|a, b| {
        a.key
            .cmp(&b.key)
            .then(a.hi.cmp(&b.hi))
            .then(a.lo.cmp(&b.lo))
            .then(a.x.cmp(&b.x))
            .then(a.y.cmp(&b.y))
    });
    let mut picked: Vec<&Region> = Vec::new();
    let mut seen: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();
    for e in cand.iter() {
        if picked.len() >= cfg.local_count {
            break;
        }
        if !seen.insert((e.hi, e.lo)) {
            continue; // a repeated texture is one vote, not forty
        }
        picked.push(e);
    }
    let mut wire: Vec<&&Region> = picked.iter().collect();
    wire.sort_by(|a, b| a.hi.cmp(&b.hi).then(a.lo.cmp(&b.lo)));

    let cap = 128usize;
    let mut out = vec![0u8; cap * 8];
    let mut pos = vec![0u8; cap * 4];
    let max_dim = im.w.max(im.h) as i64;
    for (i, e) in wire.iter().take(cap).enumerate() {
        let o = i << 3;
        let qo = i << 2;
        out[o..o + 4].copy_from_slice(&e.hi.to_le_bytes());
        out[o + 4..o + 8].copy_from_slice(&e.lo.to_le_bytes());
        // ASPECT-TRUE u16 in units of 1/65535 of max(w,h), the SAME frame the
        // keypoints use (SPEC-003 §5.6)
        let px = clamp(idiv((e.x + (e.size >> 1)) * 65535, max_dim), 0, 65535) as u16;
        let py = clamp(idiv((e.y + (e.size >> 1)) * 65535, max_dim), 0, 65535) as u16;
        pos[qo..qo + 2].copy_from_slice(&px.to_le_bytes());
        pos[qo + 2..qo + 4].copy_from_slice(&py.to_le_bytes());
    }
    LocalOut { bytes: out, pos, count: wire.len().min(cap) }
}

#[inline]
fn w_box(s: &[i64], w: usize, x: usize, y: usize, win: usize) -> i64 {
    let ws = w + 1;
    s[(y + win) * ws + x + win] - s[y * ws + x + win] - s[(y + win) * ws + x] + s[y * ws + x]
}

// -------------------------------------------------------- silhouette

/// Its own channel, on purpose.  Two sprites cut from the same sheet share a
/// silhouette exactly; the same sprite composited into a scene has no
/// silhouette at all.  Strong when measurable, ZERO information when not —
/// which is the shape of a channel that must be able to abstain.
pub fn silhouette(im: &Indexed) -> (Vec<u8>, bool) {
    let (w, h) = (im.w, im.h);
    let n = w * h;
    let mut out = vec![0u8; 96];
    let opaque = im.idx.iter().filter(|&&v| v >= 0).count() as i64;
    if opaque == 0 || opaque * 100 > n as i64 * 98 || opaque * 100 < n as i64 * 2 {
        return (out, false);
    }
    let mut id = vec![-1i32; n];
    let mut stack: Vec<usize> = Vec::new();
    let mut comps: Vec<Comp> = Vec::new();
    let (mut best, mut best_area) = (-1i32, 0i64);
    for s0 in 0..n {
        if id[s0] >= 0 || im.idx[s0] < 0 {
            continue;
        }
        let cid = comps.len() as i32;
        let (mut area, mut sx, mut sy) = (0i64, 0i64, 0i64);
        let (mut minx, mut maxx, mut miny, mut maxy) = (w as i64, -1i64, h as i64, -1i64);
        stack.clear();
        stack.push(s0);
        id[s0] = cid;
        while let Some(p) = stack.pop() {
            let px = (p % w) as i64;
            let py = (p / w) as i64;
            area += 1;
            sx += px;
            sy += py;
            minx = minx.min(px);
            maxx = maxx.max(px);
            miny = miny.min(py);
            maxy = maxy.max(py);
            if px > 0 && id[p - 1] < 0 && im.idx[p - 1] >= 0 {
                id[p - 1] = cid;
                stack.push(p - 1);
            }
            if (px as usize) < w - 1 && id[p + 1] < 0 && im.idx[p + 1] >= 0 {
                id[p + 1] = cid;
                stack.push(p + 1);
            }
            if py > 0 && id[p - w] < 0 && im.idx[p - w] >= 0 {
                id[p - w] = cid;
                stack.push(p - w);
            }
            if (py as usize) < h - 1 && id[p + w] < 0 && im.idx[p + w] >= 0 {
                id[p + w] = cid;
                stack.push(p + w);
            }
        }
        if area > best_area {
            best_area = area;
            best = cid;
        }
        comps.push(Comp { id: cid, area, cx: idiv(sx, area), cy: idiv(sy, area), minx, maxx, miny, maxy });
    }
    if best < 0 {
        return (out, false);
    }
    let c = &comps[best as usize];
    let bw = c.maxx - c.minx + 1;
    let bh = c.maxy - c.miny + 1;

    let (mut cx, mut cy) = (c.cx, c.cy);
    if id[(cy as usize) * w + cx as usize] != c.id {
        let mut bd = i64::MAX;
        for y in c.miny..=c.maxy {
            for x in c.minx..=c.maxx {
                if id[(y as usize) * w + x as usize] != c.id {
                    continue;
                }
                let d = (x - c.cx) * (x - c.cx) + (y - c.cy) * (y - c.cy);
                if d < bd {
                    bd = d;
                    cx = x;
                    cy = y;
                }
            }
        }
    }
    let mut rad = [0i64; 32];
    let mut rmax = 1i64;
    for k in 0..32 {
        let mut t2 = 0i64;
        for step in 1..=(bw + bh) {
            let rx = cx + ((RAYC[k] as i64 * step + (RONE >> 1)) >> R);
            let ry = cy + ((RAYSN[k] as i64 * step + (RONE >> 1)) >> R);
            if rx < 0 || ry < 0 || rx >= w as i64 || ry >= h as i64 {
                break;
            }
            if id[(ry as usize) * w + rx as usize] != c.id {
                break;
            }
            t2 = step;
        }
        rad[k] = t2;
        rmax = rmax.max(t2);
    }
    for k in 0..32 {
        out[k] = clamp(idiv(255 * rad[k], rmax), 0, 255) as u8;
    }

    let (mut m20, mut m02, mut m11, mut cnt) = (0i64, 0i64, 0i64, 0i64);
    for y in c.miny..=c.maxy {
        for x in c.minx..=c.maxx {
            if id[(y as usize) * w + x as usize] != c.id {
                continue;
            }
            let dx = x - cx;
            let dy = y - cy;
            m20 += dx * dx;
            m02 += dy * dy;
            m11 += dx * dy;
            cnt += 1;
        }
    }
    let norm = (cnt * (bw * bw + bh * bh)).max(1);
    out[32] = clamp(idiv(m20 * 1020, norm), 0, 255) as u8;
    out[33] = clamp(idiv(m02 * 1020, norm), 0, 255) as u8;
    out[34] = clamp(idiv(m11.abs() * 1020, norm), 0, 255) as u8;
    out[35] = if m11 < 0 { 1 } else { 0 };
    let asp = clamp(idiv(bw * 256, bh.max(1)), 0, 65535) as u16;
    out[36..38].copy_from_slice(&asp.to_le_bytes());
    out[38] = clamp(idiv(c.area * 255, (bw * bh).max(1)), 0, 255) as u8;
    out[39] = clamp(comps.len() as i64, 0, 255) as u8;

    let mut row_t = [0i64; 8];
    let mut col_t = [0i64; 8];
    for y in 0..h {
        let mut t = 0usize;
        let mut prev = 0i32;
        for x in 0..w {
            let v = if im.idx[y * w + x] >= 0 { 1 } else { 0 };
            if v != prev {
                t += 1;
            }
            prev = v;
        }
        row_t[t.min(7)] += 1;
    }
    for x in 0..w {
        let mut t = 0usize;
        let mut prev = 0i32;
        for y in 0..h {
            let v = if im.idx[y * w + x] >= 0 { 1 } else { 0 };
            if v != prev {
                t += 1;
            }
            prev = v;
        }
        col_t[t.min(7)] += 1;
    }
    for i in 0..8 {
        out[40 + i] = clamp(idiv(row_t[i] * 255, h as i64), 0, 255) as u8;
        out[48 + i] = clamp(idiv(col_t[i] * 255, w as i64), 0, 255) as u8;
    }

    let maps = d4_maps();
    let mut cell = [0i32; 64];
    for gy in 0..8i64 {
        for gx in 0..8i64 {
            let x0 = c.minx + idiv(gx * bw, 8);
            let mut x1 = c.minx + idiv((gx + 1) * bw, 8);
            let y0 = c.miny + idiv(gy * bh, 8);
            let mut y1 = c.miny + idiv((gy + 1) * bh, 8);
            if x1 <= x0 {
                x1 = x0 + 1;
            }
            if y1 <= y0 {
                y1 = y0 + 1;
            }
            let (mut on, mut tot) = (0i64, 0i64);
            for y in y0..y1.min(h as i64) {
                for x in x0..x1.min(w as i64) {
                    tot += 1;
                    if id[(y as usize) * w + x as usize] == c.id {
                        on += 1;
                    }
                }
            }
            cell[(gy * 8 + gx) as usize] = if tot > 0 { idiv(on * 255, tot) as i32 } else { 0 };
        }
    }
    let (hi, lo) = canonical64(&cell, false, &maps);
    out[56..60].copy_from_slice(&hi.to_le_bytes());
    out[60..64].copy_from_slice(&lo.to_le_bytes());
    let frac = clamp(idiv(opaque * 65535, n as i64), 0, 65535) as u16;
    out[64..66].copy_from_slice(&frac.to_le_bytes());
    (out, true)
}

// ----------------------------------------------------- colour digest

/// REPORTING ONLY.  This section MUST NOT contribute to any score: recolour
/// invariance is load-bearing and dies the moment absolute RGB enters the
/// scoring path.  Conformance: zeroing it MUST NOT change any verdict.
pub fn colour_digest(im: &Indexed) -> (Vec<u8>, usize) {
    let mut out = vec![0u8; 80];
    let n = 16.min(im.pal.len());
    let max_n = if im.pal.is_empty() { 1 } else { im.pal[0].n as i64 };
    for i in 0..n {
        let p = &im.pal[i];
        let o = i * 5;
        out[o] = p.r;
        out[o + 1] = p.g;
        out[o + 2] = p.b;
        out[o + 3] = clamp(idiv(p.n as i64 * 255 + (max_n >> 1), max_n), 0, 255) as u8;
        out[o + 4] = p.quantile as u8;
    }
    (out, n)
}
