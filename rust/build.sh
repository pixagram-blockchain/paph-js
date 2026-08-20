#!/usr/bin/env bash
# Rebuild wasm/paph.wasm from the Rust crate.
#
# No wasm-bindgen, no wasm-pack: the export surface is five C functions and the
# JavaScript glue is written by hand in wasm/paph-js-wasm.js.  A consensus
# artefact should not have a code generator between its source and its binary.
set -euo pipefail
cd "$(dirname "$0")"
rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
# SIMD128 is a 2021 baseline in every browser and Node this ships against, and
# geom42/keypoints have vectorised batch paths gated on it.  They are held to
# the scalar paths bit-for-bit by `descriptor_batch_matches_pairwise`, so this
# flag can only change speed.
export RUSTFLAGS="${RUSTFLAGS:-} -C target-feature=+simd128"
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/paph3.wasm ../wasm/paph.wasm
ls -la ../wasm/paph.wasm
echo "now run: npm run parity"
