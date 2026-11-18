# SafeEat Scanner SDK

An open-source, local-first barcode scanning SDK focused on retail food packaging.

> **Project status: benchmark-first exploration.** The project has not demonstrated parity with Scanbot or any other commercial SDK. Do not use performance claims until the locked benchmark has been completed and published.

## Mission

Build a small, auditable scanner for EAN-8, EAN-13, and UPC-A that can be embedded in web applications and remain reliable on the explicitly supported device matrix.

The SDK identifies a barcode value. It does **not** verify a product, determine whether food is suitable for someone, inspect allergens, or guarantee that a remote product record matches the physical label.

## Principles

- Benchmark before optimizing or making comparative claims.
- Process frames on-device; never upload or log images or barcode values.
- Use ZXing-C++ as the initial decoding core instead of rewriting a decoder.
- Own the capture, quality, scheduling, preprocessing, and temporal-consensus pipeline.
- Preserve raw value, canonical value, observed format, engine version, and evidence.
- Always provide an accessible manual-entry fallback.
- Drop stale frames; never build a processing backlog.
- Keep the public API engine-independent.

## Proposed pipeline

```text
camera → frame quality → ROI/localization → preprocessing → ZXing-C++/WASM
       → checksum → temporal consensus → result or user guidance
```

## Current phase

Phase 0 produces a reproducible comparison of Scanbot, ZXing-C++/WASM, Quagga2, and the native `BarcodeDetector` when available. Development of a supported SDK is conditional on the gates in [the benchmark protocol](docs/benchmark/protocol.md).

## Repository map

- [`docs/product-scope.md`](docs/product-scope.md) — intended and excluded uses.
- [`docs/architecture.md`](docs/architecture.md) — target technical architecture.
- [`docs/benchmark/protocol.md`](docs/benchmark/protocol.md) — preregistered evaluation.
- [`docs/decision-record.md`](docs/decision-record.md) — evidence, options, risks, and gates.
- [`docs/clean-room-policy.md`](docs/clean-room-policy.md) — legal separation from commercial SDKs.
- [`docs/privacy-security.md`](docs/privacy-security.md) — data and threat-model baseline.
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — implementation-agent starting point.
- [`ROADMAP.md`](ROADMAP.md) — gated delivery plan.

## Development

Requirements: Node.js 22+.

```bash
npm install
npm run check
```

The initial packages intentionally contain only contracts and scaffolding. See the issues labelled `phase:0` before implementing the runtime.

## License

Apache License 2.0. Dependency notices and source licenses remain applicable. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
