# Instructions for implementation agents

## Objective

Implement a benchmark-first, local-only EAN-8/EAN-13/UPC-A web scanner that is measurably better than the current SafeEat reader. Do not claim parity with any commercial SDK.

Open Retail Scanner is independent from consuming applications. SafeEat is the first pilot integrator. Keep SafeEat product lookup, health logic, profiles, claims, and application data outside this repository; follow `docs/pilots/safeeat.md` for the integration boundary.

## Non-negotiable constraints

- Do not reverse engineer, decompile, inspect, translate, or derive implementation details from Scanbot or another proprietary SDK.
- Commercial scanners may only be exercised as black boxes when the applicable licence and a human legal reviewer allow it.
- Never log, persist, transmit, or include in telemetry: frames, cropped images, barcode values, product identities, or user data.
- Barcode detection identifies a code only. It must not emit food-safety, allergen, compatibility, or medical conclusions.
- Preserve `rawValue`, `canonicalValue`, observed `format`, `engineVersion`, checksum evidence, and confirming-frame count.
- Never return a partial code. Validate the EAN/UPC checksum.
- Keep manual entry reachable for every recoverable scanner failure.
- Process frames off the main thread where platform capabilities permit. Drop stale frames rather than queueing them.
- Maintain scalar/single-thread fallbacks. Do not require cross-origin isolation in the first Web POC.

## Work order

1. Pick the lowest-numbered open issue labelled `status:ready` in the current milestone. Do not start `status:blocked` issues.
2. Phase 0 first: funnel measurement, then the replay harness (`docs/benchmark/protocol.md`). Record the baseline before modifying any runtime.
3. Phase 1 starts only when the "Phase 0 decision" issue records GO. Then build the smallest web slice on the `zxing-wasm` npm package plus the optional native `BarcodeDetector` fast path (ADR 0001, ADR 0003).
4. Tune only on the development split; never on the locked validation split. A preprocessing step stays only if it shows a measured gain.
5. Commercial SDK comparison is optional and informational; it needs a human legal review and never gates a decision.
6. One issue per PR, small and reviewable; update the relevant doc/ADR when behaviour changes.

## Verification

- Node.js 22.18 or newer.
- Run `npm run check` (repo contract, `tsc` typecheck, `node --test`) before every handoff. `packages/core/src/checksum.ts` and its test are the reference pattern for new code and tests.
- Add deterministic unit tests for checksums, UPC-A/EAN-13 normalization, consensus, frame scheduling, error mapping, and privacy controls.
- Record benchmark configuration, versions, device/browser, corpus version, and raw aggregate metrics.
- For zero observed wrong-code events, publish the number of independent trials and a confidence bound; never claim zero real-world risk.

## Scope control

Do not add QR, Data Matrix, PDF417, OCR, product lookup, analytics backends, iOS, Android, React Native, or cloud services unless a dedicated issue has been approved. Do not silently widen the supported device matrix.
