# IMPL-004 — v4 implementation status (through milestone M3)

Companion to PAPH-SPEC-004.  This file exists so nobody mistakes the current
drop for the finished comparator: it says exactly which spec sections are
live, which are scaffolded, and which are still v3 behaviour.

## Landed — M1 foundations

```text
sha256.rs       SHA-256 by hand + hash_profile_id            §7      FIPS vectors
calibration.rs  PCAL artefact: encode/decode/validate/id,    §8, App B/C
                monotone LUT eval, CAL-001-PROVISIONAL
assignment.rs   deterministic max-cardinality min-cost        §10.2, App A
                assignment; exhaustive cross-check ≤ 7×7
nulls.rs        LN {rot16,rot32,rot48,bitrev},                §9, App D
                GN shifts {n/2,n/3,n/5,2n/3} + reversal,
                weighted-correspondence permutations
coverage.rs     g×g occupancy, coverage, bbox,                §11
                4-connected concentration (two-pass, min-label)
```

## Landed — M2 local channel + limits + golden vectors

```text
local_v4.rs     the §10 rebuild: assignment matcher           §9.2, §9.5, §10
                (cost = distance only), LN family with MAX
                aggregation — THE verdict-breaking flip —
                burst weighting and Lift arithmetic verbatim
                from v3, diversity (§10.4) with modulation
                LUT, matched-anchor coverage per side (§10.3),
                Proportion demoted to diagnostics
wire.rs         hash_checked + MAX_WIDTH/HEIGHT/PIXELS —      §16
                profiles may lower, never raise; errors map
                to Indeterminate(LIMIT)
golden.rs       docs/golden/GOLDEN-004.json emitted BY the    §20
                reference (paphcli mode 'G'); a test asserts
                the checked-in file is byte-identical to the
                code's output
```

CAL-001-PROVISIONAL id: `30d061eae148b18b` (174 B).  The id moved during M2
when Appendix C was corrected: the diversity table is now the NEUTRAL constant
(a multiplier's no-op), not identity (a mapping's no-op) — a latent spec bug
caught by the M2 test suite before any JS existed to inherit it.

## Landed — M3 full v4 verdict path

```text
multimodel.rs   §12.2 weighted correspondences: Corr4         §9.3, §12.2,
                carries (d1, conf), conf = 1+idiv((d2−d1)·63, §12.3, §13
                max(d2,1)) with d2 = min of both sides'
                second-best; weighted Hough (votes += conf,
                duplicated across soft bins; minimum-peak
                floor on MEMBER COUNT ≥ 3); extract_from_pools
                shared by measurement and control; gn_control
                runs every GN member through the FULL
                multi-model procedure, per-pool instantiation,
                degenerate → empty pool (never unpermuted)
lattice.rs      §14 six-state lattice: v3's base shape with
                profile parameters, plus R1 (corroboration,
                min_secondaries), R2 (repetition: diversity <
                rep_extreme_at without geo ≥ GEO_WEAK caps
                Copy → Suspected), R3 (geo-solo needs
                topology ∈ {2,3,4}), R4 (struct-solo needs
                min-side coverage ≥ coverage_floor); fired
                rules append their names to basis
v4.rs           canonical argument order (P4) with swap-back
                of directional outputs; local + geometric
                evidence through their calibration LUTs; the
                v4 verdict IS the report's verdict; the full
                v3 Verdict rides along for M5's comparison
compare.rs      pub(crate) on vote_cells / fit_similarity /
                count_inliers — VISIBILITY ONLY (JS suite
                still 39/39, wires unchanged)
```

The v3 single-model geometric channel, greedy local matcher, MIN-aggregated
rotation null, and five-state lattice all remain exactly as shipped inside
`compare()` — comparator 3 is frozen; comparator 4 is `compare_v4`.

## Landed — M4 JavaScript port

```text
src/paph4.cjs   the full comparator in JavaScript: sha256 +     §7–§16
                hash-profile id, PCAL encode/decode/validate/
                id + LUT eval, Hungarian assignment, LN/GN
                nulls, coverage, local_v4, weighted
                correspondences + weighted Hough + two-pool
                extraction + gn_control + topology, lattice
                R1–R4, compare_v4 with canonical order and
                the live Indeterminate paths.  HAM_MAX and
                the Lowe ratio are DUPLICATED here exactly as
                the Rust port duplicates them (§12.2 pin).
src/paph4.js    ESM wrapper; package export "./v4".  index.js
                and index.cjs are deliberately UNTOUCHED —
                v4 is not the blessed API until M5 calibrates
                it against the §19 corpus.
test/v4.cjs     the port held to EVERY section of              §20
                docs/golden/GOLDEN-004.json (the vectors were
                consumed first, the port written second) plus
                end-to-end verdict checks — 50 checks.
test/parity4.mjs identical wires through the native reference
                (paphcli mode 'V', new to_json_v4) and the
                port; full-report equality field for field —
                verdict, basis, rule names, every evidence
                number, every model, every coverage cell.
src/paph3.cjs   _internal additions — VISIBILITY ONLY (suite
                still 39/39, wires unchanged).
```

## In progress — M5 calibration

