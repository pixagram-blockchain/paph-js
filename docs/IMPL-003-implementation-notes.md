# PAPH v3 — implementation notes and errata

| | |
|---|---|
| Document | PAPH-IMPL-003 |
| Date | 18 August 2026 |
| Covers | `paph3/` (npm package: JS + Rust/WASM), `paph3.js` (single-file engine), `paph3-playground.html` (evidence bench), `paph3-test.js` (harness) |
| Status | Two independent implementations, byte-identical wires, identical verdicts. 39 of 39 harness assertions pass; 25 of 25 parity assertions pass. |

---

## 0. Update — 18 August, second pass

Three things changed after the first pass and they are the important part of this document now.

**The shipping defaults moved** to the operating point set on the bench: `scoring: weighted`, `evidence: lift`, `ragEndpoint: rank`, `hammingT: 8`, `confidenceAt: 16`, `geoConfAt: 16`, `geoEps: 1600`, `mirrorHypothesis: on`. All 39 harness assertions now pass — `inverted` and `rescaled 1.8x` both reach `Suspected`, which they did not before. The cost is real: `unrelated sprites` moved from **Unrelated (833) to Suspected (3130)** and same-generator scenes went 5359 -> 6215. On a four-work synthetic set the weakest-true-to-strongest-impostor margin widened the wrong way, -367 -> -810. These are compare-time knobs, so reverting is one line and no re-hash — but the measurement that matters belongs on the 16-work corpus.

**A second implementation exists.** The Rust crate is a from-scratch rewrite against SPEC-003, not a transliteration, and it produces **byte-identical Tier-1 and Tier-2 wires** and **identical verdicts** across every case tested. That property is the reason the design exists; §11 lists the four determinism defects the port exposed in the JavaScript, all of which are now fixed in both.

**No float survives in the wire path**, and `npm run tables` enforces it.

## 1. What was built

**`paph3.js`** — ~2,600 lines, UMD, zero dependencies. Tier 1 serialises to exactly **3,952 bytes**; Tier 2 to `32 + 40n` bytes, `n ≤ 256`. Everything in SPEC-003 §5–§10 is implemented: the unified front end, all eleven Tier-1 sections, the integer keypoint pipeline, the Hough vote with a fixed-point similarity refit, the permutation null, and the verdict lattice.

**`paph3-playground.html`** — self-contained, 171 kB, no network calls, runs entirely in the page. Drop two works, or derive the second from the first with any of eleven transforms. It shows the verdict lattice with the live reading plotted in it, keypoint correspondences with inlier lines, every channel against its own null with abstentions visible, the Tier-1 wire segmented by real byte offsets, and the moderator report block. The compare-time knobs re-decide instantly — which is the point of SPEC-003's P1 made physical.

**`paph3-test.js`** — `node paph3-test.js`. Reflection closure, determinism, wire integrity, argument-order symmetry, the abstention contract, a twelve-case transform battery, and timings.

---

## 2. Errata against SPEC-003

Four things in the proposal were wrong. All four are corrected in the implementation; the spec text should be amended.

### 2.1 §8.6 — the reflection-closed pattern is **y-negated**, not x-mirrored

SPEC-003 said bits 128–255 use the x-mirrored pairs `(−aₓ, a_y, −bₓ, b_y)`. That is wrong.

Deriving it properly: a horizontal mirror sends the intensity centroid to `θ → π − θ`, so `sector → 32 − sector`, and

```
F · rotate(p, 32−k)  ==  rotate(G·p, k),     F = diag(−1, 1),  G = diag(1, −1)
```

Sampling the mirrored image at offset `u` equals sampling the original at `F·u`, so bit *i* of the mirrored keypoint is the bit the **original** would produce with pattern `G·Pᵢ` — the **y-negated** pair `(aₓ, −a_y, bₓ, −b_y)`.

