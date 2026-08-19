# PAPH — Technical Specification

**Two algorithms for pixel-art copy detection on Pixagram**

| | |
|---|---|
| Document | PAPH-SPEC-002 |
| Date | 18 August 2026 |
| Status | Descriptive-normative. Specifies the behaviour of two shipped reference implementations. |
| Supersedes | The v2.0 prose spec, wherever the two disagree (§6.4 lists every disagreement) |
| Sources of truth | `paph-demo (5).html` — engine `paph.js` v2, 1877 lines<br>`paph-playground (4).html` — engine `window.L2`, in-browser Canvas port |

---

## 0. About this document

### 0.1 Scope

Two distinct algorithms are specified. They are not versions of each other; they solve different halves of the same problem and are intended to be layered.

| | **Algorithm A — PAPH-BOF** | **Algorithm B — PAPH-L2** |
|---|---|---|
| Full name | Bag-of-features structural hash | ORB-style keypoint geometric verifier |
| Output | A fixed 1357-byte fingerprint, comparable pairwise | No stored artefact; a pairwise inlier count |
| Question answered | *Do these two works share structure?* | *Is one of these a geometric transform of the other?* |
| Indexable | Yes — fixed byte ranges, LSH-friendly | No — comparison is O(\|A\|·\|B\|) descriptor distance |
| Arithmetic | Integer / fixed-point only | Floating point throughout |
| Consensus-safe | Yes, by construction | **No** (§16) |
| Measured recall @ P=1.00 | 0.45 (5/11) | 0.82 (9/11) |

Part I specifies Algorithm A. Part II specifies Algorithm B. Part III compares them and states what a merged v3 would have to reconcile.

### 0.2 Conformance language

**MUST** / **MUST NOT** — required for a conforming implementation; violating it changes the wire bytes or the verdict.
**SHOULD** — the reference implementation does this and the reason is given; deviate only with a measurement.
**MAY** — genuinely free.
**NOTE** — non-normative commentary, usually a defect or an open question.

### 0.3 Integer conventions (Algorithm A)

Algorithm A is integer-only. Every value that reaches the wire is derived with `|0`, `>>`, `>>>` and exact integer products. All intermediates stay below 2⁵³ so IEEE doubles hold them exactly, which is what makes a JavaScript reference and a Rust/WASM implementation agree bit-for-bit.

| Symbol | Meaning |
|---|---|
| `idiv(a,b)` | `(a / b) \| 0` — truncation toward zero |
| `clamp(v,lo,hi)` | saturating clamp |
| `luma(r,g,b)` | `(77·r + 150·g + 29·b + 128) >> 8` — integer BT.601 |
| `Q = 14`, `QONE = 16384` | DCT cosine fixed point |
| `R = 10`, `RONE = 1024` | ray-direction fixed point |
| `SCALE = 10000` | all channel scores and verdict thresholds |

There **MUST** be no `Math.random`, no `Date`, no locale, and no floating-point transcendental at hash time. The cosine tables are built once from a series at load time and are the only place `Math.cos` appears.

---

# Part I — Algorithm A: PAPH-BOF

## 1. Overview and design constraints

PAPH-BOF reduces a work to a hierarchical multi-scale bag of features and compares two such bags across six independent channels, each of which reports its own chance floor.

Hard constraints, in the order they bind:

1. **Bounded wire.** ≤ 1.5 kB serialised. Actual: **1357 bytes**, fixed layout, no length prefixes.
2. **Integer only.** No `f32`/`f64` anywhere on the hash path. Required for `no_std` WASM and cross-architecture consensus.
3. **Zero dependencies.**
4. **Indexable.** Every section sits at a constant byte offset so a database can index a byte range without parsing.
5. **Absolute RGB is discarded on purpose.** A recolour must not move the fingerprint. Every colour-derived quantity is a *luminance quantile* — the share of opaque pixel mass strictly darker than an entry — which survives both a monotone tone curve and a rebuilt palette. Palette *rank* does not.

The pipeline is: ingest → normalise → index → seven descriptor sections → serialise. Comparison is a separate pure function over two serialised wires.

## 2. Ingestion and normalisation

### 2.1 Pixel input

Input **MUST** be RGBA8, row-major, `w·h·4` bytes. Four container shapes are accepted (`ImageData`, `{px,w,h}`, `{pixels,width,height}`, `(bytes,w,h)`). Anything else **MUST** throw. A coercion that cannot succeed **MUST NOT** fall back to a value that happens to type-check.

Dimensions **MUST** satisfy `w > 0 && h > 0`; the buffer **MUST** be at least `w·h·4` bytes. A `Uint8Array` view into a larger buffer **MUST** be honoured at its `byteOffset`.

### 2.2 Matte fold

An exported flat backdrop **MUST** become transparency *before* the palette is built. A masked matte otherwise occupies a palette slot, and every structural rank downstream is a position in that palette.

Procedure, `foldMatte(px, w, h, tol)`:

1. Count pixels with `alpha > 8`. If fewer than 98% of pixels are opaque, the image already carries real alpha — return unchanged.
2. If `w < 8 || h < 8`, return unchanged.
3. Collect the **whole border ring** (all four edges). Tally each ring pixel under a 4-bit-per-channel quantisation `((r>>4)<<8) | ((g>>4)<<4) | (b>>4)`.
4. Take the modal bucket, ties broken by lowest key. If it owns **fewer than half** the ring, there is no matte — there is a picture that reaches its own edges. Return unchanged.
5. Seed colour = the exact mean RGB of the ring pixels in that bucket.
6. Flood-fill 4-connected from **every** ring pixel within `±tol` per channel of the seed colour.
7. If the flooded area is `< 2%` or `> 90%` of the canvas, the fold has eaten the subject or found nothing. Return unchanged.
8. Otherwise set `alpha = 0` on every flooded pixel and set flag `F_MATTE`.

**NOTE — why the seed is the ring and not the corner.** Real exports break both assumptions a corner flood makes. Backdrops are *dithered*: works in the calibration corpus carry 23–43 distinct colours along the top row alone, so a tolerance-2 exact-match flood reads a flat grey backdrop as forty separate regions and folds none of them. Backdrops are also *disconnected*: braids, limbs and props reach the frame, so a flood seeded at pixel zero reached 16% of a canvas whose backdrop was plainly most of it. Fixing this took one true pair from score 4062 to ~9100 and its palette channel from 134 to 10000.

**NOTE — the border gate is coverage, not perimeter/area.** An earlier gate at 90% ring coverage refused a real matte because a figure touching the frame owned 88.8% of the ring. `perimeter·10 ≤ area` was tried and rejected: it is not scale-free.

### 2.3 Upscale division

Find the largest `k ≥ 2`, `k | gcd(w,h)`, such that the image is an exact `k×` nearest-neighbour upscale. If found, point-sample down by `k` and record `k` in header byte 10 (clamped to 1..255).

A 4× export then hashes to the same wire as the original, with the factor recorded in the header instead of smeared through every descriptor.

### 2.4 Palette indexing

`indexImage(px, w, h)`:

1. Quantise each pixel to RGBA5551: `key = alpha < 128 ? -1 : ((r>>3)<<11) | ((g>>3)<<6) | ((b>>3)<<1) | 1`. Pixel art is already indexed; this only collapses export noise.
2. Count exactly. Sort entries by **population descending, then key ascending** — this ordering is normative, it is what makes the palette deterministic.
3. Cap at **255** entries. Every pixel whose key did not survive **MUST** be remapped to the nearest surviving entry by squared Euclidean distance in 5-bit RGB space, and **MUST** be added to that entry's population.
4. Each surviving entry carries the integer mean RGB of its members and `lum = luma(r,g,b)`.

### 2.5 Luminance order, quantile, band

Sort the palette by `lum` ascending, ties by key ascending. Walking that order, for entry `i`:

```
lumOrder = i
quantile = (acc·255 + opaque/2) / opaque      // 0..255, acc = mass strictly darker
band     = quantile >> 5                       // 8 bands
acc     += n_i
```

`quantile` is the load-bearing quantity of the whole design. It is invariant to any monotone tone curve **and** to the palette being rebuilt. `lumOrder` (and therefore palette rank) is invariant to neither.

### 2.6 Area-majority aggregation

`areaMajority(idx, w, h, nw, nh, pal)` resamples the index map to `nw × nh` by taking the **mode** of the covered source pixels, ties broken by **highest luminance order**. Transparent is a participating value (`-1`, tallied at slot 0).

