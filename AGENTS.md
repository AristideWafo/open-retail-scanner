# Instructions for implementation agents

## Objective

Implement a benchmark-first, local-only EAN-8/EAN-13/UPC-A scanner. Do not claim Scanbot parity until the locked benchmark passes.

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

1. Complete Phase 0 benchmark tooling and fixtures.
2. Record the baseline before modifying the runtime.
3. Implement the smallest Web/WASM vertical slice.
4. Re-run development benchmarks; never tune on the locked validation set.
5. Request legal review before publishing comparative results or adding proprietary SDK automation.

## Verification

- Node.js 22 or newer.
- Run `npm run check` before every handoff.
- Add deterministic unit tests for checksums, UPC-A/EAN-13 normalization, consensus, frame scheduling, error mapping, and privacy controls.
- Record benchmark configuration, versions, device/browser, corpus version, and raw aggregate metrics.
- For zero observed wrong-code events, publish the number of independent trials and a confidence bound; never claim zero real-world risk.

## Scope control

Do not add QR, Data Matrix, PDF417, OCR, product lookup, analytics backends, iOS, Android, React Native, or cloud services unless a dedicated issue has been approved. Do not silently widen the supported device matrix.
