# SPEC-005.1 — PAPH Comparator 51 / Wire 5 / Extraction PAPH5-E03

Status: **implementation-frozen, calibration-provisional.**
Reference implementation: `src/wire.cjs`, `src/paph-js.cjs`, `src/assignment.cjs` (this repository).
Lineage: SPEC-004.2 (fast exact compare, comparator 41) and SPEC-005.0 (three-axis
evidence architecture). 005.1 folds the 004.2 contract into 5.0's structural
local channel and freezes the rulings discovered during the build.

Conformance: a comparator 51 implementation MUST reproduce the reference
byte-for-byte on Tier-1/Tier-2 emission and field-for-field on `compare()`
JSON for any input, under the same pcal profile.

---

## 1. Scope and vocabulary

Two artifacts: a **fingerprint** (Tier 1 mandatory + Tier 2 optional) emitted
by the extraction pipeline, and a **comparison report** emitted by
`compare(a, b, opts)`. "Side A"/"side B" are the caller's roles; the
computation itself is direction-free (§9).

D4 elements are indexed 0..7 with the forward semantics of `D4F` in the wire:
`m` names the element that maps A's frame onto B's. `D4INV`, `D4MAP8`
(descriptor-plane gather maps), `D4_QUARTER`, `D4_MIRROR` are frozen tables.

## 2. Wire (Tier 1 / Tier 2)

* Tier 1: 2560 bytes, sectioned (W-3: section table with derived offsets,
  never stored; W-5: lengths frozen). CRC-32 in the last 4 bytes.
* Tier 2: 32-byte header + 32 bytes per keypoint record (W-2: reserved
  bytes MUST be zero; parsers MUST reject nonzero), n ≤ 512, CRC-32 and a
  copy of the Tier-1 CRC for tier linkage.
* Keypoint record: x12/y12 (frame-normalized 12-bit), level, orientation
  octant, s8 strength (median-normalized, D4- and inversion-invariant),
  region (6-bit), coarse32, w[0..3] descriptor words, divTag.
* Descriptor (E03 `describe128`): an 8×8 median9-sampled grid; w[0..1] =
  polarity plane P (cell above sample-set median), w[2..3] = contrast
  plane C (deviation above 75th percentile). Both planes are exactly
  D4-covariant under `permPlane64(·, D4MAP8[k])` (MSB-first cell packing:
  cell i ↔ bit 63−i). C is exactly inversion-invariant. **P complements
  under inversion only away from median-plateau ties**: cells whose doubled
  value equals med2 encode 0 on both sides, so flat regions at the patch
  median (ubiquitous in pixel art) yield persistent non-complementing bits.
  Comparators MUST treat P-complement as approximate (§8.2).
* Extraction profile **PAPH5-E03** is frozen: luma `(54r+183g+19b+128)>>8`
  (rounded; complement-exact except knife-edge halves), foldMatte
  (≥98 % opaque, ≥50 % majority 4-bit border key, flood tol 24,
  2 %–90 % area → alpha-fold + F_MATTE), divideUpscale (constant k×k
  blocks → shrink + F_UPSCALED), RGBA5551 palette, FAST_T 18, NMS 4,
  pyramid ladder ×10/13.
* Tier-2 record order is content-derived and total (w lex, then x12, y12,
  level) — it is a serialization order only; comparators MUST NOT treat it
  as transform-stable (§7.1).

## 3. Comparator architecture

Three axes: **S** (structural: dct, local, region, topology, texture,
palette, spatial channels), **G** (geometric: multi-model SIMILARITY_D4
extraction), **D** (diversity). Channel values are chance-corrected margins
mapped through pcal LUTs; the verdict lattice (§7 of 5.0, ruling V-1 §7
below) combines them. Every channel abstains with a note rather than
guessing; abstention is never evidence.

Geometry keeps 5.0's defect rulings: **D-1** never rank-prune the eight
(sixteen with inversion) hypothesis families; **D-2** never pool
competitors across hypotheses; rotation/mirror labels derive from the
matched variant only.

## 4. §7 Local channel (004.2 objective, unchanged)

The local channel is 004.2's exact objective verbatim: maximum-cardinality
minimum-Hamming assignment over the thresholded bipartite graph of 64-bit
**P planes** at `hammingT`, sparse SSP solver with the dense Hungarian as
conformance oracle, burst discounting, and the frozen §10 lazy null family
(rot16/rot32/rot48/bitrev) applied per descriptor. The 64-bit width and
the null family are frozen 004.2 machinery; 005.1 does not widen them.