Bilinear resampling **MUST NOT** be used: it invents colours that are not in the palette. Hard pixel boundaries are content here, not artefacts.

## 3. Descriptor sections

### 3.1 Hierarchical DCT — 256 B

Built from a single 16×16 luminance thumbnail. All three levels read the **same** thumbnail — quadrants are its 8×8 quarters, tiles its 4×4 sixteenths — so the pyramid costs one aggregation pass, and a quadrant descriptor is exactly what you would get by hashing that quarter of the canvas on its own.

| Level | Source | Transform | Coefficients | Bits | Bytes |
|---|---|---|---|---|---|
| L0 | 16×16 thumbnail | DCT-16 | 256 | 2 | 64 |
| L1 | 4 × 8×8 quadrant | DCT-8 | 64 each | 2 | 4 × 16 = 64 |
| L2 | 16 × 4×4 tile | DCT-4 | 16 each | 4 | 16 × 8 = 128 |

**Thumbnail.** 16×16 area-majority of the index map. Cells with no opaque pixel **MUST** take the **median palette luminance**, not 0. Filling holes with black manufactures an edge that the same sprite composited onto a host would not have, and the two maps of one drawing then share almost nothing.

**Flatness.** If all 256 thumbnail values are equal, set `F_FLAT`. This **MUST** be recorded at hash time — it is the only place it is observable. The quantiser buckets against the block's own order statistics, so a constant block and a structured one are indistinguishable once packed. Two blank canvases certified as *Identical* until this flag existed.

**DCT.** Separable, two passes, cosine table `cos((2i+1)uπ/2N) · 2¹⁴` rounded to integer, output `(s + 2¹³) >> 14` per pass. Unnormalised (no orthonormal scaling) — irrelevant, because magnitudes are bucketed against their own block.

**Quantisation** — `quantiseBlock(coeffs, bits, keepDC)`:

Each coefficient is stored as **one sign bit plus a Gray-coded magnitude bucket**, taken against the order statistics of `|coef|` in its own block.

```
mbits  = bits - 1
levels = 1 << mbits
mags   = sorted |coef| over i ∈ [keepDC ? 0 : 1, n)
cuts[i-1] = mags[clamp(i·len/levels, 0, len-1)]   for i in 1..levels-1
q      = number of cuts c with |coef| ≥ c        (capped at levels-1)
code   = (sign << mbits) | GRAY[mbits][q]
```

Gray tables: `GRAY[1] = [0,1]`, `GRAY[3] = [0,1,3,2,6,7,5,4]`. Bits are packed **MSB-first** into the output byte stream.

**Why sign and magnitude are split.** The obvious encoding — bucket the signed value — costs the dihedral group. Under a horizontal flip a 2-D DCT negates every coefficient with odd horizontal frequency, and you cannot negate a signed percentile bucket after the fact. Split the sign off and all eight D4 symmetries become bit operations on the *stored* code at compare time, for zero extra bytes. Bucketing `|coef|` against its own block additionally buys invariance to a global contrast scale.

**DC.** Dropped by default (`keepDC = false`). Kept, its sign dominates the code: a sibling index built with DC had to compare 98.9% of the corpus, because every bucket was answering "is this picture bright". Dropping it also buys tone-shift invariance.

### 3.2 Identity palette — 64 B

16 entries × 4 B. Absolute RGB is not stored.

| Byte | Field |
|---|---|
| 0 | rank `i` (0..15) |
| 1 | relative frequency, `(n_i·255 + maxN/2) / maxN` |
| 2 | luminance order scaled to 0..255 |
| 3 | **luminance quantile** |

**NOTE.** The v2.0 prose spec listed three fields against a 64-byte budget — 48 bytes of content. The fourth byte holds the quantile, which is the field that actually survives a rebuilt palette.

### 3.3 Sparse region-adjacency graph — 128 B

32 entries × 4 B: the 32 most frequent colour transitions.

For every horizontally- and vertically-adjacent pixel pair with differing, non-transparent indices, form an endpoint pair. Endpoint value is the **luminance quantile** (`ragEndpoint = 'band'`) or the scaled luminance order (`'rank'`). Canonicalise by `(min, max)` so a colour swap cannot reorder them; discard pairs whose endpoints collide after mapping. Sort by count descending, key ascending; keep 32.

| Byte | Field |
|---|---|
| 0 | low endpoint |
| 1 | high endpoint |
| 2–3 | count normalised to 0..65535 of the total, little-endian |

### 3.4 Shape signatures — 5 × 41 = 205 B

Connected components over a modally-downsampled 8-band luminance-quantile label map. Quantile bands survive a tone curve and a rebuilt palette; the modal downsample kills dither confetti that would otherwise shatter every region into noise.

**Grid.** `cell = ceil(max(w,h) / 128)`; `gw = max(4, ceil(w/cell))`, `gh = max(4, ceil(h/cell))`. Labels are `band` (default) or `paletteSlot & 7`.

**Components.** 4-connected, equal-label. Sort by area descending, then `minY`, then `minX`. Keep 5.

**Record layout** (41 B):

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | area, u32 LE |
| 4 | 2 | perimeter, u16 LE — cells with a 4-neighbour outside the component or on the grid border |
| 6 | 2 | aspect = `clamp(bw·256 / bh, 0, 65535)`, u16 LE |
| 8 | 1 | holes — complement components inside the bbox that never touch the bbox border |
| 9 | 32 | radial signature |

**Radial signature.** 32 rays at `kπ/16`, direction cosines in Q10, integer DDA from the centroid, distance to the **first** cell not belonging to the component. Normalised to 0..255 by the maximum ray. The centroid **MUST** be pulled to the nearest in-component cell if it falls outside the component, or the rays start outside the shape.

**NOTE.** The v2.0 spec is self-inconsistent here: its table says 36 B, its own field list adds to 40, and its Rust struct to 41. The fields win.

### 3.5 Run-length geometry — 48 B

Contiguous same-index runs along horizontal, vertical and main-diagonal scans, binned on a log ladder. Captures stroke texture with no colour in it at all.

```
ladder = [1,2,3,4,5,6,8,10,13,16,22,30,42,60,90, ∞]
```

Three histograms of 16 bins; each bin stored as `clamp(count·255 / axisTotal, 0, 255)`. Diagonals shorter than 2 cells are skipped. Transparent (`-1`) is a participating run value.

### 3.6 Local fingerprints — 512 B

The collage channel, and the one that decides whether a sprite buried in a busy scene is ever found. Up to 64 regions × 8 B.

#### 3.6.1 Anchor selection — strict local maxima

Build a quantile map `qmap` (0..255, `-1` transparent). For each interior pixel:

```
saliency e = Σ over the 3×3 neighbourhood of |v − c|,  transparent counted as 64
tie      = mix64(rollingHash(3×3 values), e)
pack     = e > 0 ? e·2³² + tie : −1
```

An anchor is a pixel where `pack` **equals** the maximum of `pack` over the `(2r+1)²` window centred on it, where `r = peakRadius`. Anchors are emitted at doubled coordinates `(2x, 2y)`.

The maximum filter **MUST** be computed separably — a horizontal pass then a vertical pass, each an O(n) monotonic deque. Strength and tie-break are packed into **one** comparable double: strength needs 10 bits and the tie hash 32, which is 42, inside the 53 a double holds exactly. Packing loses nothing and lets the filter carry the lexicographic order intact. The direct test is 31 million comparisons on a 736×352 work and dominated hashing at ~600 ms/image.

**NOTE — four earlier detectors, each instructive.** Every one of them chose anchors by a property of the *canvas*, and moved when the canvas changed, which is the one thing an anchor must not do.

| Detector | Failure |
|---|---|
| Stride grid from the canvas corner | A 48×48 sprite pasted at y=60 with stride 8 is 4 px out of phase with every host window. A pixel-exact copy scored **zero** collisions. |
| Local maxima of a box-sum saliency | A box sum is a low-pass filter and a low-pass surface has almost no maxima: 363 admissible windows yielded **2** anchors. |
| Region centroids | The centroid of a flat region is the middle of a flat region. Half the bag came out all-zero, poisoning the empirical null too: 15 genuine collisions on an exact paste scored 0.000 because the control also counted 15. |
| 2×2 junctions (three indices meeting) | On real dithered art this selects 20–40% of **all** pixels, so it selects nothing. |

#### 3.6.2 Window placement

