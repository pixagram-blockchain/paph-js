/* @pixagram/paph-js — SPEC-004.2 exact assignment (comparator 51 local stage).
 *
 * Objective (004.2 §6, normative): maximize matched pairs; among all
 * maximum-cardinality matchings, minimize total Hamming cost.  Three
 * implementations of the SAME objective:
 *
 *   assign(n, m, cost)        dense Hungarian — the frozen conformance oracle
 *   assignSparse(n, m, cost)  Hungarian on the edge-induced subgraph
 *   assignEdges(n, m, edges)  sparse exact min-cost/max-flow (SSP with
 *                             potentials) — the 004.2 hot path; O(N+M+E)
 *                             memory, no dense matrix (004.2 §8)
 *
 * Determinism (004.2 §8.3): all tie-breaks resolve to the smallest vertex /
 * edge index in original row/column order; outputs sort by (row, column).
 * Pair identity may differ between solvers only on equal-cost ties (§13);
 * cardinality and total cost may not (Q1/Q2).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.paphAssign = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var NO_EDGE = -1;
var A_BIG = 1 << 30;
var A_INF = Number.MAX_SAFE_INTEGER / 4;

/* dense Hungarian (e-maxx), ported frozen from the 4.1 reference */
function assign(n, m, cost) {
  if (!n || !m) return [];
  var transposed = n > m;
  var rn = transposed ? m : n, rm = transposed ? n : m;
  /* materialize the working matrix once, missing edges as A_BIG — every
   * value <= 2^30, exact in float64; the solve then runs on flat typed
   * arrays with the same strict-< tie-breaks as before */
  var C = new Float64Array(rn * rm), r2, c2;
  if (transposed) {
    for (r2 = 0; r2 < rn; r2++) for (c2 = 0; c2 < rm; c2++) {
      var vt = cost[c2 * m + r2]; C[r2 * rm + c2] = vt < 0 ? A_BIG : vt;
    }
  } else {
    for (r2 = 0; r2 < rn; r2++) for (c2 = 0; c2 < rm; c2++) {
      var vd = cost[r2 * m + c2]; C[r2 * rm + c2] = vd < 0 ? A_BIG : vd;
    }
  }
  var u = new Float64Array(rn), v = new Float64Array(rm + 1);
  var p = new Int32Array(rm + 1).fill(-1), way = new Int32Array(rm);
  var minv = new Float64Array(rm), used = new Uint8Array(rm + 1);
  for (var i = 0; i < rn; i++) {
    p[rm] = i;
    var j0 = rm;
    minv.fill(A_INF);
    used.fill(0);
    for (;;) {
      used[j0] = 1;
      var i0 = p[j0], delta = A_INF, j1 = -1, j;
      var base = i0 * rm, ui0 = u[i0];
      for (j = 0; j < rm; j++) {
        if (used[j]) continue;
        var cur = C[base + j] - ui0 - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (j = 0; j <= rm; j++) {
        if (used[j]) { if (p[j] !== -1) u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
      if (p[j0] === -1) break;
    }
    for (;;) {
      var jw = way[j0];
      p[j0] = p[jw];
      j0 = jw;
      if (j0 === rm) break;
    }
  }
  var out = [];
  for (var jj = 0; jj < rm; jj++) {
    var ii = p[jj];
    if (ii === -1) continue;
    var r = transposed ? jj : ii, c = transposed ? ii : jj;
    if (cost[r * m + c] >= 0) out.push([r, c]);
  }
  out.sort(function (x, y) { return x[0] - y[0] || x[1] - y[1]; });
  return out;
}

/* Hungarian restricted to rows/columns that carry at least one edge */
function assignSparse(n, m, cost) {
  if (!n || !m) return [];
  var rowHas = new Array(n).fill(false), colHas = new Array(m).fill(false);
  var r, c;
  for (r = 0; r < n; r++) for (c = 0; c < m; c++)
    if (cost[r * m + c] >= 0) { rowHas[r] = true; colHas[c] = true; }
  var ri = [], ci = [];
  for (r = 0; r < n; r++) if (rowHas[r]) ri.push(r);
  for (c = 0; c < m; c++) if (colHas[c]) ci.push(c);
  if (!ri.length || !ci.length) return [];
  var rn = ri.length, rm = ci.length;
  var sub = new Int32Array(rn * rm).fill(NO_EDGE);
  for (r = 0; r < rn; r++) for (c = 0; c < rm; c++) sub[r * rm + c] = cost[ri[r] * m + ci[c]];
  var out = assign(rn, rm, sub).map(function (p) { return [ri[p[0]], ci[p[1]]]; });
  out.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  return out;
}

/* Sparse exact solver — successive shortest augmenting paths with Johnson
 * potentials over the residual graph of the unit-capacity bipartite flow
 * network (004.2 §8.2).  Node ids: 0 = source, 1..n rows, n+1..n+m columns,
 * n+m+1 = sink.  Every original cost is >= 0, so reduced costs stay >= 0 and
 * an O(V^2) array Dijkstra is exact; ties resolve to the smallest node id and
 * the smallest edge insertion index, both derived from original order. */
function assignEdges(n, m, edges) {
  if (!n || !m || !edges) return [];
  var V = n + m + 2, S = 0, T = n + m + 1;
  var head = new Int32Array(V).fill(-1);
  var eTo = [], eCap = [], eCost = [], eNext = [];
  function addEdge(a, b, cap, cost) {
    eTo.push(b); eCap.push(cap); eCost.push(cost); eNext.push(head[a]); head[a] = eTo.length - 1;
    eTo.push(a); eCap.push(0); eCost.push(-cost); eNext.push(head[b]); head[b] = eTo.length - 1;
  }
  var i, r, k, E = 0;
  /* insertion order fixed: source->rows ascending, then row edges in row
   * order / given intra-row order, then columns->sink ascending.  head[] is
   * a LIFO list, so iterate rows/edges in REVERSE to scan ascending later. */
  for (r = n - 1; r >= 0; r--) addEdge(S, 1 + r, 1, 0);
  for (r = n - 1; r >= 0; r--) {
    var row = edges[r] || [];
    for (k = row.length - 1; k >= 0; k--) {
      var c = row[k][0] | 0, d = row[k][1] | 0;
      if (c < 0 || c >= m) throw new RangeError('assignEdges: column out of range');
      if (d < 0) continue;                       /* negative = no edge */
      addEdge(1 + r, 1 + n + c, 1, d); E++;
    }
  }
  for (var cc = m - 1; cc >= 0; cc--) addEdge(1 + n + cc, T, 1, 0);
  if (!E) return [];

  var pot = new Float64Array(V);               /* all-zero valid: costs >= 0 */
  var dist = new Float64Array(V), prevE = new Int32Array(V), done = new Uint8Array(V);
  var matched = 0, maxMatch = Math.min(n, m);
  while (matched < maxMatch) {
    dist.fill(A_INF); done.fill(0); prevE.fill(-1);
    dist[S] = 0;
    for (;;) {
      var best = -1, bd = A_INF;
      for (i = 0; i < V; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; best = i; }
      if (best < 0) break;
      done[best] = 1;
      for (var e = head[best]; e !== -1; e = eNext[e]) {
        if (eCap[e] <= 0) continue;
        var to = eTo[e];
        if (done[to]) continue;                /* a settled predecessor is final */
        var nd = dist[best] + eCost[e] + pot[best] - pot[to];
        if (nd < dist[to] || (nd === dist[to] && prevE[to] !== -1 && e < prevE[to])) {
          dist[to] = nd; prevE[to] = e;
        }
      }
    }
    if (dist[T] >= A_INF) break;               /* no augmenting path left */
    for (i = 0; i < V; i++) if (dist[i] < A_INF) pot[i] += dist[i];
    var e2 = prevE[T];
    while (e2 !== -1) {
      eCap[e2] -= 1; eCap[e2 ^ 1] += 1;
      e2 = prevE[eTo[e2 ^ 1]];
    }
    matched++;
  }
  var out = [];
  for (r = 0; r < n; r++) {
    for (var e3 = head[1 + r]; e3 !== -1; e3 = eNext[e3]) {
      var to2 = eTo[e3];
      if (to2 > n && to2 < T && eCap[e3] === 0 && eCap[e3 ^ 1] === 1)
        out.push([r, to2 - 1 - n]);
    }
  }
  out.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  return out;
}

/* 004.2 §9 dispatch: sparse solver below the density cutoff, dense above.
 * The cutoff changes execution, never the objective. */
var DENSITY_NUM = 1, DENSITY_DEN = 6;
function assignDispatch(n, m, edges) {
  var E = 0;
  for (var r = 0; r < n; r++) E += (edges[r] || []).length;
  if (E * DENSITY_DEN <= n * m * DENSITY_NUM) return { pairs: assignEdges(n, m, edges), path: 'sparse', edges: E };
  var cost = new Int32Array(n * m).fill(NO_EDGE);
  for (r = 0; r < n; r++) {
    var row = edges[r] || [];
    for (var k = 0; k < row.length; k++) cost[r * m + row[k][0]] = row[k][1];
  }
  return { pairs: assign(n, m, cost), path: 'dense', edges: E };
}
function totalCost(pairs, edges) {
  var map = new Map();
  for (var r = 0; r < edges.length; r++)
    for (var k = 0; k < (edges[r] || []).length; k++) map.set(r * 1048576 + edges[r][k][0], edges[r][k][1]);
  var s = 0;
  for (var i = 0; i < pairs.length; i++) s += map.get(pairs[i][0] * 1048576 + pairs[i][1]) || 0;
  return s;
}

return { NO_EDGE: NO_EDGE, BIG: A_BIG,
         assign: assign, assignSparse: assignSparse, assignEdges: assignEdges,
         assignDispatch: assignDispatch, totalCost: totalCost,
         DENSITY_NUM: DENSITY_NUM, DENSITY_DEN: DENSITY_DEN };
}));
