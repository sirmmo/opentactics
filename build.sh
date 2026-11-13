#!/bin/sh
# Test the engine, build the WebAssembly client into site/, and build the server.
set -e
cd "$(dirname "$0")"
cargo test --release --workspace
cargo build --profile wasm --target wasm32-unknown-unknown -p opentactics-client
cp target/wasm32-unknown-unknown/wasm/opentactics.wasm site/opentactics.wasm
cargo build --release -p opentactics-server
echo "Run: ./target/release/opentactics-server   then open http://localhost:8080/"