For each `win ∈ localWindows = [8, 16]` and each anchor at doubled coordinate `c2`:

```
num  = c2 + 1 − win
base = num >> 1
offsets = (num odd) ? [base, base+1] : [base],  each clamped to [0, span − win]
```

Both parities are tried because the anchor sits at a half-pixel position; this is what makes window placement translation-equivariant rather than merely translation-*dependent*.

**Opacity floor.** A window **MUST** be discarded unless `opaqueCount·4 ≥ win²·3` (≥75% opaque). Admit half-transparent windows and the bits encode the **silhouette**, which a composite does not have — and matching a lone sprite to the same sprite composited onto a host is the whole point.

**Both window sizes are required.** A 16 px window fits inside a 48 px sprite's opaque area barely three times, so a sprite hashed at 16 alone has nothing to match.

#### 3.6.3 The 64-bit code

1. Reduce the window to an 8×8 cell grid. With `q = win >> 3 > 1`, each cell is the **median** of its `q×q` sub-block of `(quantile + 1)`, transparent → 0. A median means one stray pixel cannot move a cell.
2. Cells carry the full 0..255 quantile, **not** the 8-band reduction. With 8 levels the median threshold ties on most cells of a simple region, half the bag comes out near-constant, and chance collisions ran at 62% — the channel measured nothing.
3. `canonical64`: enumerate the 8 D4 variants of the cell grid; threshold each at its own median (`> s[32]` of the sorted 64 values) into a `(hi, lo)` u32 pair; take the **lexicographic minimum**. If `foldInvert`, the bitwise complement of each variant also competes.
4. **Reject** the window if `popcount(hi,lo) < 6` or `> 58`. An all-zero code collides with every featureless patch in every work ever hashed, including with its own rotations. Popcount is invariant under D4, so this filter cannot break the canonicalisation it sits next to.

**Why the complement is folded in rather than handled at compare time.** Complementation commutes with D4, so the canonical form of the complement is the complement of the lexicographic *maximum*, not of the minimum — and the two do not meet. A `min(d, 64−d)` distance therefore cannot recognise an inverted copy; folding at hash time can. **The cost is real:** light/dark polarity is discarded, and a work and its negative are indistinguishable to this channel.

#### 3.6.4 Selection — MinHash, not a canvas budget

Score each surviving candidate with the scrambler `key = mix64(hi, lo)` and keep the **64 smallest keys**, deduplicating identical `(hi, lo)` pairs — a repeated texture is one vote, not forty.

The scrambler is required: taking the numerically smallest *fingerprints* verbatim would fill both bags with codes sharing long runs of leading zeros, which are close in Hamming distance by construction and would inflate the very collision count the channel reads as evidence.

**This selection rule is normative and load-bearing.** The decision to keep a window depends **only on that window's own content**, so a drawing hashed alone and the same drawing pasted into a scene nominate identical windows and the two bags can intersect at all. A budget shared round-robin across canvas quarters cannot do that: measured on real works, every bag saturated at the cap and two near-identical crops matched 12 of 64.

Wire order is sorted by `(hi, lo)` ascending, so two identical bags serialise identically and the section is comparison-order independent.

### 3.7 Anchor positions — 128 B

64 × 2 B. Window centre as a 1/255 fraction of `(normalisedWidth − 1, normalisedHeight − 1)`.

Two bytes per region buys the answer to the question a count cannot answer: **do the matches agree on a placement?** Scattered agreement is confetti; agreement on one offset is a paste.

**NOTE — a real inconsistency.** Positions are *encoded* against the normalised canvas (post matte-fold, post upscale-division) but *decoded* in `readLocal` against `d.width`/`d.height`, which are the **original** dimensions. Decoded anchors are therefore in original-image pixel units, uniformly scaled by the upscale factor. This is benign for the coherence channel, which estimates a scale from ratios and so absorbs any per-work uniform factor — but a v3 that uses anchor coordinates for anything else **MUST** fix or explicitly document this.

## 4. Wire format — 1357 bytes

| Offset | Size | Section |
|---|---|---|
| 0 | 16 | header |
| 16 | 256 | hierarchical DCT (L0 64 \| L1 4×16 \| L2 16×8) |
| 272 | 64 | identity palette (16 × 4) |
| 336 | 128 | sparse RAG (32 × 4) |
| 464 | 205 | shape signatures (5 × 41) |
| 669 | 48 | run-length geometry (3 × 16) |
| 717 | 512 | local fingerprints (64 × 8) |
| 1229 | 128 | anchor positions (64 × 2) |

Header:

| Byte | Field |
|---|---|
| 0–3 | magic `"PAPH"` = `50 41 50 48` |
| 4 | version = 2 |
| 5 | flags |
| 6–7 | original width, u16 LE |
| 8–9 | original height, u16 LE |
| 10 | upscale factor, clamped 1..255 |
| 11 | palette entry count |
| 12 | RAG entry count |
| 13 | shape count |
| 14 | local fingerprint count |
| 15 | XOR checksum of bytes 16..1356 |

Flags:

| Bit | Name | Meaning |
|---|---|---|
| 1 | `F_KEEPDC` | DC coefficient retained |
| 2 | `F_RAGRANK` | RAG endpoints are palette ranks, not quantiles |
| 4 | `F_SHAPEPAL` | shape labels are palette slots, not bands |
| 8 | `F_MATTE` | a backdrop was folded to transparency |
| 16 | `F_INVFOLD` | fingerprints are canonical over complement as well as D4 |
| 32 | `F_FLAT` | the thumbnail is constant — no tonal structure |

`parse` **MUST** reject on wrong length, bad magic, unsupported version, or checksum mismatch. Every section sits at a constant offset so a database can index a byte range without parsing, and a section added later cannot move an existing one. *(A stale offset after a section was inserted is a bug this family has already paid for once.)*

## 5. Comparison

### 5.1 The contract of a channel

Every channel **MUST** report four things, not one:

| Field | Meaning |
|---|---|
| `raw` | what the measurement said |
| `control` | what the same measurement says on deliberately misregistered data — the chance floor |
| `measurable` | whether it could be evaluated at all |
| `controlRan` | whether the control was actually computed |

```
value = chanceCorrect(raw, ctl) = control ≥ SCALE ? 0
                                : clamp((raw − ctl)·SCALE / (SCALE − ctl), 0, SCALE)
```

A raw agreement of 1.000 between two unrelated works is not rare; it is what you get whenever both sides are dense. The measurement is only worth what it beats.

**`measurable` matters more than `raw`.** A channel that cannot evaluate **MUST** abstain, and **MUST NOT** return a number that happens to read as favourable. Every silent default in this family's history has eventually certified something it should have refused. `controlRan` exists because *"the control ran and returned 0"* was previously indistinguishable from *"the control never ran"*.

### 5.2 Canonical argument order

`compare(x, y)` **MUST** equal `compare(y, x)`. A moderation queue that reports a copy only when the report happens to name the works in one order is not a detector, it is a coin flip. Measured before this was fixed: worst delta 4830, with nine verdicts changing.

Several channels are directional under the hood — the local matcher breaks ties by one side's ordering, placement coherence measures a scale of host over guest, the RAG walk is a greedy over one side's edges — and each was independently symmetric-*looking* while the whole was not.

The fix **MUST** be structural, not per-site: sort the two wires by lexicographic byte order, run every channel in that fixed frame, and map the directional outputs back afterwards (`dx, dy → −dx, −dy`; `scale → 65536/scale`; swap the pair indices and anchor lists; invert the reported dihedral transform via `D4_INVERSE = [0,1,2,3,4,6,5,7]`). Fixing each site separately is a promise that has to be re-kept with every future channel.

**Identity shortcut.** Byte-equal wires **MUST** short-circuit to verdict *Identical* with all scores at `SCALE`. The chance corrections deliberately stop a perfect match from reaching the ceiling, so without this no threshold can express "these are the same bytes".

### 5.3 The six channels

#### 5.3.1 `dct` — global layout, dihedral-aware

Abstains if either side has `F_FLAT`. DC is skipped unless **both** sides set `F_KEEPDC`.

For each of the 8 D4 transforms `t`, apply `t` to A's stored codes — transpose swaps the frequency indices and permutes the quadrant/tile grid, a flip toggles the sign bit on odd rows or columns — and score:

```
blockSim(X,Y) = clamp(SCALE − 2·d·SCALE / nb, 0, SCALE),
                d = Σ (signX ⊕ signY) + popcount(magX ⊕ magY)
v(t) = (2·L0 + 2·meanL1 + meanL2) / 5
raw     = max over t
control = median of the eight v(t)   (index 4 of the sorted 8)
```

