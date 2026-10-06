# Changelog

## 5.3.0 — 2026-08-28 — the speed release: same bytes, same reports, 4× the pace

Wire 5, extraction PAPH5-E03, comparator 51, CAL-051 — all unchanged; every
golden tier sha-256 and every report field is bit-identical to 5.1.0, verified
after each optimization batch. What changed is time:

hash (settled p50, ±20% container jitter documented via percentiles):
  736×352  345.6 → 83.7 ms   512×384  273.8 → 80.0 ms
  249×287  156.3 → 48.7 ms   150×110   45.1 → 21.8 ms
compare 736-pair: 49.3 → 36.8 ms p50.

Extraction: full-image lum sorts became 256-bin counting passes; keypoint
selection became a lazy-greedy max-heap (every score factor is provably
non-increasing as the selection grows, so cached scores are valid bounds;
the heap's (bound desc, index asc) order with an equality rule reproduces
the original first-index argmax exactly); pyramid levels read two source
integral images; topologySection runs on inlined palette LUTs; indexImage
uses direct 65536-entry tables (the packed key is 16-bit by construction).
GC share fell from 37% of runtime to 2%.

Comparator: the 004.2 Hungarian now solves on flat Float64/Int32 typed
arrays with the matrix materialized once (all values ≤ 2^30 stay exact),
identical strict-< tie-breaks; correspond() inlines the 128-bit descriptor
distance over hoisted SoA locals. The remaining compare cost is the §8.2
predicate legitimately running the exact assignment per D4/inversion
hypothesis — an algorithmic floor the spec freezes on purpose.


## 5.1.0 — 2026-08-28 — comparator 51: three axes, one exact objective

Version tracks the comparator; 5.0 was a paper release (the specification and
its rulings) and 5.1 is the first shipped build of it, so the package version
skips from 4.1.0 to **5.1.0**.  Spec: `docs/SPEC-005.1.md`.

**Wire 5, extraction PAPH5-E03.**  Tier 1 grows to 2560 fixed bytes with an
explicit section table, D4/inversion-invariant coarse folds, a 32-entry
sketch, and 8x8 region codes; Tier 2 stays 32 + 32n with 128-bit two-plane
descriptors (P structure, C color), n <= 512.  One D4 numbering everywhere.

**Comparator 51.**  The 5.0 three-axis architecture — structural channels,
staged geometry, diversity — with the 004.2 fast-exact-compare contract kept
verbatim in the LOCAL channel: maximum-cardinality minimum-Hamming assignment,
sparse Hungarian with the dense solver as conformance oracle, lazy null
transforms.  Geometry is SIMILARITY_D4 with all eight hypotheses always
evaluated plus an eight-strong inverted family behind the invGate; independent
evidence is direction-free (joint per-side caps), verdicts are
swap-symmetric, and repetition demotes to Suspected under ruling R2/V-1.

**The §8.2 alignment predicate** (which D4 element and polarity the local bag
agrees on) is new and earned its shape point by point: candidate filtering by
the inversion-invariant C-plane gate, scoring by margin sums on the P-plane
only, margins weighted down by 004.2 burst mass so median-plateau descriptors
cannot vote, and a top-128 bag cap keyed on (s8, level) so both sides keep
*corresponding* elements under any D4 element and under inversion.  Each of
those four clauses is pinned by a fixture that failed without it.

**Packaging.**
- `docs/golden/GOLDEN-051.json` — 13 golden cases (tier hashes plus the
  entire compare report, field for field) as the port handoff; guarded by
  `test/golden.test.cjs`.
- `index.cjs` / `index.js` / `index.d.ts` — dual CJS/ESM entry with typings
  checked against the runtime report shape.
- `dist/paph51.browser.js` (`npm run bundle`) — dependency-free browser
  bundle, byte-conformant with the source build.
- `demo/playground.html` — in-browser playground: load or synthesize a pair,
  derive B from A (D4, inversion, tone, upscale, crop-paste, noise), read the
  full verdict.
- `tools/png.cjs` — dependency-free PNG codec for tooling (all filters,
  indexed + tRNS); `tools/calibrate.cjs` — corpus calibration harness with
  the SPEC-005.1 §24.4 gates (>= 24 families, >= 60 images, >= 60 positive
  pairs) and a provisional guard; ships `CAL-051-PROVISIONAL` until a real
  corpus passes them.
