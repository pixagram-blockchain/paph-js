# IMPL-004 — v4 implementation status (through milestone M8)

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
src/paph-js.cjs the full comparator in JavaScript: sha256 +     §7–§16
                hash-profile id, PCAL encode/decode/validate/
                id + LUT eval, Hungarian assignment, LN/GN
                nulls, coverage, local_v4, weighted
                correspondences + weighted Hough + two-pool
                extraction + gn_control + topology, lattice
                R1–R4, compare_v4 with canonical order and
                the live Indeterminate paths.  HAM_MAX and
                the Lowe ratio are DUPLICATED here exactly as
                the Rust port duplicates them (§12.2 pin).
src/paph-js.js  ESM wrapper; package export "./comparator".  index.js
                and index.cjs are deliberately UNTOUCHED —
                v4 is not the blessed API until M5 calibrates
                it against the §19 corpus.
test/comparator.cjs
                the port held to EVERY section of              §20
                docs/golden/GOLDEN-004.json (the vectors were
                consumed first, the port written second) plus
                end-to-end verdict checks — 50 checks.
test/parity-comparator.mjs
                identical wires through the native reference
                (paphcli mode 'V', new to_json_v4) and the
                port; full-report equality field for field —
                verdict, basis, rule names, every evidence
                number, every model, every coverage cell.
src/wire.cjs    _internal additions — VISIBILITY ONLY (suite
                still 39/39, wires unchanged).
```

## In progress — M5 calibration

```text
demo/paph-js-console.html                                       §19
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
                requireable from node; test/comparator.cjs holds it to
                the invariant the bench rests on: verdict from
                snapshot ≡ verdict from the full comparator.
both engines    reports now carry geoMeasurable + the pre-LUT
                geoRaw/geoCtl/geoMargin (§19.4 needs raw
                margins); the parity suite holds them equal.
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
suites          Rust 47/47 · JS wire 39/39 · comparator 81/81 ·
                parity 12/12 (both comparators, field-for-field) ·
                console 21/21 (headless drive-through, jsdom)
bench (4x)      demo/paph4x.html — the evidence bench remastered onto
                comparator 41 in the Pixagram design system: screen pools,
                the lattice, the model drawn with recomputed inlier
                membership, channels before/after their tables, the nine
                curves, and an attack sweep across comparators 4 and 41.
                Generated by tools/build-paph4x.mjs from demo/bench4x/ so
                the inlined engines cannot drift; test/bench4x.mjs (16)
                drives it headlessly.
console         demo/paph-js-console.html — container-2 console with
                the nine tables as draggable curves over the corpus's
                own value ticks, certified and at-review counted
                separately, pair inspector with the post-table channel
                table and the stage-1 screen, and a shared-asset lab
                that reproduces ANALYSIS-002 in the page.  Tuning runs
                through calCore.relattice, which the comparator suite proves equal
                to compareV41; measurement-side edits raise a stale
                flag rather than showing stale verdicts.
corpus (real)   fc 0/0; neg S/R/U 9/402/34 exact; negStr max 2587 exact;
                B 95.5% cert / 100% at-review; CD 55.6% cert / 81.5%
                at-review; vs comparator 4: 1 demoted to review, 0 below.
                The proposal's 100%/81.5% were review-or-better rates —
                the evaluator counted Suspected as recall; the engine
                reproduces its numbers exactly on that definition.
```

## Landed — M8 (2026-08-19): SPEC-004.2, comparator 42

```text
budget          KP_PER_LEVEL and the tier-2 cap raised 256 → 512.  The FORMAT
                does not move: the record count was already a u16 and the
                records are a fixed 40 bytes, so tier 2 is at most
                32 + 512×40 = 20512 B and a 256-keypoint wire still parses.
                The descriptor stays 256-bit — at a fixed byte budget,
                256-bit × 512 carries more SPATIAL evidence than 512-bit × 256.
§3 selection    quality score replacing strength+grid: 40 strength +
                25 spatial novelty + 20 scale novelty + 15 descriptor novelty,
                integer, greedy, ties to the lower index (= the stronger
                candidate under the pooled order), candidate pool bounded at
                want×4.  Descriptor novelty saturates at Hamming 16, so a
                near-duplicate of something already held scores zero on that
                term however strong it is.  The 4.1 selector is KEPT
                (select_grid / selectGrid), not approximated: a 4.1 wire is
                reproduced by running the code that made it.
§2 provenance   tier-1 flag F_KPQ (0x20) + tier-2 header byte 16 — both
                outside the CRC region, both 0 on every wire ever emitted, so
                no version bump and no re-hash to stay readable.  A mixed
                4.1/4.2 pair is COMPARED and FLAGGED (report.selection.mixed),
                never refused.
