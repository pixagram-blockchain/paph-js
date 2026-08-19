# ANALYSIS-001 — Field forensics on the first v4 corpus

Companion to PAPH-SPEC-004 and IMPL-004. Dataset: 496 pairs over 32 works
(test.zip, 10 families; §19.1 labels inferred, editable in the bench),
comparator 4 under CAL-001-PROVISIONAL, every measured quantity retained —
`paph4-fields-dataset.json` / `.csv`, 79 columns per pair, per-stage wall
times included. Every number below is reproducible from that file; the three
experiments at the end ran offline against unmodified engines.

Caveats up front: one corpus, ten families, no train/test split, ground
truth inferred from inspection. Findings are evidence for decisions, not
decisions.

## 1. What each field earns

AUC(pos > neg), all 496 pairs, and restricted to the geometry-zero region
(11 positives vs 445 negatives) where structural evidence must work alone:

```text
field                AUC all   AUC geo=0   pos p50    neg p50
v3 geo value          0.951      0.772      10000          0
geometry margin (v4)  0.892      0.500      10000          0
pool size (direct)    0.881      0.577         19          6
local margin          0.815      0.610       8194       7208
shape                 0.781      0.745       1268        837
palette               0.769      0.653       5464       2993
topology              0.738      0.280       1854        645
runs                  0.712      0.624       9403       9066
dct                   0.695      0.377        658        413
diversity             0.590      0.617       6886       6704
```

Readings:

- **Geometry is the identity channel.** Not one of 445 same-generator
  negatives produced a single point of v4 geometric margin; the GN family
  through the full multi-model procedure is airtight on the false side.
  The v3-vs-v4 gap (0.951 vs 0.892) is entirely on the TRUE side and is
  explained in §5 — it is a floor, not the control.
- **`runs` is a style carrier, not a work carrier.** Median 9066 on
  UNRELATED pairs; its null (§ control median 556) barely corrects. 48
  bytes of wire that award ~9000 currency to every same-generator pair.
  Its AUC survives only because copies score marginally higher still.
- **`shape` is the best structural channel where it matters** (0.745 in
  the geometry-zero region) — 328 bytes well spent.
- **`topology` INVERTS in the hard region** (0.280): on re-renders of the
  same work it reads lower than on unrelated pairs. As corroboration for
  certification it is fine; as evidence in the no-geometry region it
  misleads. `covMin` inverts there too (0.318).
- **The dct null over-corrects**: raw 0.732 vs corrected 0.695 — the only
  channel whose control costs discrimination on this corpus. Palette's
  control earns +0.079. Worth revisiting dct's null family against a
  larger corpus.
- **`silhouette` measured 28/496** — it abstains without a matte, and this
  corpus is mostly opaque. Not an indictment; a scope note.
- **`diversity` ≈ noise here** (0.590) — this corpus has no tile walls;
  R2 never fired. The guard stays; the corpus just doesn't exercise it.
- Channel correlations on negatives max out at |r| = 0.24: the style
  inflation is carried INDEPENDENTLY by each channel. No decorrelation
  trick removes it; per-channel calibration is the lever, and v4 has
  calibration tables for local and geometry only. A `runs` LUT (or wider:
  per-channel LUTs) is the principled v4.x extension.

Discrimination per Tier-1 byte, for the wire-budget discussion:

```text
section               bytes   AUC all   AUC geo=0
geometry (sketch)      1152    0.892      0.500
local codes+anchors    1536    0.815      0.610
shape                   328    0.781      0.745
topology (rag)          288    0.738      0.280
dct                     256    0.695      0.377
runs                     48    0.712      0.624
palette                  96    0.769      0.653
silhouette               96    0.714        —
brightness + colour      88    (no verdict channel consumes them)
```

## 2. The wrong pairs and the true pairs

The eight highest-structural negatives (the near-misses of the primary
gate) share one anatomy: `runs` 9400–9700, local margin 7800–8600,
palette variable, geometry zero. C2 and B2 appear in six of eight — the
busiest textures. Nothing came near certification: the worst negative
structural is 4759 against a certification bar that also demands geometry
the negatives never have.

Certification arms on the 51 positives under CAL-001: 33 certified with
structure AND geometry agreeing, 2 by geometry alone (crops), 2 byte-
identical, 14 in review. Structure alone certified nothing — on a
same-generator platform that is the correct shape: **geometry certifies,
structure corroborates.**

## 3. Weights: the AUC trap

A greedy integer-weight search maximizing structural AUC (draft LUT
active) moves 35/25/15/10/10/5/10 to 15/50/0/25/20/10/20 and lifts the
proxy from 0.887 to 0.913 — and then the LATTICE says: review load
3+14 → 10+149. Rank separation is not an operating point; thresholds are
absolute, and promoting high-baseline channels (`runs` to 25) spends the
threshold headroom the review band lives in. Demoting `runs` to 2 kills
the review band entirely (0 negatives in review — overfit to this corpus).
**Recommendation: keep CAL-001 weights in CAL-002; revisit weights only
together with a runs LUT.** The bench makes this a live experiment.

