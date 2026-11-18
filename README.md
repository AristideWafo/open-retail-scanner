# Open Retail Scanner

An open-source, local-first barcode scanning SDK focused on retail food packaging.

> **Project status: benchmark-first exploration.** The project has not demonstrated parity with Scanbot or any other commercial SDK. Do not use performance claims until the locked benchmark has been completed and published.

## Mission

Build a small, auditable scanner for EAN-8, EAN-13, and UPC-A that can be embedded in web applications and remain reliable on the explicitly supported device matrix. The goal is a scanner measurably better than the current reader, and compared with commercial SDKs only when legally cleared.

The project is independent from any consuming application. **SafeEat is the first pilot integration**, providing a real packaged-food use case and end-to-end validation feedback. SafeEat-specific health logic, user profiles, product lookup, and safety-related wording remain outside this repository.

The SDK identifies a barcode value. It does **not** verify a product, determine whether food is suitable for someone, inspect allergens, or guarantee that a remote product record matches the physical label.

## Principles

- Benchmark before optimizing or making comparative claims.
- Process frames on-device; never upload or log images or barcode values.
- Use the `zxing-wasm` package (ZXing-C++) as the decoding core instead of rewriting a decoder.
- Own the capture, scheduling, and temporal-consensus pipeline; add quality and preprocessing steps only when measured.
- Preserve raw value, canonical value, observed format, engine version, and evidence.
- Always provide an accessible manual-entry fallback.
- Drop stale frames; never build a processing backlog.
- Keep the public API engine-independent.

## Proposed pipeline

```text
camera → latest frame → zxing-wasm (or native BarcodeDetector)
       → checksum → temporal consensus → result or manual fallback
```

## Current phase

Phase 0 (`v1.0.0-lite` benchmark, 160-clip corpus manifest across development and locked validation splits, and 100k wrong-code stress test) passed its `GO` gates in [`docs/decision-record.md`](docs/decision-record.md). Phase 1 (`open-retail-scanner-core` and `open-retail-scanner-web`) is implemented as a thin web slice with `zxing-wasm`, an optional native `BarcodeDetector` fast path, latest-frame worker scheduling, checksum validation, two-frame temporal consensus, and accessible manual entry. Scanbot evaluation and named comparison remain excluded under [`docs/clean-room-policy.md`](docs/clean-room-policy.md). SafeEat validates the first integration through the separate [pilot charter](docs/pilots/safeeat.md).

## Repository map

- [`docs/product-scope.md`](docs/product-scope.md) — intended and excluded uses.
- [`docs/architecture.md`](docs/architecture.md) — target technical architecture.
- [`docs/benchmark/protocol.md`](docs/benchmark/protocol.md) — preregistered evaluation.
- [`docs/decision-record.md`](docs/decision-record.md) — evidence, options, risks, and gates.
- [`docs/clean-room-policy.md`](docs/clean-room-policy.md) — legal separation from commercial SDKs.
- [`docs/privacy-security.md`](docs/privacy-security.md) — data and threat-model baseline.
- [`docs/pilots/safeeat.md`](docs/pilots/safeeat.md) — first-pilot contract and separation boundary.
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — implementation-agent starting point.
- [`ROADMAP.md`](ROADMAP.md) — gated delivery plan.

## Development

Requirements: Node.js 22.18+ (24 recommended, see `.nvmrc`).

```bash
npm install
npm run check
```

The workspace contains `open-retail-scanner-core` (checksums, temporal consensus, privacy gates, and the Phase 0 replay benchmark / 100k wrong-code stress harness) and `open-retail-scanner-web` (camera adapter, latest-frame worker scheduler, `zxing-wasm` adapter, native `BarcodeDetector` fast path, and accessible UI controller). See [`ROADMAP.md`](ROADMAP.md) and [`docs/HANDOFF.md`](docs/HANDOFF.md) for current phase gates and next steps.

## License

Apache License 2.0. Dependency notices and source licenses remain applicable. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
