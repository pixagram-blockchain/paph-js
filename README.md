# @pixagram/paph-js

**PAPH 5.1** — an integer-only perceptual hash for detecting plagiarised
pixel art, with a calibrated three-axis comparator on top of it.

One wire (version 5). One comparator (51). One shipped calibration
(`CAL-051-PROVISIONAL`). JavaScript reference only in this release — the
golden vectors in `docs/golden/` are the contract the Rust/WASM engine
will be held to.

[github.com/pixagram-blockchain/paph-js](https://github.com/pixagram-blockchain/paph-js) ·
spec: `docs/SPEC-005.1.md`

## What it answers

Given two pixel-art images, `compare` returns a verdict — `Identical`,
`Copy`, `Related`, `Suspected`, `Unrelated`, or `Indeterminate` — with the
evidence that produced it: seven structural channels, a staged D4-similarity
geometry stage with an inversion family, and a diversity axis that demotes
repetition-driven matches. Everything is integer arithmetic; the same bytes
in give the same bytes out, on every platform, every time.

The comparator survives what pixel-art plagiarists actually do: any of the
eight D4 transforms (rotations, mirrors, transposes), color inversion,
tone shifts, nearest-neighbour upscales, crops pasted into new
compositions — and combinations, including D4-plus-inversion.

## Install and use

```
npm install @pixagram/paph-js
```

```js
// CommonJS
const { hash, compare } = require('@pixagram/paph-js');
// ESM
import { hash, compare } from '@pixagram/paph-js';

const a = hash(rgbaPixels, width, height);   // { t1, t2, detail }
const b = hash(otherPixels, w2, h2);
const report = compare(a, b);
console.log(report.verdict, report.evidenceClass, report.assetRisk.level);
```

`t1` is 2560 fixed bytes built for index search (`screen(a, b)` runs on
Tier 1 alone); `t2` is 32 + 32n bytes of evidence keypoints, n ≤ 512. Store
both; compare accepts `{ t1, t2 }` pairs or bare Tier-1 buffers.

Subpath imports: `@pixagram/paph-js/wire` (extraction only),
`@pixagram/paph-js/comparator` (comparison only). Both are UMD — use
default imports from ESM.

## Browser

`npm run bundle` writes `dist/paph53.browser.js` (no dependencies, attaches
`window.PAPH51`, byte-conformant with the Node build). Then open
`demo/playground.html`: drop an image on side A, derive side B with one
of the transform buttons (or drop a second image), and read the full
verdict — geometry models by name, channel evidence, the report JSON.
Everything runs in the tab; nothing is uploaded.

## Calibration

The shipped profile is `CAL-051-PROVISIONAL`: thresholds and LUTs set from
the conformance fixtures, honest about not having seen a production corpus.
`tools/calibrate.cjs` fits a real profile from a labelled corpus:

```
node tools/calibrate.cjs corpus.json outdir            # draft
node tools/calibrate.cjs corpus.json outdir --bless    # release, if gates pass
```

`corpus.json` lists families of images (same work within a family,
unrelated works across). The SPEC-005.1 §24.4 gates — at least 24 families,
60 images, 60 positive pairs, 10 measurable positives per channel — must
all pass before the tool will emit a non-provisional profile. Fitted
profiles round-trip through `profileEncode`/`profileDecode` and are passed
to `compare(a, b, { profile })`.

## Conformance

```
npm test
```

runs five suites: wire (parse/serialize, D4 algebra, determinism),
assignment (the 004.2 exact objective against the dense oracle), comparator
(19 verdict scenarios including D4×inversion composites, crops, repetition),
golden (13 frozen vectors, tier hashes plus entire reports field-for-field),
and the PNG tool codec. `npm run golden` regenerates the vectors — only
lawful on a spec bump.

## License

MIT © Pixagram SA.