### 4.1 (§7.1) Bag cap selection — NEW, frozen

`LOCAL_CAP = 128`. The bag holds the top-128 records by
**(s8 descending, level ascending, Tier-2 record order)**. Rationale
(binding): selection keys MUST be invariant under every admitted transform.
Tier-2 record order sorts by descriptor words, which D4 permutes and
inversion complements; capping by record order therefore selects
non-corresponding subsets on the two sides and silently empties the bags
of twins. s8 is invariant under both.

## 5. §8 Structural channels

8.1 dct/region/texture/spatial search all eight D4 elements analytically
(sign-toggle + permutation algebra for DCT; grid permutation elsewhere)
and report `matchedK`. palette/topology are alignment-free; palette reports
`toneShift`; brightness reports a global `shift` (sign: A→B).

### 8.2 Local alignment predicate — NEW, frozen

Purpose: name the D4 element (and complement state, when admitted) under
which B's bag aligns onto A's, and fix the aligned view the §7 objective
then runs in. The predicate is deterministic and content-only:

For each admitted family f ∈ {direct, complemented-P} (admission: the
Tier-1 inversion pre-signal `invGate ≤ invGateT`, exactly as the geometry
stage admits its inverted hypothesis family) and each element k ∈ 0..7,
score

```
E(f,k) = Σ_j  ⌊(alignT − dminP(j)) · SCALE / burstY[j]⌋   over dminP(j) < alignT
```

where for each Y descriptor j: complement P if f, permute BOTH planes by
`D4MAP8[k]`; the candidate set is `{ i : dC(i) ≤ ALIGN_CGATE }` (contrast
plane gate, `ALIGN_CGATE = 8` of 64 bits, frozen constant); `dminP` is the
minimum polarity-plane distance over that set; `burstY` is the 004.2
within-bag burst at `hammingT`, computed once on the raw bag (within-bag
distances are invariant under permutation and complement).

Maximizer wins; ties break to the earlier candidate (direct before
complemented, then smaller k). `alignT = 24` (pcal field).

Rationale (binding, in order of discovery):
1. Raw edge counting lets map-invariant families of similar stamps drown
   the true element — nearest-per-descriptor is required.
2. A plain count saturates at n for several maps on D4-self-symmetric
   content (crosses, boxes, discs are near-fixed-points of every
   permutation) — margins are required.
3. Scoring the concatenated 128 bits lets C's inversion-invariance flood
   the direct family with half-matching candidates — C must GATE identity,
   P alone must carry the margin.