§4 matcher      ham_cut: exact early abort at max(a_d2, b_d2) — such a pair
                cannot become either side's first or second candidate and
                every downstream test is a strict <, so recall is untouched.
                Rust repacks [u32;8] → [u64;4] once at parse (4 POPCNTs, not
                8); JS keeps u32, identical results.  Absolute Lowe margin
                (d2 − d1 ≥ 6) beside the ratio, applied on BOTH sides or
                compare(A,B) and compare(B,A) diverge.  margin = 0 reproduces
                4.1's correspondence set pair for pair, asserted.
§5 vote         stack VoteCells [i32;24] and a fixed open-addressed integer
                table (Knuth multiply, linear probe) replace the HashMap and
                the per-correspondence Vec.  Soft scale kernel [24,64,24]/64;
                rotation and both translation axes keep Lowe's nearest-two
                duplication (votes DUPLICATED, never split).
§6 peak/model   vote weight = lowe_confidence × strength_compatibility
                (Q6, floored at ½); peak by explicit total order on
                (mass, members, confidence, key) so table layout cannot
                decide it; median squared residual per model; direct/mirror
                winner on (inliers, −median_err, conf_sum), ties → direct.
§7 consumption  soft exclusion neighbourhood scaled to the descriptor patch
                footprint at the keypoint's own level, so one physical
                structure is not decomposed into two models.  POOLS only —
                the correspondence lists are untouched, so measurement and
                control still start from identical evidence.
§8 diversity    D = 40 spatial + 25 scale + 20 model + 15 descriptor, through
                its OWN table (lut_geo_diversity, the tenth) multiplying the
                geometric evidence.  Deliberately not lut_diversity: that one
                modulates the local channel and reusing it would have moved
                the structural axis while claiming to change only geometry.
                Applies only where a model was accepted — the §A1 weak signal
                reached the margin without producing one.
§10 container 3 container-1/2 fixed block + 8 i32 + a tenth LUT.  (1,4),
                (2,41) and (3,42) decode; all else refused.  CAL-001 and
                CAL-003 encode to the SAME bytes and the SAME ids as before,
                asserted.  cal004() = CAL-004-PROPOSED, 320 B, id
                91b545f801f5a095…3c03d078, identical in both engines.
unchanged       the lattice rule for rule; the GN family (five permutations,
                identical measurement, MAX); Proportion and Gate still out of
                the decision path; A1/A2/A3/A4; tier 1, all 3952 bytes.
                EVERY DECISION CONSTANT IN CAL-004 IS CAL-003'S.
golden          six new sections — profile_cal004, ham_cut (72), 
                strength_compat (8), vote_cells_42 (4), select_quality (3),
                geometry_42 (full extraction with residuals, vote mass, GN
                member and all four diversity components).  paphcli mode 'X'.
suites          Rust 64/64 · wire 39/39 · comparator 101/101 ·
                parity-wire 25/25 · parity-comparator 13/13 (comparators 42
                AND 41, field-for-field) · console 28/28 · bench 20/20
M9 perf         two output-identical passes, licensed by the byte-for-byte
                golden assertion: comparator 19.7 -> 11.5 ms on a self-compare
                (epoch vote table + live-slot peak + one Scratch per pair +
                linear §7 consumption + full-Hamming matcher, the exact early
                abort having MEASURED slower than not aborting); hash
                111 -> 91 ms native, 152 -> 122 ms wasm (flat 16-bit palette
                tables, canonical64 as bit permutations of one u64 with a
                2000-case reference-equivalence test, grid-probed exact NMS,
                selection medians, hoisted transforms).  SIMD128 is on for the
                shipped wasm, used where a vector unit has a shape to use — a
                fixed query against a contiguous descriptor stream — and held
                to the scalar path bit for bit.
```

### Measured, not assumed

```text
geo_conf_at     Doubling geo_conf_at (16→32) and GEO_SOLO_INLIERS (11→22)
GEO_SOLO        with the budget looked obligatory: a control saturating at
                SCALE zeroes the margin by construction (chance_correct).
                MEASURED: at 512 keypoints the GN control reaches ≈3125 of
                10000, nowhere near saturation, while the doubling halves the
                reading on every work that never reaches the budget and
                turned a genuine crop from Copy into Suspected at 128×128.
                A floor only large works can clear is a size-dependent bias —
                the defect class v2 already cost this family once.  Both keep
                CAL-003's values; §8 diversity is the guard, because it
                measures the problem directly rather than by proxy.