## 4. Compare-time budget

```text
stage                median ms    share of v4-only work
v3 compare (all 7 channels + geo)   5.4
local channel (§10)                44.4        ~93 %
correspond (both pools)             3.2
multi-model extraction              0.02
GN control (5 members, full)        0.05
total compare_v4                   53.3
```

The feared cost — the GN family through the full multi-model procedure —
is **free** (pools are small; sub-`geo_min_corr` pools exit instantly).
The entire budget is the assignment matcher: five Hungarian runs
(measurement + 4 LN members) on BIG-completed 128×128 matrices.

**Sparse-subgraph Hungarian** (drop rows/columns with no edge ≤ T before
solving; median active rows: 32 of 128): measured **×14.3**, and on 16 of
66 probed pairs the output differs — with **identical cardinality and
identical total cost** in every case. Pure tie-break divergence from the
dummy columns. To adopt it, Appendix A must be amended to DEFINE the
assignment on the edge-induced subgraph (rows/columns ascending by
original index); that is a normative change in cost-tied cases, so it is
comparator-versioned work with regenerated golden vectors — not a quiet
optimization. Projected compare_v4 median: ~12 ms.

**Correspond-only screen** for retrieval workloads: `max(pool_direct,
pool_mirror) ≥ geo_min_corr` costs 3.2 ms, keeps 50/51 positives, and
discards 190/445 negatives before any heavy work. The one screened-out
positive (G3×G4) is a zero-geometry re-render the full pipeline leaves at
Related anyway. This slots directly into §17's candidate-stage design.

## 5. The §12.3 floor discards real signal — the amendment experiment

Eleven positives carry zero v4 geometric margin. Their pools are small
(2–15 correspondences), and where a model IS found it holds 5–7 inliers —
below §12.3's first-model acceptance floor (`geo_min_corr` = 8), so the
extraction reports nothing. v3, which has no such floor, surfaces those
same 5–7 inliers as weak geometric evidence on six of the eleven.

Experiment (offline, engines untouched): geometry evidence from the best
single verified model with the member floor (≥ 3, the fit's requirement)
kept and the model-acceptance floor dropped — measurement and all five GN
members treated identically, margin chance-corrected as always.

```text
                      shipped §12.3      relaxed floor
geometry AUC              0.892              0.951
positives with margin>0   40/51              46/51
negatives with margin>0   0/445              1/445   (A3×J1, 3 inliers, margin 1875)
```

The control stays clean across the entire family — every recovered
positive shows ctl = 0. Projected operating point (CAL-002-DRAFT + this
amendment, + a low-band lutGeometry squash `(0,0)(1900,1100)(3000,3000)
(10000,10000)` that removes the single 3-inlier leak from review):

```text
                         DRAFT           DRAFT + amendment
false certifications     0 / 0                0 / 0
§9.5 losses              3 (all ≥Susp)        3 (all ≥Susp)
recall B  ≥Suspected     100 %                100 %
recall C∪D ≥Suspected    63.0 %               81.5 %
review load              3 + 14               8 + 14
```

Because no model is *accepted*, topology stays scattered and R3 keeps the
weak signal away from solo certification — it can raise a pair into
review, never into Copy on its own. This is the single highest-value
comparator change the corpus supports, and it is a §12.3 spec amendment
(comparator-versioned, golden-vectored), not a patch.

## 6. Recommendations, tiered

**Calibration tier (no code changes) —** ship CAL-002 from the DRAFT:
lutLocal squash of the same-generator band, geo-solo inlier floor 11,
weights unchanged; add the low-band lutGeometry squash when the §12.3
amendment lands. Validate on real moderation pairs with a held-out split
before removing the DRAFT suffix.

**Comparator tier (v4.x, spec + golden + both engines) —** (1) the §12.3
weak-signal amendment above; (2) Appendix A on the edge-induced subgraph
(×14 compare speed); (3) per-channel calibration LUTs, `runs` first;
(4) revisit the dct null (its control over-corrects).

**Hash tier (v5 wire) —** keypoints are the binding scarcity: `kpCount`
is hard-capped at 256 by the Tier-2 format (10 272 B = 32 + 256·40), and
geometry is the one channel that separates this platform's content. A
larger Tier-2 (or a second sketch tier) buys recall where it is provably
scarce. Second: `runs` as specified measures the generator, not the work
— renormalize or spend its 48 bytes better. Third: brightness + colour
(88 B) feed no verdict channel; either wire them into one or reclaim
them. Silhouette's 96 B pay off only for matte-bearing art — fine, but
worth stating in the wire budget.

**Corpus tier —** F4's scribbles zeroed the geometry entirely (7 inliers
survived only via the amendment): adversarial keypoint disruption is a
real evasion route and needs its own §22 category. And E1×E2 — two
renders of one source — is exactly the pair type where the platform's
policy (copy or legitimate re-generation?) must be decided by a human
before the corpus can teach the comparator.
