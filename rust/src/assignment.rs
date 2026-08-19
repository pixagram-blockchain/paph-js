//! Deterministic assignment (SPEC-004 §10.2, Appendix A).
//!
//! Maximum-cardinality, then minimum-cost, matching on a sparse bipartite
//! graph, computed by successive shortest augmenting paths with potentials —
//! the Hungarian method, pinned down to one function: rows visited once in
//! ascending index, every argmin tie broken toward the smaller column, missing
//! edges carried as one BIG cost so that cardinality dominates cost
//! lexicographically (128 · BIG_real_total < BIG, so no count of real edges
//! can ever buy one forbidden edge).
//!
//! Greedy's failure mode, for the record: edges (0,0)=1, (0,1)=2, (1,0)=2.
//! Stratified greedy takes (0,0) and strands row 1.  The assignment takes
//! (0,1)+(1,0): two matches for cost 4.  With repeated descriptors this is the
//! difference between counting a paste and missing it.

pub const NO_EDGE: i32 = -1;
const BIG: i64 = 1 << 30; // real edge costs are ≤ 2^15; 128 of them < 2^22 ≪ BIG
const INF: i64 = i64::MAX / 4;
const NONE: usize = usize::MAX;

/// `cost` is row-major `n × m`; `NO_EDGE` (or any negative) means no edge,
/// otherwise `0 ..= 32767`.  Returns matched `(row, col)` pairs, ascending by
/// row.  Output is a pure function of the inputs — no iteration-order,
/// allocation, or platform dependence.
pub fn assign(n: usize, m: usize, cost: &[i32]) -> Vec<(usize, usize)> {
    debug_assert_eq!(cost.len(), n * m);
    if n == 0 || m == 0 {
        return Vec::new();
    }
    let at = |r: usize, c: usize, transposed: bool| -> i64 {
        let v = if transposed { cost[c * m + r] } else { cost[r * m + c] };
        if v < 0 { BIG } else { v as i64 }
    };
    let transposed = n > m;
    let (rn, rm) = if transposed { (m, n) } else { (n, m) };

    // e-maxx Hungarian, 0-indexed, virtual start column `rm`.
    let mut u = vec![0i64; rn];
    let mut v = vec![0i64; rm + 1];
    let mut p = vec![NONE; rm + 1]; // p[j] = row matched to column j
    let mut way = vec![0usize; rm];

    for i in 0..rn {
        p[rm] = i;
        let mut j0 = rm;
        let mut minv = vec![INF; rm];
        let mut used = vec![false; rm + 1];
        loop {
            used[j0] = true;
            let i0 = p[j0];
            let mut delta = INF;
            let mut j1 = NONE;
            for j in 0..rm {
                if !used[j] {
                    let cur = at(i0, j, transposed) - u[i0] - v[j];
                    if cur < minv[j] {
                        minv[j] = cur;
                        way[j] = j0;
                    }
                    if minv[j] < delta {
                        delta = minv[j];
                        j1 = j; // strict `<`: first (smallest) column keeps ties
                    }
                }
            }
            for j in 0..=rm {
                if used[j] {
                    if p[j] != NONE {
                        u[p[j]] += delta;
                    }
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }
            j0 = j1;
            if p[j0] == NONE {
                break;
            }
        }
        loop {
            let j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
            if j0 == rm {
                break;
            }
        }
    }

    let mut out = Vec::new();
    for j in 0..rm {
        let i = p[j];
        if i == NONE {
            continue;
        }
        let (r, c) = if transposed { (j, i) } else { (i, j) };
        // BIG edges are the completion trick, not matches.
        if cost[r * m + c] >= 0 {
            out.push((r, c));
        }
    }
    out.sort_unstable();
    out
}

/// SPEC-004.1 Appendix A (comparator 41): the assignment computed on the
/// edge-induced subgraph — rows and columns holding at least one real edge,
/// taken in ascending original index; dummy completion applies to the
/// subgraph only.  Cardinality and total cost always equal `assign`'s; the
/// matched pair-set may differ where cost ties exist, because the dummy
/// columns of the full matrix no longer participate in tie-breaking.  That
/// is why 4.1 is a comparator bump and this sits beside `assign`, never in
/// place of it.
pub fn assign_sparse(n: usize, m: usize, cost: &[i32]) -> Vec<(usize, usize)> {
    debug_assert_eq!(cost.len(), n * m);
    if n == 0 || m == 0 {
        return Vec::new();
    }
    let mut row_has = vec![false; n];
    let mut col_has = vec![false; m];
    for r in 0..n {
        for c in 0..m {
            if cost[r * m + c] >= 0 {
                row_has[r] = true;
                col_has[c] = true;
            }
        }
    }
    let ri: Vec<usize> = (0..n).filter(|&r| row_has[r]).collect();
    let ci: Vec<usize> = (0..m).filter(|&c| col_has[c]).collect();
    if ri.is_empty() || ci.is_empty() {
        return Vec::new();
    }
    let (rn, rm) = (ri.len(), ci.len());
    let mut sub = vec![NO_EDGE; rn * rm];
    for (a, &r) in ri.iter().enumerate() {
        for (b, &c) in ci.iter().enumerate() {
            sub[a * rm + b] = cost[r * m + c];
        }
    }
    let mut out: Vec<(usize, usize)> =
        assign(rn, rm, &sub).iter().map(|&(a, b)| (ri[a], ci[b])).collect();
    out.sort_unstable();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn total(cost: &[i32], m: usize, sol: &[(usize, usize)]) -> i64 {
        sol.iter().map(|&(r, c)| cost[r * m + c] as i64).sum()
    }

    /// Exhaustive optimum by bitmask DP: (max cardinality, min cost among them).
    fn brute(n: usize, m: usize, cost: &[i32]) -> (usize, i64) {
        let full = 1usize << m;
        let mut best = vec![(0usize, 0i64); full]; // per used-column mask after all rows? do row DP
        // dp over rows: state = used column mask -> (card, cost) best
        let mut dp = vec![None::<(usize, i64)>; full];
        dp[0] = Some((0, 0));
        for r in 0..n {
            let mut nx = vec![None::<(usize, i64)>; full];
            for mask in 0..full {
                let Some((card, cst)) = dp[mask] else { continue };
                // skip row r
                upd(&mut nx[mask], (card, cst));
                for c in 0..m {
                    if mask & (1 << c) != 0 || cost[r * m + c] < 0 {
                        continue;
                    }
                    upd(&mut nx[mask | (1 << c)], (card + 1, cst + cost[r * m + c] as i64));
                }
            }
            dp = nx;
        }
        let mut ans = (0usize, 0i64);
        let mut have = false;
        for mask in 0..full {
            if let Some(s) = dp[mask] {
                if !have || better(s, ans) {
                    ans = s;
                    have = true;
                }
            }
        }
        let _ = &mut best;
        ans
    }
    fn better(a: (usize, i64), b: (usize, i64)) -> bool {
        a.0 > b.0 || (a.0 == b.0 && a.1 < b.1)
    }
    fn upd(slot: &mut Option<(usize, i64)>, s: (usize, i64)) {
        match slot {
            None => *slot = Some(s),
            Some(cur) => {
                if better(s, *cur) {
                    *slot = Some(s);
                }
            }
        }
    }

    #[test]
    fn beats_greedy_on_the_canonical_case() {
        // (0,0)=1 (0,1)=2 (1,0)=2 (1,1)=none — greedy strands row 1.
        let cost = [1, 2, 2, NO_EDGE];
        let sol = assign(2, 2, &cost);
        assert_eq!(sol, vec![(0, 1), (1, 0)]);
        assert_eq!(total(&cost, 2, &sol), 4);
    }

    #[test]
    fn exhaustive_cross_check() {
        // Every instance up to 7×7 on a deterministic LCG stream: cardinality
        // and cost must equal the enumerated optimum (SPEC-004 §20).
        let mut s: u64 = 0x9e3779b97f4a7c15;
        let mut next = move || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            s
        };
        for n in 1..=7usize {
            for m in 1..=7usize {
                for _case in 0..40 {
                    let cost: Vec<i32> = (0..n * m)
                        .map(|_| {
                            let r = next();
                            if r % 3 == 0 { NO_EDGE } else { (r >> 8) as i32 & 0x3fff }
                        })
                        .collect();
                    let sol = assign(n, m, &cost);
                    // validity: injective both sides, real edges only
                    let mut ru = vec![false; n];
                    let mut cu = vec![false; m];
                    for &(r, c) in &sol {
                        assert!(cost[r * m + c] >= 0);
                        assert!(!ru[r] && !cu[c]);
                        ru[r] = true;
                        cu[c] = true;
                    }
                    let (bc, bcost) = brute(n, m, &cost);
                    assert_eq!(sol.len(), bc, "cardinality {n}x{m}");
                    assert_eq!(total(&cost, m, &sol), bcost, "cost {n}x{m}");
                }
            }
        }
    }

    #[test]
    fn deterministic_and_shape_edges() {
        let cost = [3, 3, 3, 3, 3, 3];
        let a = assign(2, 3, &cost);
        let b = assign(2, 3, &cost);
        assert_eq!(a, b);
        assert_eq!(a, vec![(0, 0), (1, 1)]); // ties resolve to smallest columns
        assert!(assign(0, 5, &[]).is_empty());
        assert!(assign(3, 3, &[NO_EDGE; 9]).is_empty());
        // rectangular tall: transposition path
        let tall = [1, NO_EDGE, 5, 2, NO_EDGE, 1]; // 3 rows × 2 cols
        let s = assign(3, 2, &tall);
        let (bc, bcost) = {
            // quick manual optimum: rows {0,2} → cost 1+1=2, card 2
            (2usize, 2i64)
        };
        assert_eq!(s.len(), bc);
        assert_eq!(total(&tall, 2, &s), bcost);
    }
}
