# Gated roadmap

Dates are intentionally absent until owners and capacity are assigned.

## Phase 0 — Evidence

- Use the SafeEat pilot to separate camera/decode failures from network, lookup, and application data-quality failures.
- Establish a lawful corpus and a locked validation split.
- Build the reproducible benchmark harness.
- Measure current reader, ZXing-C++/WASM, Quagga2, native `BarcodeDetector`, and—only if legally approved—Scanbot as a black box.
- Decide `GO`, `ITERATE`, or `NO-GO` using preregistered gates.

## Phase 1 — Web vertical slice

- Worker-based latest-frame scheduler.
- Luminance/ROI pipeline without JPEG/base64.
- ZXing-C++ WASM adapter.
- Checksum, normalization, consensus, lifecycle, error taxonomy.
- Minimal accessible camera UI and manual fallback.

## Phase 2 — Robustness

- Quality estimator and user guidance.
- Curved, reflective, low-light, small, and damaged-code improvements.
- Real-device compatibility matrix and regression suite.
- Bundle, startup, memory, CPU, thermal, and battery budgets.

## Phase 3 — Public SDK readiness

Conditional on five active design partners or two documented customers willing to pay, plus a named maintenance owner.

- Stable API and semver policy.
- Signed releases, SBOM, provenance, security response.
- Framework integrations and examples.
- Support and compatibility policy.

## Not scheduled

- Native iOS/Android, React Native, Flutter, or Capacitor packages.
- Additional barcode symbologies.
- Cloud analytics or hosted scanning.
- A custom decoder written from scratch.
