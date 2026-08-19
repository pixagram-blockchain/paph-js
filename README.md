# @pixagram/paph-js

**PAPH 4.1** — an integer-only perceptual hash for detecting plagiarised pixel art, with a calibrated comparator on top of it.

[github.com/pixagram-blockchain/paph-js](https://github.com/pixagram-blockchain/paph-js)

Two independent engines — JavaScript, and Rust compiled to WebAssembly — produce **byte-identical wires** and **identical verdicts**.

```
$ npm run parity

tier 1 and tier 2 wires, byte for byte
  PASS 96x96                3952 + 2712 B,   67 keypoints
  PASS 160x120              3952 + 10232 B, 255 keypoints
  PASS 220x170              3952 + 10272 B, 256 keypoints
  PASS 128x128 with alpha   3952 + 7952 B,  198 keypoints
  PASS 301x97 with alpha    3952 + 10272 B, 256 keypoints
  PASS 64x64                3952 + 272 B,     6 keypoints
  PASS 400x300              3952 + 10272 B, 256 keypoints

25 passed, 0 failed
```

That is the point of the whole design, not a nice extra. An index, a consensus rule, and a moderator's appeal all rest on two parties being able to recompute the same answer and get the same bytes. The Rust is a from-scratch rewrite against the specification rather than a transliteration of the JavaScript, which is what makes the agreement mean something.

---

## Two layers, versioned separately

The package version tracks the **comparator** — 4.1, the thing that decides what a pair of wires *means*. The **wire** underneath it is v3 and stays v3, because measurements should not move every time a judgement does.

| layer | version | what it is | changes when |
|---|---|---|---|
| wire | **v3** | 3952-byte Tier 1, 32 + 40n Tier 2, eleven sections, CRC-32 | only with a new wire specification |
| comparator | **4.1** (field value `41`) | channels, nulls, geometry, the verdict lattice | when the evidence says the judgement should |
| calibration | **CAL-xxx** | one immutable artefact with a SHA-256 identity | whenever a corpus is re-derived |

That split is visible in the source: `src/paph3.*` is the wire engine (SPEC-003), `src/paph4.*` is the comparator (SPEC-004 and its 4.1 amendment). A 4.1 package carrying a `paph3` module is not a leftover — it is the wire holding still while the judgement moves.

A verdict cites its comparator *and* its calibration identity, so a disputed decision can be recomputed exactly as it was made. A calibration profile targets exactly one comparator, and every other comparator refuses it — in both directions, tested in both engines.

Comparator 4.1 adds four things to comparator 4, which stays frozen, shipped and fully supported:

- **weak-signal geometry** — when no model clears the acceptance floor, the best single verified model still counts as evidence, with the whole control family measured the same way. Reported as `geoWeakInliers`, and never enough on its own to certify.
- **per-channel calibration** — container-2 profiles carry nine monotone tables, one per structural channel, instead of three shared ones.
- **assignment on the edge-induced subgraph** — the local matcher ignores rows and columns with no edge. Same cardinality, same total cost, different tie-breaking; that difference is exactly why it is a new comparator and not a patch.
- **a stage-1 screen** — correspondence pools only, no verification, no verdict. A pair the screen rejects is *unscreened*, never *unrelated*.

---

## Install

```sh
npm install @pixagram/paph-js
```

No dependencies. Node 18+, or any browser with WebAssembly.

## Quick start

Hash two works, then ask the comparator what they are:

```js
import { hashChecked, compareV41, cal003 } from '@pixagram/paph-js';

const profile = cal003();                            // CAL-003-PROPOSED, comparator 41
const a = hashChecked(imageA, {}, profile.limits);   // { t1: 3952 B, t2: 32 + 40n B }
const b = hashChecked(imageB, {}, profile.limits);

const r = compareV41(a.t1, a.t2, b.t1, b.t2, {}, profile);

r.verdict;          // 'Copy'
r.class;            // 'geometric only — mirrored crop / collage class'
r.basis;            // ['geometric']
r.structural;       // 3382   (0..10000)
r.totalInliers;     // 21
r.geoWeakInliers;   // 0      — non-zero means the weak signal carried it
r.calibrationId;    // the profile identity this verdict was made under
```

`hashChecked` accepts an `ImageData`, `{ px, w, h }`, `{ pixels, width, height }`, or `(bytes, width, height)`, and enforces the profile's declared size limits before doing any work.

If you only want the wire, the v3 engine is unchanged and still the fastest route:

```js
import { load } from '@pixagram/paph-js';
const { Paph, backend } = await load();         // 'wasm' where available, 'js' otherwise
const fp = new Paph().hash(imageA);
```

Pin a layer if you would rather not branch:

```js
import { Config, Paph } from '@pixagram/paph-js/wire';        // v3 engine, synchronous
import { init, Paph }   from '@pixagram/paph-js/wasm';        // v3 engine, await init()
import { compareV41 }   from '@pixagram/paph-js/comparator';  // comparator 41
import calCore          from '@pixagram/paph-js/calibration'; // the tuning loop
```

`./js` and `./v41` remain as aliases of `./wire` and `./comparator`; `./v4` pins the frozen comparator.

### Screen before you compare

At index scale, most pairs are not worth a full comparison. The screen answers "could these possibly share geometry?" from the correspondence pools alone:

```js
import { screenV41 } from '@pixagram/paph-js';

const s = screenV41(a.t1, a.t2, b.t1, b.t2, {}, profile);
if (s.pass) {
  const r = compareV41(a.t1, a.t2, b.t1, b.t2, {}, profile);
}
// s.pass === false means UNSCREENED — not "unrelated", and not a verdict.
```

---

## Try it without writing any code

Open **`demo/paph41-playground.html`** by double-clicking it, and press **Load the worked example**.

Eleven works are generated on the spot — an exact duplicate, a recolour, a 2× upscale, two crops, an element reused in a new scene, two unrelated works, and a pair that shares one pasted tile — every relationship already labelled. Nothing uploads, nothing is fetched, and no third-party art ships in this package.

This is what it says out of the box, under `CAL-003-PROPOSED`:

| pair | label | verdict | basis | structural | inliers |
|---|---|---|---|---|---|
| A1 original × A2 identical | A | Identical | bytes | 10000 | 165 |
| A1 original × A3 recolour | B | Copy | structural+geometric | 4997 | 26 |
| A1 original × A4 upscaled | B | Copy | structural+geometric | 7478 | 165 |
| A1 original × B1 crop | C | Copy | geometric | 3703 | 17 |
| A1 original × B2 mirror crop | C | Copy | geometric | 3382 | 21 |
| A1 original × C1 composite | D | Copy | geometric | 2002 | 11 |
| A1 original × E1 unrelated | E | Related | — | 1470 | 0 |
| E1 unrelated × E2 unrelated | E | Unrelated | — | 956 | 0 |
| G1 shared asset × G2 shared asset | G | **Suspected** | geometric | 1330 | 4 (weak) |

Zero false certifications; 5 of 5 near-duplicates certified; 11 of 15 partial copies certified and all 15 at review or better.

Then take it apart. The console holds the nine calibration tables as **draggable curves**, with every pair's value on that channel ticked underneath — green for positives, orange for negatives — so a knee either sits where the two distributions separate or it does not. Drag one and the whole corpus re-decides instantly. Click any pair to see each channel's raw value, its value *after* that channel's table, and the weight it carried, plus the models, the inlier coverage grid and the stage-1 screen.

Drop your own works in — or a `.zip` of them — and the same console tunes against your corpus instead.

Two things the page will not do. It counts **certified** and **at review or better** as separate numbers everywhere, because they answer different questions and reading one as the other is the easiest way to mis-sell a calibration. And when you edit a measurement-side field (`geoEps`, `hammingT`, `geoMinCorr`, the model floors, `gridG`) it raises a *stale* flag instead of showing you verdicts the instant loop cannot honour.

### The evidence bench

**`demo/paph4x.html`** answers the other question — not *how should this corpus be calibrated* but **why is this pair a copy**. Open it and it is already running on a sample: the stage-1 screen and its pools, the verdict lattice with this pair's dot on it, the recovered model drawn over both works with its inliers in colour, every channel's raw agreement beside what its calibration table leaves, the nine curves, and an attack sweep that reads each transform through **comparator 4 and comparator 41 side by side** so a disagreement between them is visible rather than asserted.

It is one file with no network at all — fonts, engines and all — so it travels: mail it to counsel, put it in an appeal, hand it to an artist who wants to know what the machine actually saw. It is generated rather than hand-maintained (`npm run build:bench` inlines the current `src/` engines), so it cannot quietly disagree with the package it ships beside.

The v3 evidence bench is still there too: **`demo/paph3-playground.html`**, eleven attacks, every channel arguing its case.

---

## What a copy has to survive

| attack | caught by | notes |
|---|---|---|
| recolour, tone curve | structure | absolute RGB is discarded at ingest |
| palette rebuilt | structure | quantile endpoints survive it; rank endpoints do not, and that asymmetry is itself evidence |
| nearest-neighbour upscale | front end | detected exactly and divided out before hashing |
| resample / rescale | geometry | recovered scale is reported |
| mirror | both | free — a bit permutation of the stored descriptor, no second wire |
| rotate 90/180/270, transpose | both | all eight D4 symmetries are bit operations on the stored code |
| crop | both | region selection is purely local, so a crop keeps its selections |
| figure lifted into another scene | geometry | the case the keypoint half exists for |
| luminance inversion | structure only | see [Known gaps](#known-gaps) |

Two works from the same generator — same tileset, same palette family, same dither — are the hard negative. They share run-length and palette statistics and score around **6200 structurally** on the raw v3 axis, while geometry reads **0**. The lattice caps them at `Suspected` and refuses to certify. That single row is the argument for two axes instead of one weighted sum.

Comparator 4.1 attacks the same case earlier, in the calibration rather than the cap: the `runs` and `palette` tables squash exactly the band where same-generator pairs live, which is why the strongest negative in the development corpus scores 2587 against a strong bar of 4000 rather than crowding it. Structural numbers from the two comparators are therefore **not comparable**; a profile's identity is what tells you which axis a score was measured on.

---

## The wire

| | size | contents |
|---|---|---|
| **Tier 1** | exactly **3952 B** | fixed layout, constant offsets, explicit section table, CRC-32 |
| **Tier 2** | **32 + 40n** B, n ≤ 256 | keypoint records, content-addressed to Tier 1 by CRC |

```
offset   len   section
     0    64   header — magic, version, flags, dimensions, 11×4 section table, CRC-32
    64   256   dct           hierarchical DCT, sign + Gray-coded magnitude
   320     8   brightness    tonal record, kept out of the DCT index bucket
   328    96   palette       identity palette, 24 × 4 B
   424   288   rag           sparse adjacency, 48 × 6 B, quantile AND rank endpoints
   712   328   shapes        8 × 41 B radial signatures
  1040    48   runs          run-length histograms, 3 axes × 16 bins
  1088  1024   local         128 × 64-bit region fingerprints
  2112   512   anchors       128 × 4 B aspect-true positions
  2624    96   silhouette    outline signature, its own channel
  2720    80   colour        absolute RGB — REPORTING ONLY, never scored
  2800  1152   sketch        32 × 36 B keypoints, so Tier 1 alone can still do geometry
  ────────────
        3952
```

Three details worth knowing:

- **The section table is on the wire**, not compiled into constants. This family has already paid once for a stale offset after a section was inserted.
- **CRC-32, not XOR.** An XOR cannot detect a transposition of two bytes, which is exactly the corruption a byte-range index introduces.
- **The `colour` section must not move a verdict.** Recolour invariance is load-bearing and dies the moment absolute RGB enters the scoring path. The test suite asserts that zeroing those 80 bytes changes nothing. It exists so a moderation report can say *identical palette* rather than *rebuilt palette*, which is a materially different case to argue.

---

## Configuration

A `Config` is frozen on construction. Derive rather than mutate:

```js
const strict  = engine.with({ scoring: 'gate', hammingT: 4 });
const cfg     = new Config({ geoEps: 900 });   // throws on unknown keys and bad ranges
engine.config;                                 // frozen, safe to pass around
```

### Hash-time — these change the wire

`foldMatte`, `matteTol`, `divideUpscale`, `peakRadius`, `foldInvert`, `localWindows`, `localCount`, `kpCount`, `sketchCount`.

### Compare-time — these do not

Under comparator 4 and 4.1 these are **bound by the calibration profile**, not passed ad hoc: the profile carries `hammingT`, the confidence anchors, `geoEps`, `geoMinCorr` and the model floors, so a verdict's measurement side is pinned by the same artefact its thresholds are. The knobs below are the v3 surface, and they remain what the profile fields bind to.

This is the entire argument for v3's larger byte budget. In v2 every one of these was baked in at hash time, so getting one wrong meant re-hashing the corpus to find out. Here they are pure compare-time choices, and the demo's knob panel re-decides instantly without touching a single stored byte.

| knob | default | what it decides |
|---|---|---|
| `scoring` | `weighted` | `gate` takes the weakest of evidence and corroboration, and refuses to certify on one channel |
| `evidence` | `lift` | `lift` is purity × confidence; `proportion` is share of achievable match. Both are always computed and both reported |
| `ragEndpoint` | `rank` | quantile survives a rebuilt palette, rank does not — so rank agreement is the *stronger* finding when it occurs |
| `hammingT` | `8` | fingerprint collision radius, 0–64 |
| `confidenceAt` | `16` | collisions needed for full local confidence |
| `geoConfAt` | `16` | inliers needed for full geometric confidence |
| `geoEps` | `1600` | inlier tolerance, in units of 1/65535 of the frame |
| `geoMinCorr` | `8` | correspondences below which geometry abstains |
| `mirrorHypothesis` | `true` | free — a bit permutation of the stored descriptor |

> **A caution about the defaults.** They come from an operating point set by hand on the demo bench, and they make every assertion in the harness pass — but two of those cases did not become *correct*, they became *reachable*. `hammingT: 8` roughly doubles the collision radius and `weighted` removes the structural refusal that `gate` enforces. The same two changes moved an unrelated-sprite pair from 833 to **3130**, which is over the `Suspected` line. Reverting costs one line and no re-hash. This is the debt comparator 4 was built to pay: `Proportion` and `Gate` are retired there, evidence is chance-corrected per channel, and the operating point lives in an artefact with an identity instead of in a default.

---

## How a verdict is reached

### Two axes, never averaged

Structural evidence and geometric evidence are kept apart all the way to the lattice. Structure says *these works are made of the same material*; geometry says *this part of one is that part of the other, at this scale and orientation*. A copy usually shows both. Averaging them lets a strong structural score paper over absent geometry, which is exactly how a same-generator pair gets called a copy.

| state | what it asserts |
|---|---|
| `Identical` | the fingerprints are the same bytes |
| `Copy` | certified — `basis` says what carried it |
| `Suspected` | over the suspicion bar, or capped by a rule; a human decides |
| `Related` | same family, not a copy |
| `Unrelated` | no agreement above chance |
| `Indeterminate` | the comparator could not judge — see `reasons` |

`basis` is the audit trail: `bytes`, `structural`, `geometric`, and any cap that fired (`R3:scatter`, `R4:support`). A `Copy` on `['geometric']` alone is a crop or a collage; a `Copy` on both is a whole-work near-duplicate.

### Every channel is scored against its own null

Each channel's raw agreement is compared against what the same measurement produces on a deliberately destroyed version of the same data — rotations, bit reversal, shifted and reversed correspondence lists. Evidence is the chance-corrected margin, not the raw score. A channel that cannot measure abstains rather than voting zero, and the lattice needs a minimum number of corroborating channels before anything certifies.

### The channels

`local` (keypoint descriptors through an optimal assignment), `dct`, `shape`, `topology`, `runs`, `palette`, `silhouette` — plus `geometry` on its own axis, from weighted Hough voting and multi-model extraction with mirror hypotheses.

---

## Calibration profiles

A profile is the entire judgement surface in one immutable 270-byte artefact: thresholds, channel weights, the guard fields, and the calibration tables. It has a SHA-256 identity, and a verdict carries it.

```js
import { cal003, profileEncode, profileId } from '@pixagram/paph-js';

const p = cal003();
profileEncode(p).length;                    // 270
Buffer.from(profileId(p)).toString('hex');
// 75319777e4ff7fe6592365612cff9a85d653519166ff1308c8d3489d0247a422
```

That identity is checked in three places written independently — the Rust reference, the JavaScript port, and the tool that emitted the proposal — and the golden vectors pin it. One byte of drift anywhere and the suites say so.

Container 2 carries nine tables in canonical order: `local, geometry, diversity, dct, shape, topology, runs, palette, silhouette`. Each maps a channel's raw agreement (0..10000) to calibrated evidence (0..10000), monotonically. That is where a corpus's knowledge actually lives — `runs` and `palette` agree strongly on almost any two pixel-art works, so under CAL-003 their tables squash the bottom of the range hard, while `geometry` lifts its low band because a handful of verified inliers is worth more than a high palette score.

To tune your own: open the playground, load your corpus, drag the curves, download the `.pcal`, and ship that file next to your index. `profileDecode` validates it — magic, version pair, monotonicity, ranges — and refuses anything malformed rather than repairing it.

---

## API

### The comparator

| | |
|---|---|
| `compareV41(aT1, aT2, bT1, bT2, opts, profile, hpA?, hpB?)` | comparator 41 — needs a container-2 profile |
| `compareV4(aT1, aT2, bT1, bT2, opts, profile, hpA?, hpB?)` | comparator 4 — needs a container-1 profile |
| `screenV41(aT1, aT2, bT1, bT2, opts, profile)` | `{ pass, poolDirect, poolMirror }` |
| `hashChecked(image, opts, limits)` | hash with the profile's limits enforced first |
| `cal003()` / `cal001()` | the shipped profiles |
| `profileEncode` / `profileDecode` / `profileId` | the artefact and its identity |

Pass `hpA`/`hpB` — the profile identities two parties recorded — and a mismatch returns `Indeterminate` with `PROFILE_MISMATCH` rather than a verdict neither party can reproduce.

### The v3 engine

| | |
|---|---|
| `load(opts?)` | resolve the fastest backend; both produce the same bytes |
| `new Paph(config?)` | `.hash()`, `.compare()`, `.with(over)` |
| `hash` / `compare` / `parseT1` / `parseT2` | the functional surface |

Full types ship in `index.d.ts`.

### The tuning loop

`@pixagram/paph-js/calibration` exposes what the playground runs on: `makeSnapshot41(report, profile, reportV4?)` stores everything the lattice consumes with the table outputs left out, and `relattice41(engine, snapshot, profile)` re-decides from it. `test/v4.cjs` asserts that loop equals `compareV41` field for field, which is the only reason instant tuning over a whole corpus is honest. `measurementKey(profile)` tells you when a snapshot has gone stale.

---

## Determinism

Integer arithmetic end to end, fixed iteration orders, no floating point in any wire path, and orientation ties are refused rather than broken. Argument order cannot change a verdict: the comparator canonicalises the pair and reports `swapped` so directional fields can be read back in the caller's order.

---

## Scripts

| | |
|---|---|
| `npm test` | 39 property assertions — determinism, wire integrity, symmetry, abstention, transform battery, timing |
| `npm run test:v4` | 81 conformance assertions — golden vectors, comparator 4 and 41, profiles, the tuning loop |
| `npm run test:playground` | 27 assertions driving the calibration console headlessly (needs `jsdom`; skips cleanly without it) |
| `npm run test:bench` | 16 assertions driving the evidence bench headlessly, sweep included |
| `npm run build:bench` | regenerate `demo/paph4x.html` from `demo/bench4x/` and the current engines |
| `npm run parity` | JavaScript vs WebAssembly, byte and verdict parity on the v3 wire |
| `npm run parity4` | JavaScript vs the native Rust reference, both comparators, field for field |
| `npm run verify` | the three suites that need no build |
| `npm run tables` | regenerate the frozen tables; assert no transcendental reaches the wire |
| `npm run build:wasm` | rebuild `wasm/paph3.wasm` |

The Rust crate compiles clean and carries 47 tests of its own. The build is reproducible: rebuilding from the shipped `rust/` produces a binary with the same checksum as the one in `wasm/`.

### Measured

Single thread, node 22.

| | hash 512×384 | compare |
|---|---|---|
| JavaScript (v3 wire) | ~400 ms | ~5.8 ms |
| WebAssembly (v3 wire) | ~139 ms | ~2 ms |
| comparator 41, JavaScript | — | ~11 ms/pair |

On the 496-pair development corpus, under `CAL-003-PROPOSED`, measured with the real engine:

| | |
|---|---|
| false certifications | **0** |
| near-duplicates (B) | 95.5% certified · 100% at review or better |
| partial copies (C+D) | 55.6% certified · 81.5% at review or better |
| negatives | 9 at review · 402 Related · 34 Unrelated |
| strongest negative | structural 2587, against a strong bar of 4000 |

Read those two columns as two different claims. "At review or better" means a human sees the pair; only "certified" means the machine decided.

---

## Known gaps

Stated here because a detector that hides them is worse than one that does not have them.

**`CAL-003` is `-PROPOSED`, not blessed.** Its thresholds and all nine tables were derived from a 32-work development corpus whose labels were inferred by its author, not from moderation reports. It is a defensible starting point and it is not a validated one. Re-derive it against your own labelled pairs before automating anything on it.

**Shared assets are indistinguishable from partial copies, by construction.** Two unrelated works that both embed the same licensed tile produce real, verified geometry — the same signal a genuine crop produces. On constructed pairs, a shared asset covering 9% of a canvas was enough to certify `Copy` under `CAL-003`. Neither a coverage floor nor a topology-split inlier floor separates the two classes: the bands overlap. The difference is provenance, and provenance is not in the pixels. `docs/ANALYSIS-002-solo-arm-shared-assets.md` has the measurements and the two coherent policy positions; the playground's shared-asset lab shows what your own profile does with the case. Decide it deliberately before pointing this at a marketplace.

**Geometric inversion invariance is not implemented.** Inverting a work complements every BRIEF bit *and* rotates the orientation by 180°, so the steered pattern samples the other side of the keypoint. Measured mean Hamming distance between a descriptor and the complement of its inverted twin, over 255 co-located keypoints: **129.9 of 256** — chance. A working version needs a centrally symmetric pattern, trading descriptor distinctiveness for the invariance. That is a measurable choice, not a free one, and it has not been made. Inversion is still carried by the DCT sign flip, the palette quantile reflection and the local complement fold, which do hold exactly.

---

## Repository layout

```
src/paph3.cjs            the v3 WIRE engine (UMD — also drops into a <script> tag)
src/paph4.cjs            the COMPARATOR: comparator 4 and comparator 41
src/*.js                 ESM views of the same modules
                         (the file names track the specification layer, not the
                          package version — see "Two layers", above)
wasm/paph3.wasm          318 kB, built from rust/
rust/                    the Rust reference crate (`paph3` — the wire's name,
                         kept so the shipped wasm keeps its filename and
                         checksum) — zero dependencies, on purpose
  src/wire.rs              serialisation, CRC, hash entry point
  src/compare.rs           v3 channels, Hough vote, nulls, verdict
  src/local_v4.rs          the v4 local channel; the 4.1 sparse variant beside it
  src/multimodel.rs        multi-model geometry, the control family, the weak signal
  src/calibration.rs       PCAL artefacts, containers 1 and 2, CAL-001 / CAL-003
  src/v4.rs, src/v41.rs    the two comparators
  src/golden.rs            the golden vectors, emitted by the reference itself
  src/bin/paphcli.rs       the stdin/stdout harness the parity suites drive
test/                    property, conformance, parity and playground suites
demo/paph4x.html              the 4.1 evidence bench — one file, no network
demo/bench4x/                 its sources: brand CSS, body, application
demo/paph41-playground.html   the 4.1 calibration console, with the worked example
demo/paph3-playground.html    the v3 evidence bench
demo/cal-core.cjs             the tuning loop, shared by both benches and the suites
tools/build-paph4x.mjs        assembles the bench, inlining the current engines
docs/                    the specifications, the status ledger, the analyses
```

The WebAssembly is deliberately **not** built with wasm-bindgen or wasm-pack. The export surface is five C functions and the glue is written by hand next to it, because a consensus artefact should not have a code generator between its source and its binary. The Rust crate has zero dependencies for the same reason: every dependency is another way for two parties to disagree.

---

## Provenance

| document | what it is |
|---|---|
| `docs/SPEC-004-paph-v4.md` | the comparator specification, with Amendment 4.1 as its last chapter |
| `docs/SPEC-004.1-proposal.md` | the proposal 4.1 was adopted from, with the corpus evidence |
| `docs/IMPL-004-status.md` | what has landed, what is pending, and the gate M7 has to clear |
| `docs/ANALYSIS-002-solo-arm-shared-assets.md` | the shared-asset finding and the decision it forces |
| `docs/ANALYSIS-001-field-forensics.md` | per-field forensics behind the 4.1 channel work |
| `docs/SPEC-003-paph-v3.md` | the wire specification |
| `docs/IMPL-003-implementation-notes.md` | errata against SPEC-003 and the determinism defects the Rust port exposed |
| `docs/golden/GOLDEN-004.json` | golden vectors at milestone M6, emitted by the Rust reference |
| `docs/calibration/*.pcal` | the shipped profiles as bytes — decode them without running the engine |

Where an implementation and a specification disagree, the notes say so and explain why.

Source, issues and releases: **[github.com/pixagram-blockchain/paph-js](https://github.com/pixagram-blockchain/paph-js)**.

## Licence

MIT. Copyright © 2026 Pixagram SA, Zug, Switzerland.
