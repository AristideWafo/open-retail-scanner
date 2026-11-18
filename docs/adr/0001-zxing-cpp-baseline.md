# ADR 0001 — ZXing-C++ as initial decoder baseline

**Status:** proposed

## Context

The initial product scope needs EAN-8, EAN-13, and UPC-A. Rewriting the decoder would consume the spike before testing the more likely performance bottlenecks: frame acquisition, localization, quality selection, preprocessing, and scheduling.

## Decision

Use ZXing-C++ as the initial decoder, compiled to a single-thread WebAssembly build. Hide it behind an engine adapter.

## Consequences

- Faster path to an evidence-producing prototype.
- Apache-2.0 compatibility, subject to dependency audit and notices.
- The project owns the surrounding pipeline and can replace or contribute to the decoder later.
- Custom decoder work requires benchmark evidence that ZXing-C++ is the limiting component.