- WASM/Rust engine intentionally absent this release; the golden vectors are
  the contract it will be held to.

## 4.1.0 — 2026-08-19 — `@pixagram/paph-js`: 4.1, and only 4.1

The package is renamed from `@pixagram/paph3` to **`@pixagram/paph-js`**, its
version tracks the **comparator**, and everything that is not 4.1 has left the
box. Source: [pixagram-blockchain/paph-js](https://github.com/pixagram-blockchain/paph-js).

**One comparator.** `compareV4` and `cal001()` are gone from the package. A
container-1 artefact still *decodes* — `profileDecode` reads it, so an old
verdict's provenance can be inspected and argued about — but `compare` returns
`Indeterminate · PROFILE_UNSUPPORTED` rather than computing with it. The Rust
reference keeps comparator 4 in its test tree, because the golden vectors and the
frozen local-channel path are what prove 41 correct; nothing published computes
with it.

**Plain names.** `hash`, `compare`, `screen`, `cal` — no version suffixes, since
there is only one of each. `src/paph3.cjs` → `src/wire.cjs` (global `paphWire`),
`src/paph4.cjs` → `src/paph-js.cjs` (global `paphjs`), `wasm/paph3.wasm` →
`wasm/paph.wasm`. Subpaths are `./wire`, `./comparator`, `./wasm`,
`./calibration`. `cal-core` loses its duplicated comparator-4 trio: one
`makeSnapshot`, one `relattice`, one `metrics`.

**Two pages, both 4.1.** `demo/paph4x.html` (the evidence bench) and
`demo/paph-js-console.html` (the calibration console). The v3 playground and the
v4 calibration bench are removed, and the bench's comparator-4 column is replaced
by the stage-1 screen — the comparison that still tells you something. SPEC-002
(the v2 algorithms this family replaced) leaves the payload; SPEC-003 stays,
because it specifies the wire 4.1 hashes.

Suites, renamed to say what they cover: `test/wire.cjs` (39),
`test/comparator.cjs` (82), `test/console.mjs` (27), `test/bench.mjs` (19),
`test/parity-wire.mjs` (25), `test/parity-comparator.mjs` (6).

Migrating from `@pixagram/paph3@3.1.0`:

```diff
-import { hashChecked, compareV41, cal003 } from '@pixagram/paph3';
-const r = compareV41(a.t1, a.t2, b.t1, b.t2, {}, cal003());
+import { hash, compare, cal } from '@pixagram/paph-js';
+const r = compare(a.t1, a.t2, b.t1, b.t2, {}, cal());
```

## 3.1.0 — 2026-08-19 — the comparator ships

The package now exposes the comparator layer from its main entry, not only
from a subpath: `compareV41`, `compareV4`, `screenV41`, `hashChecked`,
`cal003`, `cal001` and the profile codec, with full type declarations.  The
v3 wire is untouched — same 3952-byte Tier 1, same parity — so this is a
minor version, and `@pixagram/paph-js/js` still yields the bare v3 engine.

New: `demo/paph41-playground.html`, a calibration console for comparator 41
with a **worked example** built in — press one button and eleven generated
works arrive with every relationship pre-labelled, or drop a folder or a
`.zip` of your own.  `@pixagram/paph-js/calibration` exposes the tuning loop the
console runs on.  `docs/calibration/*.pcal` ships both profiles as bytes.
`npm run verify` runs the three suites that need no build.

## M6 — 2026-08-19 — SPEC-004.1 lands: comparator 41

Both engines implement Amendment 4.1 behind the new comparator value; the
comparator-4 path is frozen and its conformance surface, `to_json_v4`, and
the CAL-001 bytes are untouched.  Weak-signal geometry (A1) with
`geo_weak_inliers` in the report; assignment on the edge-induced subgraph
(A2); container-2 profiles with nine per-channel tables (A3) and
`CAL-003-PROPOSED` byte-identical across Rust, JS, and the proposal emitter;
the stage-1 screen (A4).  GOLDEN-004.json regenerated at milestone M6 with
`assignment_sparse`, `weak_geometry`, and `profile_cal003`; `paphcli` gains
mode `W`; parity holds field-for-field on both comparators (12/12).  Corpus
revalidation with the real engine reproduces the proposal's projections
exactly on the evaluator's review-or-better definition (fc 0/0, negatives
9/402/34, B 100% at-review, CD 81.5% at-review) and improves the demotion
ledger against comparator 4 to one-to-review, zero-below.  CAL-003 remains
-PROPOSED pending M7 validation on real pairs.