```text
demo/paph4-calibration.html                                     §19
                the calibration bench: corpus intake (§19.1
                categories), live §19.3 operating point —
                false certifications on E∪F∪G, §9.5 losses
                vs comparator 3, B and C∪D recall with v3
                alongside — per-category verdict matrix,
                margin/diversity strips with candidate LUTs
                overlaid, PCAL load/edit/export with SHA-256
                identity.  Threshold/weight/guard/LUT edits
                re-verdict the corpus instantly from stored
                margins; measurement-field edits mark pairs
                stale until re-measured from stored wires.
demo/cal-core.cjs
                the pure logic (snapshot, relattice, metrics),
                requireable from node; test/v4.cjs holds it to
                the invariant the bench rests on: verdict from
                snapshot ≡ verdict from the full comparator.
both engines    reports now carry geoMeasurable + the pre-LUT
                geoRaw/geoCtl/geoMargin (§19.4 needs raw
                margins); parity4 holds them equal.
```

## Landed — M6 (2026-08-19): SPEC-004.1, comparator 41

```text
A1 weak signal  §12.3 extraction-first with weak fallback; geo_weak_inliers
                reported; GN control runs the identical measurement; golden
                weak_geometry pins pools 9/0 → measure 5, ctl 4 (gn:fifth)
A2 sparse       Appendix A on the edge-induced subgraph (assign_sparse /
                assignSparse); local channel wired through it under 41 only;
                golden assignment_sparse (6 cases, cost/cardinality ≡ full)
A3 container 2  nine tables, canonical order; (1,4) and (2,41) decode, all
                else refused; cal003() = CAL-003-PROPOSED, 270 B, id
                75319777e4ff…0247a422 IDENTICAL in Rust, JS, and the
                proposal emitter; cal001 bytes and id untouched
A4 screen       screen_v41/screenV41 + screen_json; pass ⇔ max pool ≥
                geo_min_corr; UNSCREENED, never Unrelated
guards          compare_v4 refuses comparator-41 profiles and vice versa,
                both engines, tested both directions
suites          Rust 47/47 · JS test.cjs 39/39 · v4.cjs 81/81 ·
                parity4.mjs 12/12 (both comparators, field-for-field) ·
                playground.mjs 21/21 (headless drive-through, jsdom)
bench (4x)      demo/paph4x.html — the evidence bench remastered onto
                comparator 41 in the Pixagram design system: screen pools,
                the lattice, the model drawn with recomputed inlier
                membership, channels before/after their tables, the nine
                curves, and an attack sweep across comparators 4 and 41.
                Generated by tools/build-paph4x.mjs from demo/bench4x/ so
                the inlined engines cannot drift; test/bench4x.mjs (16)
                drives it headlessly.
bench           demo/paph41-playground.html — container-2 console with
                the nine tables as draggable curves over the corpus's
                own value ticks, certified and at-review counted
                separately, pair inspector with the post-table channel
                table and the stage-1 screen, and a shared-asset lab
                that reproduces ANALYSIS-002 in the page.  Tuning runs
                through calCore.relattice41, which v4.cjs proves equal
                to compareV41; measurement-side edits raise a stale
                flag rather than showing stale verdicts.
corpus (real)   fc 0/0; neg S/R/U 9/402/34 exact; negStr max 2587 exact;
                B 95.5% cert / 100% at-review; CD 55.6% cert / 81.5%
                at-review; vs comparator 4: 1 demoted to review, 0 below.
                The proposal's 100%/81.5% were review-or-better rates —
                the evaluator counted Suspected as recall; the engine
                reproduces its numbers exactly on that definition.
```

## Released

```text
4.1.0           published as @pixagram/paph-js (was @pixagram/paph3).
                The package version tracks the COMPARATOR; the wire stays
                v3 and its bytes are unchanged, so 3.x fingerprints read
                back identically.  Source: pixagram-blockchain/paph-js.
                Subpaths: ./wire, ./comparator, ./calibration (./js,
                ./v41, ./v4 kept).  Comparator 41 + CAL-003-PROPOSED are
                the default judgement; CAL-003 keeps its -PROPOSED
                suffix until M7.
```

## Still pending

```text
M7 VALIDATION   SPEC-004.1 on real moderation pairs with §19.3 split
                discipline: held-out test split, real A–D sourcing, the
                E1×E2 re-render policy decided by a human, §22
                adversarial keypoint-disruption pairs.  CAL-003 stays
                -PROPOSED until this gate.
SOLO-ARM        docs/ANALYSIS-002: the development corpus has ZERO
                negatives with an accepted model, so it cannot price
                the geo-solo floor at any value.  Constructed
                shared-asset negatives (one common tile in two
                unrelated works) certify as Copy — 27 of 72, all
                basis=geometric topology-2, from a 96px asset upward.
                Neither a coverage floor nor a topology-split inlier
                floor separates them from genuine class-2 positives
                (bands overlap 10–25 vs 11–41).  Needs a HUMAN policy
                call — is a shared licensed asset a negative? — and
                real shared-asset pairs in M7, not a threshold move.
CAL-002         a LABELLED corpus (§19.2 sourcing: moderation
                reports for A–D, the SDXL converter for E,
                published tilesets for F/G, §22 adversarial
                pairs for I), then breakpoints per §19.4 and
                the published per-category table.  The §9.5
                recall check is the acceptance gate for the
                LN-max flip, and the corpus decides whether
                v4 becomes the blessed package API.  Split
                discipline (§19.3) is procedural — the bench
                counts, the operator holds the test split.
CONTRADICTION   reserved Indeterminate reason, still unused
```
