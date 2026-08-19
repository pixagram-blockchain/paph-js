#!/usr/bin/env bash
# Rebuild wasm/paph3.wasm from the Rust crate.
#
# No wasm-bindgen, no wasm-pack: the export surface is five C functions and the
# JavaScript glue is written by hand in wasm/paph3-wasm.js.  A consensus
# artefact should not have a code generator between its source and its binary.
set -euo pipefail
cd "$(dirname "$0")"
rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/paph3.wasm ../wasm/paph3.wasm
ls -la ../wasm/paph3.wasm
echo "now run: npm run parity"
