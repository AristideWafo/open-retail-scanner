# ADR 0003 — native BarcodeDetector fast path

**Status:** accepted

## Context

Chrome on Android, ChromeOS, and macOS provides a native `BarcodeDetector`. It is not available by default in iOS Safari, so a WASM decoder is required anyway.

## Decision

Use native `BarcodeDetector` when it is feature-detected and `getSupportedFormats()` includes `ean_8`, `ean_13`, and `upc_a`. It returns the same `ScanResult` contract as every other engine and is benchmarked as its own engine. The WASM engine remains the universal path.

## Consequences

- Possible speed and battery gains on supporting browsers.
- Two engines to test and a behaviour difference to document; checksum and consensus apply to both.
- Platform support varies, so it is never assumed and is enabled only if the replay data shows it is no worse than WASM.