Taking the best of eight inflates chance agreement, so the median of the eight is the control. The channel also **reports which symmetry won**, which is what a moderator needs.

#### 5.3.2 `local` — the collage channel

Abstains if either bag holds fewer than 4 fingerprints.

**Burst weighting.** For each bag, `burst[i]` = how many codes in that *same* bag lie within `hammingT` of code `i` (including itself).

> These fingerprints are not random 64-bit numbers, and treating them as if they were is what let unrelated works collide freely. A plain horizontal boundary produces the same code wherever it appears, in any artwork, so two unrelated pixel-art works share dozens of them. A code that already matches eight regions of its own work is describing a **texture**, not an **identity**. Weighting each match by the rarer of its two burst counts is the correction, and it needs no outside corpus to estimate. Measured: false positives 36 → 1.

**Matching.** `matchBags` is an **injective greedy**: all pairs with Hamming ≤ `hammingT`, sorted by distance then by record-derived ties (never loop order), each fingerprint claimed at most once. Without injectivity one busy host region answers for every guest region at once — exactly the "figure inside a figure" cheat.

```
W        = Σ over hits of SCALE / max(burstA[i], burstB[j])
capacity = Σ over one bag of SCALE / burst[i];   cap = min(capA, capB)
```

**The null.** Rotate every code in bag B by 16, 32 and 48 bits, recompute bursts and matches for each, and take the **minimum** weighted result `E` (with its count `En`).

> A rotation-based null *underestimates* chance, because these codes are structured rather than random: rotating a structured code gives an unstructured one, which collides with nothing. It still earns its place — it catches a bag that is degenerate in a way burst weighting alone would miss — but burst weighting, not the rotation null, is what makes the generic-collision problem tractable.

**Two evidence rules**, both computed, one selected by the `evidence` knob:

| Rule | Formula | Character |
|---|---|---|
| `proportion` | `raw = W·SCALE/cap`, `ctl = E·SCALE/cap` | What share of the *achievable* weighted match was achieved. Reads containment the way a Jaccard does — a small drawing inside a large scene can only ever occupy a small share, so a statistically unambiguous find still reports weak. |
| `lift` | `purity = W·SCALE/(W+E+prior)`, `conf = clamp(C·SCALE/confidenceAt)`, `raw = purity·conf/SCALE`; control by the same formula with `E` in place of `W` and `En` in place of `C` | How improbable the collisions are, tempered by how many there are. Zero chance reads high however small the share; `conf` keeps two lucky collisions from certifying on purity alone. `prior = SCALE`. |

**This choice is a policy, not a fact about the images.** Measured on 16 real works: `lift` raises true pairs 835 → 1492 median but raises impostors more, 5267 → 9210; best F1 barely moves, 0.53 → 0.57. Normalisation was **not** the bottleneck — the impostors genuinely collide. Excluding one mislabelled pair, `lift` puts 4/9 true pairs above the impostor ceiling against `proportion`'s 1/9.

#### 5.3.3 Placement coherence

A count of collisions cannot tell a paste from a coincidence: an impostor built from the same tileset collides just as often, only everywhere at once. **A paste agrees on one offset.**

1. Requires ≥ 3 hits.
2. Scale: for every pair of hits, the ratio of the B-side distance to the A-side distance, in Q8; pairs closer than 4 px on either side are skipped. Take the **median** — this needs no correspondence beyond the matches themselves.
3. Offset: for each hit, compute `(B − scale·A)`; count how many other hits fall within `tol = max(6, min(w_A, h_A, w_B, h_B) / 12)` of it. Keep the largest cluster.
4. `fraction = inliers·SCALE / hits`; `confidence = clamp(inliers·SCALE / 8)`; `value = fraction·confidence / SCALE`.
5. `measurable` iff `inliers ≥ 4`.

The confidence factor is not decoration: with four matches, one placement explains all four by arithmetic rather than by agreement.

#### 5.3.4 `shape`, `topology`, `runs`, `palette`

| Channel | Abstains when | Raw | Control |
|---|---|---|---|
| `shape` | either side stored no regions | injective greedy pairing by `shapePair`, summed, ÷ `min(\|X\|,\|Y\|)` | **none** (`control = 0`) — the null lives inside `shapePair` |
| `topology` | either side has < 3 boundaries | `ragRaw(shift 0)` | `min` over endpoint shifts 85, 128, 171 |
| `runs` | either side is flat (one bin ≥ 95% of its axis total, on all three axes) | `runRaw(rot 0)` | `min` over bin rotations 4, 8, 12 |
| `palette` | either side has < 2 entries | `min(palRaw(X,Y), palRaw(Y,X))` | `min` over quantile shifts 85, 128, 171 |

`shapePair(a,b)` — best of 64 alignments (32 rotations × 2 reflections) of the radial signature, scored against the **median** alignment as its own empirical null, then multiplied by three scale-free correctives:

```
v   = (median − best)·SCALE / median
asp = min(aspect)·SCALE / max(aspect)
iso = min(p²/area)·SCALE / max(p²/area)                 // isoperimetric
hol = holes equal ? SCALE : SCALE − 2500·|Δholes|
score = v · asp · iso · hol / SCALE³
```

A radial signature is scale-free by construction, which is exactly why it needs the aspect ratio and the isoperimetric quotient beside it — otherwise every roughly round blob matches every other roughly round blob.

`ragRaw`: greedy nearest-endpoint pairing with cost `|Δlo| + |Δhi| ≤ 32`, then a count-weighted Jaccard.
`runRaw`: `SCALE − Σ|Δbin|·SCALE / (3·510)` over 48 bins.
`palRaw`: greedy nearest with cost `2·|Δquantile| + |Δfreq| ≤ 96`, mass-weighted by frequency.

### 5.4 Scoring rules

Both are always computed; the `scoring` knob selects which one the verdict reads.

**`weighted`** — the v2.0 spec's rule. Mean of `value` over **measurable** channels only, weighted:

| local | shape | topology | runs | dct | palette |
|---|---|---|---|---|---|
| 35 | 25 | 15 | 10 | 10 | 5 |

**`gate`** — `min(evidence, corroboration)` where:
- `evidence` = the `local` channel value (or absent if it abstained);
- `corroboration` = the **upper median** of the measurable secondary channels, sorted ascending, index `len >> 1`;
- **replaced by placement coherence if that is higher.**

> **Why gate is the reference default.** A weighted sum lets one strong channel carry a certification on its own, and the channel most likely to be strong for the wrong reason — two portraits with a similar tonal range — is also the one with the largest weight. Requiring the collage channel *and* independent corroboration refuses that.
>
> **Why corroboration is a median and not a min.** An occluder covering a third of a work destroys the colour-boundary graph completely and *correctly*, while shape, runs and palette hold. A min over all six channels lets any single collapsed channel veto a true match — and occlusion is not a rare case, it is the commonest way a copy is dressed up. A median needs three of five to fail.
>
> **Why coherence counts as corroboration.** It answers a structurally different question from any of the five secondary channels — not "do these look alike" but "do the agreements agree with each other" — using data none of them touch. It is also the only corroboration available when a small work sits inside a large one, where every global channel is dominated by the host and correctly reads low.

### 5.5 Thresholds and verdicts

| Verdict | Score |
|---|---|
| Identical | byte-equal wires, or ≥ 8000 |
| Copy | ≥ 4500 |
| Suspected | ≥ 3000 |
| Related | ≥ 1500 |
| Unrelated | < 1500 |

**These constants were re-derived from 16 real platform works, not from fixtures**, and that distinction is the whole of their value. On this module's Rust sibling a synthetic corpus reported 11/11 true pairs and 0 false positives while the same code on 21 real works reported 2/16 — the classes did not shift, they *overlapped completely*.

At the reference defaults the real corpus separates cleanly at 3000: six of eleven true pairs sit above every impostor, and the strongest impostor sits at **2620**. `SUSPECTED` is set just above it.

**Phase 1** — an index-side fast reject on the level-0 DCT code alone: `l0 ≥ 7000` → straight to forensics; `≥ 2000` → partial global agreement, search locally; otherwise globally disjoint, search locally. **NOTE:** in the reference implementation Phase 1 is *descriptive only* — it is reported but does not gate. A production index **MUST** implement it as an actual reject or the O(1) claim is not earned.

