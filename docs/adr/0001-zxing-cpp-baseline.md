# ADR 0001 — ZXing-C++ via `zxing-wasm` as decoder baseline

**Status:** accepted

## Context

The initial product scope needs EAN-8, EAN-13, and UPC-A. Rewriting the decoder, or building our own WASM toolchain, would consume the spike before testing the more likely bottlenecks: camera constraints, resolution, frame selection, and consensus.

## Decision

Use the maintained `zxing-wasm` package (ZXing-C++ compiled to single-thread WASM, reader build, pinned version) rather than building our own WASM toolchain. Hide it behind an engine adapter. Revisit only if bundle size, build flags, or missing hints are shown to matter.

## Consequences

- Faster path to an evidence-producing prototype with no native toolchain to maintain.
- Apache-2.0 compatibility, subject to dependency audit and notices.
- Less control over build flags and bundle size until measurements show it matters.
- The project owns the surrounding pipeline and can replace or contribute to the decoder later.
- Custom decoder work requires benchmark evidence that ZXing-C++ is the limiting component.