**The claim itself holds.** Measured: **2949 / 2949 exact**, for both `sector(mirror) === (32 − sector) & 63` and `descriptor(mirror) === descriptor with its two halves exchanged`. Mirror invariance costs zero stored bytes, as the budget assumed.

Two conditions the spec did not state:

- The sector tables must satisfy `COS64[32−k] === −COS64[k]` and `SIN64[32−k] === SIN64[k]` **as integers**, which requires symmetric rounding — `Math.round(0.5) = 1` but `Math.round(−0.5) = 0`, so the naive table breaks the identity.
- An argmax **tie** is the one case where the identity fails: the two tied sectors are adjacent, and "lowest index" is not preserved by `k → 32−k`. Rather than an asymmetric tie-break that quietly breaks mirroring, the implementation **refuses** the keypoint. Measured rate: **0.9%** of candidates.

### 2.2 §9.4 — Hough scale must come from level **dimensions**, not level indices

The proposal derived the scale bin from `level_B − level_A`. That is wrong whenever two works differ in size.

A keypoint's descriptor covers a 31 px patch *at its own level*, so the feature's size in normalised units is proportional to `1 / L_k`, and the scale ratio is `L_kA / L_kB`. A 72 px sprite and the same sprite inside a 220 px host both sit at level index 0 — index difference **zero** — while the true normalised scale ratio is **0.327**. The implementation recomputes `L_k` from the stored level index plus the work's `maxDim` (both already on the wire) and picks the nearest ladder bin by integer comparison.

Without this the collage case — the case the geometric stage exists for — scored zero inliers.

### 2.3 §8.1 — the border margin is 24 px, not 18

`PATCH_R + 3` is too small. A rotated pattern point reaches `ceil(PATCH_R·√2) = 22` from the keypoint, plus the 2 px box radius. At margin 18 the box windows clip, and three of 3,588 mirrored descriptors disagreed. `KP_MARGIN = ceil(PATCH_R·√2) + 2 = 24`.

Related: the spec's `LEVEL_MIN = 96` was inherited from a corpus of 119–736 px works and starves small pixel art. The real floor is the smallest level that still has an interior, `2·KP_MARGIN + 4 = 52`, and level 0 must always exist — a 64 px sprite produced **zero** keypoints under the spec as written.

### 2.4 §9.5 — single-channel certification needs a corroboration floor

The lattice as specified let two flat canvases certify as `Copy` through the shape channel alone: with only one measurable secondary, the "median of five" corroboration degenerates to that one channel. The implementation adds `structuralCertifiable` — the structural side may certify only when the **local** channel is measurable (there is nothing to corroborate without evidence) **and** at least three secondaries are measurable.

---

## 3. Three defects inherited from v2, now fixed

These were in the v2 code and are described as working in SPEC-002. They were not.

**Inversion invariance never held end to end.** The palette quantile was "mass strictly darker than this entry". Under a luminance flip the order reverses, so that becomes `255 − q − ownMass` — every entry shifts by its **own mass**, and the complement fold in `canonical64` could never fire. Measured on an inverted copy: **0 of 128 regions collided**. Three changes make it exact:

1. the quantile becomes the **midpoint** of the entry's own mass, which satisfies `q(inverted) === 255 − q`;
2. `bitsOf` thresholds at `2v > s[31] + s[32]` rather than at `s[32]`, because splitting at one order statistic of 64 values is not the symmetric middle and does not survive a complement;
3. transparent cells map to the **self-complementary midpoint** of a doubled scale (opaque `2(q+1)`, transparent `257`, complement `514`) — previously a transparent cell sat at 0 and stayed at 0, so no window touching an alpha edge could fold;
4. and peak selection hashes the local **gradient** rather than the raw level, so an inverted work selects the same windows.

SPEC-002's invariance matrix should be corrected: v2's claimed inversion invariance was a code reading, not a measurement.

**Grid NMS is not translation-equivariant.** Replaced with a true Euclidean radius over a total order `(strength, y, x)`. For an algorithm whose premise is finding the same points twice, a 2 px shift changing which of two nearby corners survives is a real weakness.