## 6. Parameters

### 6.1 Full parameter table

| Knob | UI label | Reference default | Range | Effect |
|---|---|---|---|---|
| `scoring` | Scoring rule | `gate` | gate \| weighted | §5.4 |
| `evidence` | Evidence rule | `lift` | lift \| proportion | §5.3.2 |
| `confidenceAt` | Collisions for confidence | `16` | 2–48 | collisions at which `lift` trusts purity alone |
| `matteTol` | Backdrop slack | `24` | 0–64 | per-channel flood slack, §2.2 |
| `hammingT` | Fingerprint slack | `4` | 0–16 | bits of difference still counted a collision, out of 64 |
| `peakRadius` | Anchor spacing | `5` | 2–16 | radius of the strict-local-max test, §3.6.1 |
| `foldInvert` | Inversion invariance | `true` | bool | fold the complement into the canonical form, §3.6.3 |
| `keepDC` | Keep DC coefficient | `false` | bool | §3.1 |
| `ragEndpoint` | Topology endpoints | `quantile` (`'band'`) | quantile \| rank | §3.3 |
| `shapeLabels` | *(not exposed)* | `band` | band \| palette | §3.4 |
| `foldMatte` | *(not exposed)* | `true` | bool | §2.2 |
| `divideUpscale` | *(not exposed)* | `true` | bool | §2.3 |
| `localWindows` | *(not exposed)* | `[8, 16]` | — | §3.6.2 |
| `localCount` | *(not exposed)* | `64` | — | bag cap |

### 6.2 Calibrated operating point

The settings marked as best-performing in the 18 Aug 2026 run:

| Knob | Operating point | Reference default | |
|---|---|---|---|
| `scoring` | **weighted** | gate | ⚠ reversed |
| `evidence` | lift | lift | — |
| `confidenceAt` | **12** | 16 | ⚠ below the measured plateau |
| `matteTol` | 24 | 24 | — |
| `hammingT` | **7** | 4 | ⚠ reversed |
| `peakRadius` | **7** | 5 | ⚠ reversed |
| `foldInvert` | true | true | — |
| `keepDC` | **true** | false | ⚠ reversed |
| `ragEndpoint` | **rank** | quantile | ⚠ reversed |

### 6.3 What the operating point contradicts — read before adopting it

Six of the nine settings differ from values that were arrived at by isolated measurement. That does not make the operating point wrong; a combination can be better than the sum of its parts. It does mean **the combination has been observed to work, and the individual settings have not been re-verified inside it.** The lesson this project has already paid for once is stated in the source: *a configuration that works is not evidence that each of its settings is doing work.*

Specifically, against earlier isolated sweeps:

- **`confidenceAt` 12.** The sweep that introduced this knob took F1 from 0.67 to 0.71 at precision 1.00 and was **flat from 14 to 18** — a plateau, not a knife-edge. 12 sits outside it. Worth re-sweeping 10–20 at the new combination before fixing it.
- **`hammingT` 7 and `peakRadius` 7.** Both measured as *slightly costing* precision in isolation, and `peakRadius` trades directly against time: 9 vs 5 halves hashing time on the largest work for about a tenth of the F1. If 7 is genuinely better here, the interaction is with `scoring: weighted`, and that interaction is the thing to characterise.
- **`keepDC` true.** The recorded cost is index-side, not verdict-side: with DC retained, a sibling index had to compare 98.9% of the corpus because every bucket answered "is this picture bright". It may well improve pairwise scoring while destroying the Phase-1 fast reject. **If `keepDC` is adopted, §5.5's Phase 1 must be re-measured on the index, not on pairs.**
- **`ragEndpoint` rank.** This is the literal v2.0 spec reading, and it is the one setting whose failure mode is *specific*: palette rank does not survive a rebuilt palette, which is exactly the transform a recolouring copyist applies. Expect it to help on same-export pairs and hurt on recolours. The 16-work corpus contains few deliberate recolours, so it may simply not be testing this.
- **`scoring` weighted.** This is the largest single change. `weighted` lets one strong channel certify alone; `gate` refuses that by construction. Moving to `weighted` **raises the false-positive ceiling in a way the current corpus (0/125 impostors) is too small to detect.** The first hundred real moderation reports will.

**Recommendation.** Record the operating point as the current default *for pairwise scoring*, keep `gate` available, and re-run the per-knob isolation at the new combination before the operating point is baked into a Rust implementation. Every one of the six reversals is cheap to test and expensive to inherit.

### 6.4 Deviations from the v2.0 prose spec

Each is behind a knob; the reference default is whatever measured better.

| Deviation | Reason |
|---|---|
| `keepDC: false` | spec silent; DC's sign dominated the index bucket |
| RAG / shape / palette endpoints are luminance **quantiles**, not palette ranks | rank does not survive a rebuilt palette |
| Shape record 41 B, not the table's 36 B | the spec's table, field list and Rust struct disagree (36 / 40 / 41); the fields win |
| Palette entry 4 B, not 3 B | the spec spends 48 B against a 64 B budget; the fourth byte holds the quantile |
| DCT stored as sign + Gray-coded magnitude | makes all eight D4 symmetries computable from stored bits, zero extra bytes |
| Fingerprints canonical over D4 × {identity, complement} | inverted copies match; costs light/dark polarity |
| Anchors as a 128 B section appended after `local` | placement evidence; a count cannot answer "one offset or forty" |
| `localWindows = [8, 16]` | the spec offers both; a 48 px sprite needs the 8 |
| Matte gate = border-ring coverage ≥ 50% + area bounds | `perimeter·10 ≤ area` is not scale-free |
| Scoring = `min(local, median of 5 secondary)`, not a weighted sum | a weighted sum lets the highest-weighted channel certify alone |

## 7. Determinism requirements

A conforming implementation **MUST** produce byte-identical wires for identical input bytes on any architecture. That requires, non-negotiably:

1. Integer arithmetic only on the hash path; all intermediates < 2⁵³.
2. All sorts **total** — every comparator falls through to a value-derived tie-break, never to insertion or loop order. (Palette: population desc, key asc. RAG: count desc, key asc. Shapes: area desc, minY, minX. Candidates: key, hi, lo, x, y. Wire order: hi, lo.)
3. Cosine and popcount tables built from a series at load, not pasted.
4. `compare` symmetric by construction (§5.2).
5. No `Math.random`, `Date`, or locale anywhere in the module.

## 8. Measured behaviour and known limits

**Real corpus** — 16 platform works, 119×193 to 736×352, 11 inferred true pairs, 125 impostor pairs. At the reference defaults:

| Metric | Value |
|---|---|
| Certified true pairs | 5 / 11 |
| False positives | 0 / 125 |
| True pairs above every impostor | 6 / 11 |
| Strongest impostor score | 2620 |
| Precision | 1.00 |
| Recall | 0.45 |
| F1 | 0.71 |
| Hash time | ~440 ms/work (was ~600 before the separable max filter) |
| Compare time | ~2 ms/pair |

**Recall 0.45 is honest rather than tunable.** The six missed pairs are figures lifted out of complex scenes, backgrounds swapped wholesale, and extreme zooms. No knob setting recovered them, and loosening filters collapses precision. This is the finding that motivated Algorithm B.

**Two measurements worth carrying forward:**

- The change that most improved the real corpus — the anchor selection rewrite — made the synthetic corpus *worse* (28/49 → 22/49 cleared). This is the sharpest available evidence against tuning on fixtures.
- Real matches land at **5–11 collisions out of 64 with a chance count of exactly zero**. The signal is real, but the score reports a fraction of capacity, so an unambiguous match reads weak. This is why both evidence rules exist and why neither fixed it: the normalisation was not the bottleneck.

**Calibration debt.** Eleven true pairs is not a calibration set, and the cluster labels behind them were *inferred* from a contact sheet rather than supplied. One of them was corroborated independently at 326 RANSAC inliers — and one was proven *wrong* by the `lift` measurement before any human noticed. The thresholds **SHOULD** be re-derived on the first hundred real moderation reports.

## 9. Defects and dead code in the reference implementation

Recorded so a v3 does not inherit them.