4. Plateau-heavy descriptors match each other promiscuously in raw P
   regardless of inversion (a structural direct-family attractor that no
   threshold fixes, because the median-split encoding normalizes plateau
   share away) — but they are exactly the high-burst population, so burst
   weighting (004.2's own anti-echo measure) crushes the promiscuous mass
   while genuine low-burst twins keep their margins.

The chosen view feeds §7 unchanged; `alignedK`, `alignedInverted`, and the
winning score are reported.

## 6. §15 Geometry

Hough (scale-ladder ×10/13, 25 bins, Q16; 64×64 translation cells,
soft corner votes), fitST closed-form similarity fit, residual gating at
`geoTol`, multi-model rounds with soft exclusion (`exclRadius`), Gauss-
Newton phase refinement on the two largest pools, gnControl permutation
control, tier-linked reversal.

### 15.6 Independent evidence — direction-free (amended)

`indep` caps contributions **jointly on both sides**: per A-tag ≤ 3, per
B-tag ≤ 3, per A 4×4 position cell ≤ 4, per B cell ≤ 4, greedily over a
per-pair swap-invariant order (conf desc, d1 asc, then the unordered pair
of packed positions). Both sides' caps are required because each side's
divTag clustering partitions its own keypoint set; single-sided caps yield
direction-dependent counts. `reverseModel` carries the canonical `indep`
(the definition is direction-free; carrying additionally guarantees
field-exactness under §9).

## 7. Verdict lattice

Verdicts: Identical / Copy / Related / Suspected / Distinct / Indeterminate,
plus `evidenceClass` and `assetRisk`. Ruling **V-1** (frozen): when
repetition is extreme (`repExtremeAt`) and independent evidence is thin
(< thresholds[7]), the R2 cap holds the verdict at Suspected **unless**
geometry certifies through the solo-inlier path — the exact-tiling
regression is the canonical witness and lives in the conformance suite as
"lattice unit: paths and the R2 ruling V-1".

## 8. Calibration (PCAL container 3, comparator 51)

Canonical little-endian encoding; SHA-256 identity; a profile that fails
validation never computes (5.0 §24.3, §36). Integer fields, in encoding
order: hammingT, confidenceAt, **alignT**, coarseGateT, regionK, regionT,
matchH, matchM, ratioNum, ratioDen, geoTol, geoMinCorr, geoConfAt,
geoSoloInliers, minModelInliers, maxModels, exclRadius, houghCap,
screenCoarseT, screenCoarseFloor, screenRegionFloor, screenSketchFloor,
dominantAt, repExtremeAt, minSecondaries, workBudget, invGateT; then
thresholds[10], weights[7], nine LUTs. `CAL-051-PROVISIONAL` ships with
the reference; §24.4 production calibration on a labelled corpus is owed
and blocks any non-provisional profile.

## 9. Symmetry contract

`compare(a,b)` and `compare(b,a)` MUST map field-exactly onto each other:
the implementation canonicalizes by lexicographic Tier-1 bytes, computes
once, and `swapView` remaps roles — profile ids, content tags, coverage,
brightness/toneShift negation, matchedK/alignedK through `D4INV`, pair
mirroring, model reversal (exact refit; inliers and indep carried), and
**side names inside abstention notes** ("side A"/"side B" swap; "both
sides" is fixed). Any field not remapped here MUST be symmetric by
construction.

## 10. Indeterminate taxonomy

CORRUPT (CRC, tier linkage, reserved bits), WIRE_UNSUPPORTED (version),
PROFILE_MISMATCH (extraction profile ids differ). Indeterminate reports
still carry the screen and identity fast-path fields where computable.
Tier-2 absence is NOT indeterminate: geometry and local abstain with notes
("tier 2 absent on side A/B/both sides", caller roles) and the structural
axis still speaks.

## 11. Work budget

`budget.n` counts descriptor-pair evaluations (alignment predicate, local
edges, correspondence). On exhaustion the geometry loop stops admitting new
hypotheses and marks `degraded: true`; the verdict is computed from what
was measured — budget exhaustion never fabricates Indeterminate.

## 12. Conformance suite and adversarial fixtures

`test/comparator.test.cjs` (19), `test/wire.test.cjs` (10),
`test/assignment.test.cjs` (property + conformance) are normative.
Fixture guidance (binding on suite authors — each of these silently
defeated an earlier build):

* **Matte-foldable fixtures**: a uniform background on a mostly-opaque
  image is a matte by E03's definition; keypoints then starve. Backgrounds
  MUST break the border-majority test (e.g. a 3-tone micro-pattern with
  distinct 4-bit keys, luma spread below FAST_T).
* **D4-closed bags**: crosses/boxes/discs alone make the strong-descriptor
  multiset closed under D4; alignment then lawfully ties. Fixtures MUST
  carry orientation-locked mass (same-orientation wedges/hooks).
* **Complement-closed bags**: identical shapes drawn in both polarities
  make direct and complemented views tie under inversion. Marks MUST be
  single-polarity where the inversion tests bite.
* Fixtures MUST exercise multiple dimensions per generator (the foldMatte
  area window and keypoint budgets are dimension-dependent).

## 13. Performance (reference, informative)

JS reference on the build container: hash ≈ 95 ms per 150×110 image,
compare ≈ 117 ms (dominated by the 16-view §8.2 scan and the local
assignments). Native targets inherit the algorithmic frozen surface only.

## 14. Open items

1. Golden vectors (`docs/golden/`) — cut after this freeze, from the
   reference, covering: identity, all 7 forward D4 elements, inversion,
   D4+inversion, tone shift, 2×/3× upscale, small/large paste, structural-
   only, both Indeterminate CORRUPT variants.
2. §24.4 production calibration corpus and a non-provisional pcal.
3. Rust/WASM port under `pixagram-blockchain/paph-js` packaging (4.1
   coexists: containers 2 vs 3 are disjoint).