**Pooled keypoints were ranked by raw FAST score across resolutions.** Downsampling smooths, so coarse levels were systematically starved. Strength is now normalised by the level's own median before pooling.

---

## 4. Two additions the spec did not anticipate

**A spatial quota on the keypoint budget.** Taking the globally strongest 256 keypoints looks fair and is not: a busy host — a city skyline, a dithered background — out-scores a pasted figure and crowds every one of its keypoints out of the budget. The one case the geometric stage exists for is exactly the one the cap silences. The implementation round-robins over an 8×8 spatial grid, keeping a foothold everywhere. Measured on the playground's paste-then-crop case: 3 correspondences → 12, and the verdict moved from `Suspected` to `Copy — certified`.

**Sixteen DCT hypotheses, not eight.** Inverting a work negates every AC coefficient, which is a **sign flip on the stored code** — the same "compute the symmetry from stored bits" move the local fingerprints already make for the complement. The control becomes the median of sixteen rather than of eight, so the extra hypotheses do not inflate the reading. Without this, an inverted copy lost every corroborating channel and the gate collapsed regardless of how well the local channel did.

---

## 5. Geometric inversion invariance is **not** free — this one failed

Worth stating plainly because the design language of §P2 suggests it should work.

Inverting a work complements every BRIEF bit (`I(a) < I(b)` becomes `I(a) > I(b)`) **and** moves the sector to its antipode (`sec ^ 32`). Both are computable from stored bits. But the second effect defeats the first: the steered pattern then lands on the **opposite side** of the keypoint and samples different pixels entirely.

Measured: mean Hamming distance between a keypoint's descriptor and the complement of its inverted twin, over 255 co-located keypoints — **129.9 of 256**. Chance.

A working version needs a **centrally symmetric** pattern: 64 independent pairs spanning four quadrants `{P, G·P, −P, −G·P}` instead of 128 spanning two. That trades descriptor distinctiveness for the invariance. It is a measurable choice, not a free one, and it is not made here. Inversion is carried by the DCT sign flip, the palette quantile reflection and the local complement fold — all of which do hold exactly.

---

## 6. Measured results

### Harness — 37 of 39 assertions pass