| Item | Location | Status |
|---|---|---|
| `anchorPoints()` — the 2×2-junction detector plus its region-centroid fallback | lines 829–866 | **Dead code.** Never called; `contentPeaks` replaced it. Its 30-line comment block is valuable history and should be preserved as documentation, but **MUST NOT** be ported as code. |
| `round2()` | line 822 | Dead — only reachable from `anchorPoints`. |
| `MAGIC = 0x48504150` | line 27 | Unused constant. `serialize` writes the four bytes literally. |
| `controlRan: true` emitted twice in one object literal | `dctChannel`, `localChannel` | Harmless duplicate key; remove. |
| Anchor encode/decode dimension mismatch | §3.7 | Benign under the current coherence maths; **MUST** be resolved before anchor coordinates are used for anything else. |
| Phase 1 does not actually gate | §5.5 | Reported but not enforced. The index-side O(1) claim depends on implementing it. |
| `thumbnail16` fill = median of *distinct* palette luminances, unweighted by population | line 458–466 | Deliberate or not, this is not the median of the pixel-mass luminance. Worth a decision in v3. |

---

# Part II — Algorithm B: PAPH-L2

## 10. Overview

PAPH-L2 answers a narrower and harder question than Algorithm A: **is one work a geometric transform of a region of the other?** It stores nothing, indexes nothing, and compares two works directly by finding repeatable interest points, describing their local neighbourhoods, matching the descriptors, and then requiring the surviving matches to agree on **one** similarity transform.

That last step is the whole algorithm. Two works from the same genre, the same palette and the same artist will produce dozens of descriptor matches; only a real copy produces matches that agree on a single scale, rotation and translation. Geometry is what kills the same-genre false floor that defeats every appearance-based score, including Algorithm A's.

L2 is a compact ORB: multi-scale FAST-9 corners, intensity-centroid orientation, box-smoothed steered BRIEF-256, mutual-nearest-neighbour matching with a Lowe ratio test, and 4-DOF RANSAC.

**It is not a hash.** It cannot be stored, indexed, or put on a chain. It runs on candidate pairs.

## 11. Feature extraction — `analyze(image)`

### 11.1 Luminance

Draw the image to a canvas, read RGBA, and reduce to 8-bit luma:

```
luma = (77·r + 150·g + 29·b) >> 8
```

**NOTE — two divergences from Algorithm A, both to be unified in v3.**
1. No `+128` rounding term. Algorithm A uses `(77r + 150g + 29b + 128) >> 8`. The two therefore disagree by up to 1 LSB on every pixel.
2. **Alpha is discarded, not respected.** A transparent-background sprite composited onto a fresh canvas yields RGB = 0 where alpha = 0, so L2 sees a hard black region and keys on the **silhouette edge**. Algorithm A goes to considerable trouble (§3.6.2, the 75% opacity floor) specifically to prevent silhouette matching, because a lone sprite and the same sprite composited onto a host have different silhouettes and identical interiors. This is a genuine behavioural conflict between the two algorithms, not a cosmetic one.

### 11.2 Scale pyramid

```
LEVELS = [512, 394, 303, 233, 179, 138, 106]     // ≈1.3× per octave step, 4.8× span
```

Each level is a box-average downsample to that **width**, with height derived as `round(h·W/w)`. Levels wider than the source are skipped; there is no upsampling.

**NOTE.** The pyramid is indexed by **width alone**. A 736×352 work gets all seven levels; a 119×193 work gets exactly one (106), because every other level exceeds its width. A tall narrow work is therefore analysed at a single scale while a wide one is analysed at seven — which is a scale-coverage asymmetry that depends on aspect ratio rather than on size. Indexing the pyramid by `max(w,h)` would remove it. If every level is skipped, the native resolution is used as a fallback.

### 11.3 FAST-9 corner detection

For each pixel at least 3 px from the border, with `p` the centre value, `hi = p + 18`, `lo = p − 18` over the 16-point Bresenham circle of radius 3:

1. **Quick reject.** Test only points 0, 4, 8, 12. Require at least 3 brighter than `hi` **or** at least 3 darker than `lo`.
2. **Full test.** Require a contiguous arc of **≥ 9** circle points all brighter, or all darker. The arc may wrap (the loop runs to 24 over a 16-point circle).
3. **Score.** `Σ |v_k − p|` over all 16 circle points.

### 11.4 Non-maximum suppression and capping

Sort candidates by score descending. Walk them, maintaining an occupancy map on a grid of cell size `NMS_R = 4`; reject a candidate if **any** cell in its 3×3 grid neighbourhood is already occupied. Keep at most `KP_CAP = 420` per level.

**NOTE.** This is a grid-approximate NMS, not a true radius suppression: the effective exclusion distance varies between 4 and 12 px depending on where a keypoint falls within its cell. It is fast and it is deterministic, but it is not translation-equivariant — a 2 px shift can change which of two nearby corners survives. For an algorithm whose entire premise is finding the *same* points in two images, this is a real (if empirically tolerable) weakness.

After all levels are processed, the pooled keypoint list is sorted by raw FAST score and truncated to 420 **in total**. The FAST score is not scale-normalised, so this cross-level ranking compares scores computed at different resolutions.

### 11.5 Orientation

Intensity centroid over a disc of radius 7:

```
m10 = Σ dx · boxAvg(x+dx, y+dy, r=1)
m01 = Σ dy · boxAvg(x+dx, y+dy, r=1)      over dx²+dy² ≤ 49
θ   = atan2(m01, m10)
```

Sampling through a 3×3 box average rather than the raw pixel is what makes this survive dithered pixel art, where a raw-pixel centroid is dominated by the dither pattern.

### 11.6 Steered BRIEF-256

`θ` is quantised to 64 bins. The test pattern is 256 fixed `(ax, ay, bx, by)` quadruples generated once at load from an LCG seeded `0x1234567`, with each coordinate an approximately-Gaussian draw (sum of three uniforms) scaled by `0.7·PATCH_R` and clamped to ±15.

Each bit is:

```
bit_i = boxAvg(rotated a_i, r=2) < boxAvg(rotated b_i, r=2)
```

**The `r=2` box average is load-bearing.** A raw two-pixel comparison on dithered pixel art measures the dither, not the drawing. Comparing 5×5 means is what makes BRIEF work on this content at all.

Descriptor = 256 bits as 8 × u32. Keypoint position is stored **normalised per level**: `nx = x / levelWidth`, `ny = y / levelHeight`.

## 12. Descriptor matching — `match(A, B)`

Brute force, 256-bit Hamming distance.

1. **Forward pass.** For every `i ∈ A`, find best `j₁` and its distance `d₁`, plus the second-best distance `d₂` over all of B.
2. **Backward pass.** For every `j ∈ B`, find the best `i` over all of A.
3. **Accept** the correspondence `i ↔ j₁` iff all three hold:
   - `d₁ ≤ HAM_MAX = 88` (of 256 bits);
   - `d₁ < LOWE · d₂`, `LOWE = 0.82` — the ratio test;
   - `backward[j₁] == i` — mutual nearest neighbour.

**NOTE — this is directional.** The ratio test is applied only from A's side. `match(A,B)` and `match(B,A)` therefore accept different correspondence sets. Algorithm A fixes exactly this class of bug structurally (§5.2); Algorithm B has not. A v3 **MUST** either apply the ratio test on both sides or impose a canonical argument order.

Cost: `2 · |A| · |B| · 8` popcounts ≈ 2.8 M operations at full caps.

## 13. Geometric verification — RANSAC

If fewer than `MIN_INLIERS = 8` correspondences were accepted, return no match immediately.

**NOTE.** `MIN_INLIERS` is misnamed: it gates the count of *accepted correspondences*, before RANSAC runs. The inlier count is gated separately by `THRESHOLD` (§14).

Then, seeded `xorshift32(0xC0FFEE)`, for `RANSAC_ITERS = 900` iterations:

1. Draw two correspondences `p`, `q` at random.
2. Skip if `‖q_A − p_A‖ < 0.05` (normalised) — a degenerate baseline.
3. `s = ‖q_B − p_B‖ / ‖q_A − p_A‖`. Skip if `s < 0.2` or `s > 5`.
4. Recover rotation from the normalised dot and cross products; build the 4-DOF similarity

   ```
   R = s·[[cosθ, −sinθ], [sinθ, cosθ]],   t = p_B − R·p_A
   ```
5. Count inliers: `|Rx + t − B| < EPS = 0.038` on **each axis independently**.
6. Keep the model with the most inliers.

Finally, reject the whole match unless `inliers / accepted ≥ MIN_RATIO = 0.22`.

**No least-squares refit on the inlier set is performed.** The reported scale and rotation come from a two-point minimal sample, so they are indicative, not measured. A v3 should refit.