Bench: `demo/paph41-playground.html` drives comparator 41 in the browser —
load works, measure every pair once, then tune the container-2 profile with
the nine calibration tables as draggable curves and watch the corpus
re-decide instantly.  `calCore` gains `makeSnapshot41`, `relattice41` and
`metrics41`; `test/v4.cjs` proves the tuning loop equals the comparator, and
`test/playground.mjs` drives the whole page headlessly (21 checks, skipped
when jsdom is absent).

## Unreleased — v4 groundwork (comparator 4, wire unchanged)

- `docs/SPEC-004-paph-v4.md`: remastered specification — calibrated
  multi-evidence comparator on the unchanged v3 wire.  Accurate v3 baseline,
  structured PRNG-free null families with MAX aggregation, calibration as a
  canonical PCAL data artefact (SHA-256 identity), exact deterministic
  assignment (Appendix A), spatial support, multi-model geometry with
  per-model mirror, copy topology, six-state verdict with Indeterminate,
  resource limits, retrieval separation, corpus plan, milestones M1–M5.
- Rust M1 modules: `sha256`, `calibration`, `assignment`, `nulls`,
  `coverage`, `multimodel`, `v4::compare_v4`.
- Rust M2: `local_v4` — the §10 local-channel rebuild (assignment matcher,
  LN family with MAX aggregation per §9.5, diversity + modulation LUT,
  matched-anchor coverage; Proportion demoted to diagnostics);
  `wire::hash_checked` with the §16 limits; golden vectors emitted by the
  reference into `docs/golden/GOLDEN-004-M2.json` (paphcli mode `G`), with a
  conformance test pinning the checked-in file to the code's output.
- CAL-001-PROVISIONAL id `30d061eae148b18b` (174 B).  Appendix C corrected
  during M2: the diversity modulation table ships NEUTRAL (constant SCALE),
  not identity — identity is a multiplier of D/SCALE, which silently taxed
  every evidence value; caught by the M2 tests.
- SPEC-004.1 proposal (docs/SPEC-004.1-proposal.md), awaiting decision:
  comparator 41 with (A1) the §12.3 weak-signal geometry path, (A2)
  Appendix A on the edge-induced subgraph (×14.3, tie cases comparator-
  versioned), (A3) container-2 profiles with nine per-channel calibration
  tables, (A4) the normative §17 stage-1 screen; lattice shapes, weights,
  and the Tier-1 wire deliberately untouched.  CAL-003-PROPOSED (270 B,
  id 75319777e4ff7fe6…) derives every value from measured quantiles;
  projected: C∪D recall 81.5 % at ≥ Suspected, review 8+9, zero false
  certifications, certification predominantly geometric by design.
- M5: field forensics (docs/ANALYSIS-001-field-forensics.md).  Full 79-field
  dataset over all 496 pairs kept (JSON + CSV).  Findings: geometry is the
  identity channel (0 false margin across 445 same-generator negatives);
  `runs` is a style carrier (median 9066 on unrelated pairs); `shape` is the
  strongest structural channel where geometry is absent; topology and the
  dct null both mislead in specific regions; the §12.3 first-model floor
  discards real 5–7-inlier signal — the relaxed-floor experiment lifts
  geometry AUC 0.892 → 0.951 and projected C∪D recall 63 % → 81.5 % with the
  GN control still clean (1 borderline leak in 445), a comparator-versioned
  amendment candidate.  Compare-time is 93 % assignment matcher; the
  sparse-subgraph Hungarian is ×14.3 with equal cardinality and cost but
  needs an Appendix A amendment for tie determinism.  A 3.2 ms
  correspond-only screen keeps 50/51 positives and drops 43 % of negatives.
- M5: first corpus run.  A 496-pair corpus (32 works, 10 families; §19.1
  labels inferred and editable) through comparator 4 under CAL-001: zero
  false certifications across 445 same-generator/template negatives — the
  geometric margin is 0 on every negative, the GN-through-multimodel control
  holding exactly as designed — with the whole same-generator band landing
  in Suspected (429 review items).  CAL-002-DRAFT (id 96a8d6c3eff953a9…)
  answers with a gentle lutLocal squash of the same-generator margin band
  plus a corpus-justified geo-solo inlier floor of 11: review load 443 → 17,
  §9.5 losses 4 → 3 (all remaining ≥ Suspected), B recall 100 % both
  comparators.  The bench ledger gains a per-row relabel control.