cost            hash 512×384: JS 486 ms (was ~400), wasm 157 ms (was ~139) —
                the §3 selector is where it goes, and the first place to look
                if hash throughput becomes the constraint.  Comparison did
                NOT rise 4× with the pair count; measure the multiplier per
                deployment rather than quoting one.
```

### The shared-asset pair crossed the line — and the budget did it

```text
worked example  G1_shared_asset × G2_shared_asset, the ANALYSIS-002 case:

                  41 / 256 kp   Suspected   4 inliers, scattered, geo 2136
                  42 / 256 kp   Suspected   4 inliers, scattered, geo 2136
                  41 / 512 kp   Copy       14 inliers, region,    geo 8750
                  42 / 512 kp   Copy       14 inliers, region,    geo 8385

                Comparator 42 on 256-keypoint wires reproduces 4.1 EXACTLY,
                so the cause is the budget, not the judgement: 512 keypoints
                find the shared tile, which was always there.  ANALYSIS-002
                already says no threshold in the pixels separates this class
                from a partial copy, and the constructed lab already
                certified it under CAL-003.  Nothing was tuned to hide it.
                The console's invariant is now CONTAINMENT — nothing outside
                category G may certify — which is a stronger claim than
                counting zero.

                §8 does NOT rescue this.  The shared asset reads D = 3583 —
                and so does C1_composite, a genuine class-D collage, to the
                digit.  Diversity separates a shared asset from a NEAR-
                DUPLICATE (≈7900) and does not separate it from a partial
                copy, which is precisely ANALYSIS-002's finding restated on a
                new axis: the bands overlap because both cases genuinely ARE
                one coherent region reused at one scale.  Tightening
                lut_geo_diversity enough to demote the shared asset demotes
                the collage with it.  The difference is provenance, and
                provenance is not in the pixels.  Recorded here because the
                first draft of this note claimed the opposite, on the
                strength of comparing against the wrong class.
```

## Released

```text
4.2.0           the tier-2 budget is 512 and the entry is comparator 42 under
                container 3 (CAL-004-PROPOSED).  Comparator 41 is FROZEN, not
                deleted — compare41 / screen41 / cal41() still compute, so a
                verdict issued under 4.1 stays reproducible; comparator 4
                remains decodable and not computable.  4.2 fingerprints differ
                from 4.1 fingerprints of the same image (the tier-1 sketch is
                drawn from a different keypoint set), so RE-HASH before
                re-calibrating; hash { kpCount: 256, kpSelect: 0 } to reproduce
                a 4.1 wire exactly.  Docs: docs/SPEC-004.2-paph-v42.md.

4.1.0           published as @pixagram/paph-js (was @pixagram/paph3),
                carrying comparator 41 and NOTHING ELSE: compareV4 and
                cal001() are out of the package, container-1 artefacts
                decode for audit but never compute, modules are
                src/wire.cjs + src/paph-js.cjs, and the API is plainly
                named (hash / compare / screen / cal).  The Rust
                reference keeps comparator 4 because the golden vectors
                and the frozen local path are what prove 41.
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
CAL-004 CORPUS  the 496-pair corpus was hashed at 256 keypoints and has NOT
                been re-hashed at 512.  CAL-004's structural side is
                CAL-003's, which the 4.2 changes do not touch; its geometric
                side is CAL-003's constants carried across a budget change
                without re-derivation.  §19 must re-derive on 4.2 wires —
                lut_geometry first — before -PROPOSED comes off.  Until then
                a verdict carrying this id is calibrated on 4.1 evidence.
SELECTION       the §3 weights (40/25/20/15) and DESC_NOVEL_AT (16) are
                HASH-TIME and therefore not re-derivable without re-hashing.
                They are the most expensive numbers in 4.2 to get wrong and
                the ones most worth an ablation before the corpus grows.
                Every OTHER 4.2 change is switchable from the profile —
                lowe_margin=0, scale_soft=0, excl_pct=0, neutral
                lut_geo_diversity, kpSelect=0 — so an ablation of those is a
                profile edit, not a rebuild.
MIN MODEL       SPEC-004.2 §16 records the one reading taken as a judgement
                call: the source note's "minimum model 3" is implemented as
                the Hough peak MEMBER floor (min_peak_members, the fit's own
                requirement) rather than min_model_inliers, which stays 6.
                Lowering the ACCEPTANCE floor to 3 is a substantive
                recall/precision move and a one-field profile edit if the
                other reading was intended.
M7 VALIDATION   SPEC-004.1 and 004.2 on real moderation pairs with §19.3 split
                discipline: held-out test split, real A–D sourcing, the
                E1×E2 re-render policy decided by a human, §22
                adversarial keypoint-disruption pairs.  CAL-003 and
                CAL-004 stay -PROPOSED until this gate.
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