### 13.1 The normalisation defect — the most consequential finding in Part II

Keypoints are normalised **per axis**: `nx = x/w`, `ny = y/h`. A true similarity transform in *pixel* space therefore becomes, in normalised space, an **anisotropic** map whenever the two works have different aspect ratios:

```
s_x / s_y  =  (w_A / h_A) / (w_B / h_B)
```

The 4-DOF model cannot represent that. The mismatch is absorbed entirely by the residual, which is why `EPS` has to be as loose as 3.8% of the image dimension.

This is not a corner case. It is the *main* case: a crop has a different aspect ratio from its source by definition. For the corpus extremes — 736×352 (aspect 2.09) against 119×193 (aspect 0.617) — the implied axis-scale ratio is **3.4×**, far outside anything `EPS` can absorb.

**Testable prediction.** The two pairs L2 currently misses (both involving the isolated figure `RoWLrDezuDf`, sitting at 4–5 inliers against a threshold of 7) should be pairs with strongly mismatched aspect ratios. If so, the fix is one line — normalise **both** axes by the same divisor, e.g. `max(w, h)`, keeping coordinates aspect-true — and it should simultaneously allow `EPS` to tighten, buying precision headroom.

This should be measured before any v3 architecture is committed to. It is cheap, and if it holds it changes what the fusion layer needs to do.

## 14. Verdict

```
MATCH — same artwork    if inliers ≥ THRESHOLD
NO MATCH                otherwise
```

| Environment | Threshold | Why |
|---|---|---|
| In-browser (Canvas decode) | **7** | Canvas decode + resize yields fewer keypoints than `sharp` |
| Node harness (`sharp` decode) | **8** | The calibrated value on the 16-work corpus |

Reporting bands (cosmetic): ≥40 strong, ≥15 medium, ≥7 weak-but-accepted.

The threshold difference between environments is worth naming plainly: **the decoder is part of the algorithm.** Two implementations of L2 that disagree only in how they decode a PNG will disagree on verdicts near the threshold.

## 15. Parameters

| Constant | Value | Role |
|---|---|---|
| `LEVELS` | 512, 394, 303, 233, 179, 138, 106 | pyramid widths, ≈1.3× steps |
| `FAST_T` | 18 | FAST intensity threshold (of 255) |
| `NMS_R` | 4 | NMS grid cell, px |
| `KP_CAP` | 420 | keypoints per level **and** in the pooled total |
| `PATCH_R` | 15 | BRIEF pattern radius |
| `N_BITS` | 256 | descriptor length |
| `LOWE` | 0.82 | ratio test |
| `HAM_MAX` | 88 | absolute descriptor distance cap, of 256 |
| `RANSAC_ITERS` | 900 | hypotheses |
| `EPS` | 0.038 | inlier tolerance, normalised, per axis |
| `MIN_INLIERS` | 8 | minimum **accepted correspondences** before RANSAC |
| `MIN_RATIO` | 0.22 | minimum inlier fraction of accepted |
| `THRESHOLD` | 7 (browser) / 8 (`sharp`) | inliers required for a MATCH verdict |
| RNG seed | `0xC0FFEE` | xorshift32, reseeded per comparison |

## 16. Determinism — and why L2 is not consensus-safe

The RANSAC is seeded, so **one implementation is reproducible run-to-run**. That is the only determinism guarantee L2 offers.

It **MUST NOT** be placed on a consensus path, for four independent reasons:

1. **Floating point everywhere.** `atan2`, `hypot`, division, `Math.round` on floats. ECMAScript does not require `Math.atan2` to be correctly rounded — it is implementation-approximated — so two conforming engines may differ in the last ulp, and a quantised orientation bin sitting on a boundary turns that into a different descriptor.
2. **Canvas decode is implementation-defined.** Colour management, premultiplied alpha handling and resampling differ across browsers. The empirical proof is already in the constants: the same algorithm needs threshold 7 under Canvas and 8 under `sharp`.
3. **Cross-level keypoint ranking** compares un-normalised FAST scores from different resolutions, so a marginal difference in downsampling changes which 420 keypoints survive.
4. **Asymmetry** (§12) means the verdict depends on argument order.

**Conclusion for the architecture:** Algorithm A is the on-chain artefact. Algorithm B is an off-chain adjudicator whose output is an *assertion by an operator*, not a fact any node can independently reproduce bit-for-bit. If a chain-verifiable geometric stage is ever required, L2 must be re-derived in fixed point with an integer `atan2` and a specified decoder — a substantial piece of work, and one to scope deliberately rather than discover.

## 17. Measured behaviour and known limits

Same 16-work real corpus, 11 inferred true pairs:

| Metric | Value |
|---|---|
| Recall | **9 / 11 = 0.82** |
| Precision | 1.00 |
| F1 | 0.90 |
| True-pair inlier range | 9 – 280 |
| Strongest impostor | 5 inliers |
| Verified on the browser sample set | 6 / 6 correct |

**L2 recovers four of the six pairs Algorithm A could not**, and they are precisely the hard class: a figure lifted out of a complex scene, and heavy zoom crops.

| Recovered pair | Nature |
|---|---|
| scale-face portraits ↔ jungle scene (full 3-way cluster) | figure lifted from a scene |
| figure from a mansion scene ↔ HD portrait | figure lifted from a scene |
| money zoom-crop | extreme zoom |

**Still missed: two pairs, both involving the isolated figure `RoWLrDezuDf`**, at 4–5 inliers — the noise floor. Genuinely borderline. See §13.1 for the aspect-ratio hypothesis, which is the first thing to test before concluding these need a different class of method.

**A learned embedding was tested and rejected.** DINOv2-small via `transformers.js`, normalised cosine: **27% recall at 100% precision — worse than L2's 82%** — and it does not recover the two missed pairs (0.29 and 0.16 cosine, both far below the ~0.50 floor where *all* same-subject portraits cluster). General **semantic** embeddings have exactly the genre-floor problem geometry was introduced to solve, so they are the wrong tool. Only a **copy-detection-trained** embedding (SSCD-class, entropy-regularised) could plausibly help, and the figure-from-mansion-scene pair may simply be intractable at this scale.

## 18. Defects in the reference implementation

| Item | Severity | Note |
|---|---|---|
| Per-axis normalisation breaks the similarity model (§13.1) | **High** | One-line fix; test before v3 architecture is fixed |
| Alpha discarded → silhouette matching (§11.1) | **High** | Directly contradicts Algorithm A's opacity floor |
| `match()` is asymmetric (§12) | **Medium** | Algorithm A already solved this class of bug structurally |
| No least-squares refit after RANSAC (§13) | **Medium** | Reported scale/rotation come from a 2-point sample |
| Pyramid indexed by width, not `max(w,h)` (§11.2) | **Medium** | Aspect-dependent scale coverage |
| `MIN_INLIERS` gates correspondences, not inliers (§13) | **Low** | Naming only, but it has already caused confusion |
| Grid-approximate NMS is not translation-equivariant (§11.4) | **Low** | Effective radius varies 4–12 px |
| Luma lacks the `+128` rounding term (§11.1) | **Low** | Trivial; unify with Algorithm A |

---

# Part III — Comparison, and what a v3 must reconcile

## 19. Invariance matrix

| Transform | PAPH-BOF | PAPH-L2 |
|---|---|---|
| Integer nearest-neighbour upscale | **exact** — divided out at ingest, factor in the header | tolerated by the pyramid |
| Arbitrary rescale | partial (area-majority) | **yes** — recovered as model scale, 0.2×–5× |
| Recolour / palette rebuild | **yes** — quantiles, absolute RGB discarded | partial — luma-only, survives hue shifts, not tone inversion |
| Monotone tone curve | **yes** — quantiles are ordinal | partial |
| Colour inversion | **yes** — complement folded into the canonical form | no |
| 90° rotation | **yes** — D4 canonical, and reports *which* symmetry | **yes** — recovered as model θ |
| Arbitrary rotation | no | **yes** |
| Mirror | **yes** | no (BRIEF is not reflection-invariant) |
| Crop | partial — local bag survives, global channels do not | **yes** |
| Composite / collage (figure into a scene) | weak — the motivating failure | **yes** — the decisive advantage |
| Background replaced | no | partial |
| Occlusion | partial — median corroboration tolerates one collapsed channel | **yes** — inliers on the visible part |
| Aspect-ratio change | n/a | **no** — §13.1 |

## 20. Cost model