- M5 (in progress): the calibration bench.  `demo/paph4-calibration.html` —
  corpus intake with §19.1 category labelling, derive-a-suspect transforms,
  a live §19.3 operating-point scoreboard (false certifications on E∪F∪G,
  §9.5 losses against comparator 3, B and C∪D recall v3-vs-v4 side by side,
  review load), per-category verdict matrix, margin/diversity distribution
  strips with the candidate LUTs overlaid, threshold rules drawn live, PCAL
  load/edit/encode with SHA-256 identity, and corpus export that carries the
  wires so an imported corpus can be re-measured.  `demo/cal-core.cjs` holds
  the pure logic; test/v4.cjs proves its one invariant — a verdict
  recomputed from a stored snapshot equals the full comparator's — and that
  the §9.5 gate fires when a candidate drops a v3-certified copy (54 checks
  now).  Reports on both engines expose `geoMeasurable`/`geoRaw`/`geoCtl`/
  `geoMargin` (pre-LUT) for §19.4 table work; parity4 holds them equal.
- JS M4: the v4 comparator ported to JavaScript (`src/paph4.cjs` + ESM
  wrapper, exported as `@pixagram/paph-js/v4`).  The golden vectors were
  consumed FIRST: `test/v4.cjs` holds the port to every section of
  `docs/golden/GOLDEN-004.json` (50 checks), and `test/parity4.mjs` feeds
  identical wires through the native Rust reference (`paphcli` mode `V`,
  new `to_json_v4`) and the port, requiring full-report equality — verdict,
  basis, rule firings, every evidence number, every model, every coverage
  cell.  `paph3.cjs` changes are `_internal` visibility only (suite still
  39/39).  HAM_MAX and the Lowe ratio are deliberately duplicated in the
  port, as in Rust.  Entry points (`index.js`/`index.cjs`) deliberately
  untouched: v4 is not the blessed API until M5 calibrates it.
- Rust M3: the full v4 verdict path.  `multimodel` gains weighted
  correspondences (`Corr4`, Lowe-margin confidence, d2 = min of both sides)
  and the weighted Hough (votes += conf duplicated across soft bins,
  minimum-peak floor on member count); the GN null family now runs through
  the complete multi-model extraction with per-pool instantiation
  (degenerate → empty pool, never unpermuted).  New `lattice` module: the
  six-state v4 lattice with rules R1–R4 live, parameters from the profile,
  fired rules named in `basis`.  `compare_v4` canonicalises argument order
  (P4), reports the v4 verdict, and carries the full v3 Verdict alongside.
  Golden vectors extended (conf table, five lattice cases) and renamed to
  `docs/golden/GOLDEN-004.json`.
- 40 tests total.  v3 behaviour untouched (JS suite still 39/39);
  `compare.rs` changes are pub(crate) visibility only.
- Status tracking in `docs/IMPL-004-status.md`.

## 3.0.0 — 18 August 2026

First release of the merged detector. v3 unifies the two v2 algorithms — the
bag-of-features hash and the keypoint matcher — behind one normalised front end
and one wire, and adds a second implementation so the wire can be checked.

### The reason for the version bump

v2 shipped two detectors that could not be compared: they disagreed about what
an image *was* before either of them looked at it. Three of the seven conflicts
listed in SPEC-002 §22 came from that alone. v3 has one front end — matte fold,
upscale division, palette indexing — and both halves consume its output.

### Added

- **Two engines.** JavaScript, and Rust compiled to WebAssembly. Byte-identical
  Tier-1 and Tier-2 wires; identical verdicts; identical per-channel readings.
- **A geometric channel with a null.** v2's keypoint stage returned a bare
  inlier count. It now has a control — permute which keypoint's *geometry* each
  correspondence pairs with, keeping the match set intact — so it can be
  reasoned about beside the structural channels rather than bolted on.
- **The verdict lattice.** Structure and geometry on two axes, never averaged.
- **Tier 2**, 32 + 40n B, holding up to 256 integer keypoint records.
- **A 32-keypoint sketch inside Tier 1**, so an index that stores only Tier 1
  can still run a weak geometric check rather than none.
- **A silhouette channel**, separate from the interior descriptors. v2's
  keypoint half flattened alpha to black and keyed on the outline without
  meaning to.
