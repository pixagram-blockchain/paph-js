# ANALYSIS-002 — The geo-solo arm and shared assets

Status: evidence, not a spec change.  Recorded after M6 landed (2026-08-19),
before M7 validation.  Nothing in the engines or in CAL-003-PROPOSED changed
because of this note; it exists so the decision it forces is made on numbers
rather than on the development corpus's silence.

## 1. What prompted it

M6's post-landing sweep asked whether the geo-solo inlier floor
(`thresholds[7]`, 11 in CAL-003-PROPOSED) could be lowered to recover review
positives.  On the 496-pair corpus the answer looked free:

```text
floor  false certs  B cert/at-review   C+D cert/at-review   positives in review
   8        0        100.0% / 100.0%     59.3% / 81.5%              6
   9        0         95.5% / 100.0%     59.3% / 81.5%              7
  11        0         95.5% / 100.0%     55.6% / 81.5%              8   (shipped)
  14        0         81.8% / 100.0%     51.9% / 81.5%             12
```

Zero false certifications at every floor, including 8.  That result is
worthless, and the reason is the important part:

```text
corpus negatives                       445
  with an accepted geometric model       0
  highest weak-signal inlier count       3   (A3×J1)
```

No negative in the development corpus ever reaches verified geometry, so the
solo floor never fires against one.  The corpus cannot price this parameter
at any value between 8 and 256.  "fc 0" here measures the corpus, not the
guard.

## 2. The missing case, constructed

The case the corpus lacks is the everyday one: two genuinely unrelated works
that both embed the SAME asset — a licensed tile, a stock sprite, a shared
background element.  Semi-synthetic pairs were built by pasting one textured
region from a donor work into two unrelated corpus works at different
positions, with direct, mirrored and 2× variants; 72 pairs over 3 donors,
4 base pairs and asset sizes 96/128/160 px on 300–400 px canvases (9–28% of
canvas area).

```text
asset size   pairs with an accepted model   max inliers
   96 px               2 / 24                    13
  128 px              11 / 24                    16
  160 px              20 / 24                    25

certified Copy outright under CAL-003-PROPOSED: 27 of 72
every one of them: basis = geometric (solo), topology class 2
```

A shared 96 px asset — 9% of a 320 px canvas — is already enough to certify
two unrelated works as a Copy on geometry alone.

## 3. Why no threshold fixes it

The obvious repairs were measured and none separates the classes.

Coverage does not: shared-asset negatives reach coverage 3125–4375, and
genuine corpus positives C1×C2 (3750) and D1×D2 (4375) sit inside that band.

A topology-split floor does not: on the corpus, the 12 solo certifications
that come from a localized single model (class 2) span 11–41 inliers, while
the synthetic leaks span 10–25.  The bands overlap.

```text
class-2 floor 16 → 6 corpus positives lost      class-2 floor 24 →  8 lost
class-2 floor 30 → 10 corpus positives lost     class-2 floor 40 → 10 lost
```

The reason is not a tuning failure.  A localized verbatim region shared
between two images produces the same geometric signal whether the region was
licensed from a tileset or lifted from the other work.  The difference is
provenance, and provenance is not in the pixels.

## 4. The decision this forces

Two coherent positions; they are product and legal positions, not
engineering ones, and the engine can implement either.

**Option A — keep the arm as shipped.**  `Copy` asserts "verbatim shared
geometry", not "plagiarism", and licensed-asset cases are handled by appeal.
Corpus behaviour is M6's as landed (B 21/22 certified, C+D 15/27, review
holds the rest).  Accepts that shared-asset pairs certify.

**Option B — a localized single model may not certify alone.**  Solo
geometric certification requires a dominant or multi-model topology
(class ≥ 3); a class-2 model caps at Suspected without structural
corroboration.  This closes all 27 synthetic leaks — every one was class 2 —
at a measured corpus cost:

```text
                       as shipped      option B
B  certified            21 / 22        16 / 22
C+D certified           15 / 27         8 / 27
all positives           38             26
demoted to review: B1×B2 B2×B3 C1×C2 F1×F3 F2×F3 G1×G3 G1×G5 G1×G7
                   G3×G6 G3×G7 G4×G6 G6×G8
```

Option B is a heavy recall cost on this corpus, and the corpus is small and
mine, not sourced.  It should not be adopted on these numbers alone.

## 5. What M7 must answer

1. Is "two unrelated works embedding one licensed asset" a NEGATIVE for
   Pixagram?  Until a human answers that, the 27 synthetic pairs above are
   unlabelled, not false certifications.
2. Real shared-asset pairs — tileset users, asset-pack buyers — sourced the
   way §19.2 sources everything else, so the overlap in §3 can be measured on
   real provenance instead of paste jobs.
3. Whether `Copy` should be split, so the arm can say "verbatim shared
   region, provenance undetermined" without either certifying plagiarism or
   discarding a true signal.

Until then CAL-003 keeps its `-PROPOSED` suffix and the arm keeps its shipped
floor of 11.  Scripts: `corpus-test/sweep41.mjs`, `floor-evidence.mjs`,
`shared-asset.mjs`, `asset-ladder.mjs`, `coverage-sep.mjs`, `solo-arm.mjs`.