| | PAPH-BOF | PAPH-L2 |
|---|---|---|
| Per-work cost | ~440 ms hash, produces 1357 B | ~ feature extraction only; nothing stored |
| Per-pair cost | ~2 ms | 2·\|A\|·\|B\|·8 popcounts + 900 RANSAC iterations |
| Scales to a corpus of N | O(1) index lookup + O(candidates) | **O(N) per query** — no index exists |
| Storage per work | 1357 bytes | 420 × 32 B ≈ 13 kB if descriptors were cached |
| Consensus-safe | yes | no |

**This is the entire argument for keeping both.** L2 is strictly the better detector and strictly the worse *system*. It cannot answer "is this new upload a copy of anything in the corpus" without comparing against everything.

## 21. What each algorithm is actually for

Measured end-to-end on the same corpus, all at 100% precision:

| Stage | Method | Recall |
|---|---|---|
| Whole-image PAPH core | global descriptor only | 0.18 |
| L1 | gradient-hash patches + RANSAC | 0.45 |
| **PAPH-BOF (this spec, Part I)** | burst-weighted bag-of-features + coherence | 0.45 |
| **PAPH-L2 (this spec, Part II)** | ORB-style keypoints + RANSAC | **0.82** |
| L3 (DINOv2) | semantic embedding | 0.27 — rejected |

**The two levers are genuinely different, and that is why fusing them is worth doing rather than simply replacing A with B:**

- **Geometry (L2) kills the false floor.** Two works of the same genre, palette and subject collide constantly on appearance. Requiring one consistent transform is what separates them, and nothing in Algorithm A does that job as well.
- **Burst weighting (BOF) fixes the weak-absolute-score problem.** Real matches land at 5–11 collisions of 64 with a chance count of exactly zero. Weighting each match by how generic its code is inside its *own* work converts that into a score without needing an outside corpus.
- **Only BOF is indexable, recolour-invariant, mirror-invariant and consensus-safe.**

## 22. Interfaces the merge will need

The seven concrete conflicts a v3 has to resolve, in the order they bind:

| # | Conflict | Resolution direction |
|---|---|---|
| 1 | **Arithmetic.** A is integer-only and chain-verifiable; B is float and is not. | Keep the boundary explicit. The chain stores the BOF wire. B's verdict is an operator assertion, not a consensus fact — unless B is re-derived in fixed point, which should be a scoped decision, not a discovery. |
| 2 | **Alpha.** A treats transparency as a first-class value and enforces a 75% opacity floor precisely to avoid silhouette matching. B flattens alpha to black and keys on silhouettes. | Unify on A's semantics: composite onto a neutral fill or mask keypoints in transparent regions. Then re-measure B — its 0.82 was achieved *with* the silhouette signal, and some of that recall may be silhouette-derived. |
| 3 | **Coordinates.** A encodes anchors against the normalised canvas and decodes against the original; B normalises per axis. Neither is aspect-true. | One convention: aspect-true normalisation by `max(w,h)`, applied to both. §13.1 predicts this alone may recover B's two missed pairs. |
| 4 | **Symmetry.** A guarantees `compare(x,y) == compare(y,x)` structurally. B does not. | Adopt A's discipline wholesale: canonical argument order at the top, directional outputs mapped back at the bottom. |
| 5 | **Nulls.** Every A channel reports a chance floor and may abstain. B reports a bare inlier count with no null at all. | B needs a declared null before it can be fused — the natural one is inliers under a permuted correspondence set. Without it, fusion is adding an improbability to a count. |
| 6 | **Currency.** A scores on 0–10000; B counts inliers 0–280. | Map B into A's `chanceCorrect` shape, or define an explicit two-key verdict. Do not average them. |
| 7 | **Luma.** `+128` rounding term present in A, absent in B. | Trivial; unify. |

**Recommended architecture** — the shape the measurements support:

```
Stage 0   BOF hash at upload            1357 B, integer, on-chain, ~440 ms
Stage 1   Index fast-reject             level-0 DCT bucket → candidate set
              (requires Phase 1 to actually gate — §5.5 — and is the
               setting keepDC:true most threatens — §6.3)
Stage 2   BOF pairwise scoring          ~2 ms/pair. Recolour, inversion,
                                        mirror and D4 channel. Certifies
                                        the clean cases outright.
Stage 3   L2 geometric adjudication     on Stage-2 survivors and on
                                        Stage-2 near-misses. The collage,
                                        crop and zoom cases.
Stage 4   Human moderation queue        with the reported symmetry, the
                                        recovered scale/rotation, and the
                                        drawn correspondences as evidence
```

Stages 2 and 3 are complementary, not redundant: Stage 2 catches what Stage 3 structurally cannot (recolour, inversion, mirror) and Stage 3 catches what Stage 2 structurally cannot (collage, crop, arbitrary rotation).

## 23. Open calibration debt

Carried forward into v3. None of these is blocking; all are cheap relative to what they de-risk.

1. **Ground truth is inferred, not supplied.** The 11 true pairs come from clusters read off a contact sheet. One was independently corroborated at 326 RANSAC inliers; one was proven *wrong* by the `lift` measurement before any human noticed — the bag-of-features score had the answer before the labels did. **Confirming the labels is the single highest-value input available**, and it is a human task, not a compute task.
2. **Eleven true pairs is not a calibration set.** Every threshold in this document — 8000/4500/3000/1500, 7/8 inliers — should be re-derived on the first hundred real moderation reports.
3. **The §6.2 operating point needs per-knob isolation at its own combination** (§6.3). Six reversals, each cheap to test and expensive to inherit.
4. **`scoring: weighted` raises the false-positive ceiling** in a way a 125-impostor corpus cannot detect. This is the specific risk to watch in production.
5. **The aspect-ratio hypothesis (§13.1)** should be tested before the fusion architecture is fixed, because it may change what Stage 3 needs to do.
6. **L2's recall was measured with silhouette signal present** (§22, conflict 2). Re-measure after alpha semantics are unified.
7. **`sharp` is still on the L1/L2 decode path.** The in-house integer area-downscale needs to be swapped back in for the WASM path.
8. **RANSAC is now seeded**, and a CI gate exists that fails the build if L2 recall < 0.75 or precision < 1.00. Keep it; extend it to Algorithm A's precision.

---

## Appendix A — Complete byte map, PAPH-BOF wire

```
0x0000  ┌─ 16 B ─ header ────────────────────────────────────────────┐
        │ 00-03 "PAPH"   04 ver   05 flags   06-07 w   08-09 h       │
        │ 0A scale   0B palN   0C ragN   0D shapeN   0E localN       │
        │ 0F xor(0x0010..0x054C)                                     │
0x0010  ├─ 256 B ─ hierarchical DCT ─────────────────────────────────┤
        │ 0x0010 +64  L0   16×16, 256 coef @ 2 b                     │
        │ 0x0050 +64  L1   4 × (8×8, 64 coef @ 2 b), 16 B each       │
        │ 0x0090 +128 L2   16 × (4×4, 16 coef @ 4 b), 8 B each       │
0x0110  ├─ 64 B  ─ identity palette   16 × [rank, freq, lumOrd, q]   │
0x0150  ├─ 128 B ─ sparse RAG         32 × [lo, hi, count u16 LE]    │
0x01D0  ├─ 205 B ─ shape signatures    5 × [area u32, per u16,       │
        │                                   aspect u16, holes u8,    │
        │                                   radial 32 B]             │
0x029D  ├─ 48 B  ─ run-length geometry 3 axes × 16 log bins          │
0x02CD  ├─ 512 B ─ local fingerprints 64 × [hi u32 LE, lo u32 LE]    │
0x04CD  ├─ 128 B ─ anchor positions   64 × [x/255, y/255]           │
0x054D  └─ end (1357 B) ─────────────────────────────────────────────┘
```

## Appendix B — Verdict quick reference

**PAPH-BOF** — score on 0–10000, from `gate` or `weighted`:

| ≥ 8000 | ≥ 4500 | ≥ 3000 | ≥ 1500 | < 1500 |
|---|---|---|---|---|
| Identical | Copy | Suspected | Related | Unrelated |

**PAPH-L2** — RANSAC inliers:

| ≥ 40 | ≥ 15 | ≥ 7 (browser) / 8 (`sharp`) | below |
|---|---|---|---|
| MATCH, strong | MATCH, medium | MATCH, accepted | NO MATCH |

*End of PAPH-SPEC-002.*