- **An absolute-colour digest** — reporting only, and the test suite asserts
  that zeroing it cannot move a verdict.
- **Both RAG endpoint encodings** on the wire. Quantile survives a rebuilt
  palette; rank does not, and that asymmetry is itself a finding.
- **A section table and CRC-32 on the wire.** v2 used compiled offset constants
  and an XOR checksum that cannot see a byte transposition.
- `Config` / `Paph` classes, frozen configs, `.with()` derivation, validation.
- A self-contained browser evidence bench (`demo/`).

### Changed

- Every compare-time decision moved out of the hash. v2 baked the scoring rule,
  the collision radius and the endpoint encoding into the wire, so getting one
  wrong meant re-hashing the corpus to find out.
- Pyramid levels indexed by `max(w, h)` rather than by width. Indexing by width
  gave a 736×352 work seven scales and a 119×193 work one.
- `LEVEL_MIN` 96 → 52. The old floor was inherited from a 119–736 px corpus and
  starved small pixel art; a 64 px sprite produced zero keypoints.
- `KP_MARGIN` → 24. A rotated pattern point reaches `ceil(15·√2)` from the
  keypoint plus the box radius; at 18 the windows clipped and three of 3588
  mirrored descriptors disagreed.
- Keypoint budget distributed over an 8×8 spatial grid before capping. Taking
  the globally strongest 256 lets a busy host crowd out every keypoint of a
  pasted figure — silencing exactly the case the stage exists for.
- Sixteen DCT hypotheses instead of eight: the eight of D4, each with and
  without a global sign flip, since inversion negates every AC coefficient.
- Structural certification now requires a corroboration floor. Two flat canvases
  certified as `Copy` through the shape channel alone until it existed.
- Argument order canonicalised once inside `compare` rather than per-site.

### Fixed

Determinism defects, all invisible from inside JavaScript and all now corrected
in both engines:

- The BRIEF pattern's LCG multiplied by 1103515245 as a double; the product
  reaches 2.4 × 10¹⁸, so the low bits were rounding noise. Now `Math.imul`.
- `(3 * M) >> 1` coerces to int32 before shifting. The Rust reproduces the wrap.
- `(sq * rx) >> 16` in the Hough vote reached ~10¹² and wrapped silently. Both
  engines now floor-divide exactly. This one changed results.
- The sparse-RAG key is a signed int32; the Rust matches with `i32` keys.
- Every trig, ray and DCT table frozen as integer literals. `Math.log2` removed
  from the header path and `Math.ceil` from `shapeGrid`. No float now appears
  anywhere in the wire path, and `npm run tables` enforces it.

Behavioural defects inherited from v2:

- **Inversion invariance never held end to end.** The palette quantile was "mass
  strictly darker", which under a luminance flip becomes `255 − q − ownMass` —
  every entry shifts by its own mass, so the complement fold could never fire.
  Measured: 0 of 128 regions collided on an inverted copy. Four changes make it
  exact, including placing transparent cells at the self-complementary midpoint
  of a doubled scale.
- Grid-approximate NMS replaced with a true Euclidean radius over a total order.
  A 2 px shift could change which of two nearby corners survived, in an
  algorithm whose entire premise is finding the same points twice.
- Pooled keypoints ranked by raw FAST score across resolutions; strength is now
  normalised by the level's own median before pooling.

### Performance

`canonical64`'s eight D4 variants are permutations of one multiset and now share
a single median instead of eight 64-element sorts — the dominant cost of the
whole hash. `isqrt` was O(√n) inside an O(n²) loop and was 49 ms of a 52 ms
compare. In the JavaScript engine the rotated BRIEF pattern is cached per sector,
the orientation disc is a flat offset table, `fingerprintOf` uses a preallocated
scratch instead of allocating per cell, and descriptors are packed into
eight-word lanes with the Hamming loop unrolled.

Hash of 512 × 384: **1937 ms → 400 ms** (JavaScript) → **139 ms** (WebAssembly).
Warm pairwise compare: **52 ms → 5.8 ms** → ~2 ms.

### Known gaps

Geometric inversion invariance is not free and is not implemented; the measured
Hamming distance between a descriptor and its inverted twin's complement is
129.9 of 256, which is chance. Thresholds derive from 16 works rather than from
moderation reports. Both are documented in the README and the implementation
notes.