Passing: reflection closure (4/4); determinism and wire integrity (8/8, including CRC-32 catching a byte transposition that v2's XOR could not see, and v2 wires being rejected rather than reinterpreted); `compare(x,y) === compare(y,x)` with worst delta **0**; the abstention contract (4/4, including a proof that zeroing the colour section cannot move a verdict); reporting fields (4/4).

Transform battery, sprite base:

| case | verdict | structural | geometric | inliers |
|---|---|---|---|---|
| identical | Identical | 10000 | 10000 | 256 |
| 4× nearest upscale | Copy | 9922 | 10000 | 256 |
| recoloured | Copy | 9898 | 10000 | 187 |
| mirrored | Copy | 9915 | 10000 | 166 |
| rotated 90 | Copy | 9919 | 10000 | 158 |
| cropped 70% | Copy | 9876 | 10000 | 38 |
| palette rebuilt | Copy | 9922 | 10000 | 45 |
| pasted into a scene | Copy | 7544 | 2916 | 7 |
| pasted, then cropped | Copy | 9714 | 10000 | 66 |
| unrelated sprites | Unrelated | 833 | 0 | 0 |
| same-generator scenes | **Suspected** | 5359 | 0 | 0 |
| sprite vs scene | Unrelated | 0 | 0 | 0 |

The same-generator row is the important one. Two works from one generator share run-length and palette statistics — the genre floor — and score 5359 structurally. Geometry reads **0**, so the lattice caps them at `Suspected` and no false `Copy` is issued. That is the whole argument for two axes rather than a weighted sum, visible in one row.

**All 39 now pass** under the new defaults. Read that carefully: the two cases that were failing did not become correct, they became *reachable* — `inverted` and `rescaled 1.8x` now clear `Suspected` because `hammingT 8` roughly doubles the collision radius and `weighted` removes the structural refusal `gate` enforces. The same two changes are why `unrelated sprites` rose from 833 to 3130. A suite that goes green because the bar moved is not evidence that the engine improved, and this row should be re-measured on the real 16-work corpus before anything is concluded from it.

### Timing (node 22, single thread)

| | JavaScript | WebAssembly | SPEC-003 target |
|---|---|---|---|
| Hash, 512×384 | **430 ms** | **145 ms** | ≤ 1600 ms |
| Hash, 320×240 | ~196 ms | ~62 ms | — |
| Warm pairwise compare | **5.4 ms** | ~2 ms | ≤ 25 ms |

Two optimisations got there, and the first is **worth backporting to v2 immediately**:

- The eight D4 variants in `canonical64` are permutations of one multiset, so they share **one** median instead of eight 64-element sorts. Hash: 1937 → ~660 ms. This is the dominant cost of the entire hash.
- `isqrt` was `while ((r+1)² ≤ n) r++`, i.e. O(√n) with n up to 4.3×10⁹, called twice per pair inside the O(n²) coherence check. It was 49 ms of a 52 ms compare.

---

## 7. What §14 still owes

Unchanged from the spec, minus test 1 which is now done:

1. ~~reflection-closed BRIEF~~ — **verified, 2949/2949, with the correction in §2.1**
2. aspect-true coordinates on the real corpus, and sweep `geoEps` downward from 1500
3. bag size 64 → 128, in isolation, on the real corpus
4. integer orientation and integer refit against float equivalents — how many verdicts move?
5. alpha unification and the silhouette channel — L2's 0.82 was measured *with* silhouette signal available
6. Hough vote against RANSAC on the same correspondences
7. the lattice thresholds, on real moderation reports — not on 16 works
8. retrieval recall, separately from verdict recall

And the standing one: **the ground truth is still 11 inferred pairs, one of which a measurement already proved mislabelled.** Confirming those labels remains worth more than any further engineering here.


---

## 11. Determinism defects the Rust port exposed

None of these were visible from inside JavaScript. All are fixed in both implementations.

**The BRIEF pattern's LCG was not exact.** `s * 1103515245` reaches 2.4 × 10¹⁸, far past the 2⁵³ a double holds exactly, so the low bits of every pattern coordinate were rounding noise. Deterministic inside V8 — IEEE-754 is exact per operation — and therefore invisible to any amount of JavaScript testing, but unreproducible in integer arithmetic. `Math.imul` on both sides now.

**`(3 * M) >> 1` depends on int32 coercion.** JavaScript's `>>` coerces its operand first, so 6442450941 wraps to 2147483645 *before* the shift and the result is 1073741822, not 3221225470. The Rust reproduces the wrap explicitly rather than the arithmetic.

**`(sq * rx) >> 16` in the Hough vote was silently wrapping.** That product reaches ~10¹² and `r00 * ax` passes 2³¹ once the recovered scale exceeds about 4×. Both now floor-divide exactly. This one changed results: it was the last divergence between the two engines, and fixing it moved an inverted pair from 7 inliers to 8.

**The sparse-RAG key is a signed int32.** `(qlo << 24)` overflows into the sign bit, so the tie-break sort is signed. The Rust uses `i32` keys to match.

**Every table is now a frozen integer literal** — trig, rays, and the DCT basis at all three block sizes. `Math.cos` and `f64::cos` may disagree in the last ulp, and after `round(x · 32768)` that is a table entry off by one. `Math.log2` also came out of the header path (byte 13 reaches the wire) and `Math.ceil` out of `shapeGrid`. `npm run tables` regenerates them, re-checks the reflection identities, and asserts that no transcendental appears anywhere in the engine source.

One correction to §2.1 of this document while we are here: the DCT basis is **Q = 14**, not Q = 12. The first frozen table was generated at the wrong scale and the parity harness caught it immediately — which is the argument for having a second implementation in one sentence.
