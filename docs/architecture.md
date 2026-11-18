# Target architecture

## Decision

Begin with ZXing-C++ compiled to WebAssembly as the portable decoder. Build an engine-independent TypeScript contract and own the Web capture and orchestration pipeline.

## Components

```text
MediaDevices / camera controls
  └─ latest-frame scheduler
      └─ quality estimator
          └─ ROI/localizer and preprocessing variants
              └─ decoder adapter (ZXing-C++ WASM)
                  └─ checksum and normalization
                      └─ temporal consensus
                          ├─ result
                          └─ actionable guidance / manual fallback
```

### Capture adapter

- Select the rear environment camera when available without assuming device labels.
- Negotiate resolution and expose zoom/torch capabilities only when reported.
- Handle visibility changes, track endings, permissions, and camera replacement.
- Never represent a permission or camera failure as a decoding failure.

### Frame scheduler

- Keep at most one unprocessed frame.
- Perform work in a Web Worker where supported.
- Prefer luminance buffers, `VideoFrame`, or `ImageBitmap`; avoid JPEG/base64 conversion.
- Enforce CPU, memory, and time budgets.

### Image pipeline

- Start with a central landscape ROI and configurable fallback search.
- Measure blur, brightness, glare, and motion before expensive decoding.
- Benchmark preprocessing variants; do not apply unmeasured filters permanently.
- Keep transformation metadata for reproducibility without retaining the image.

### Decoder

- ZXing-C++ is the initial baseline, not an irreversible dependency.
- Restrict builds and hints to EAN-8/EAN-13/UPC-A.
- Scalar/single-thread WASM is mandatory. SIMD may be progressive enhancement.
- WASM threads are out of scope for Phase 1 because of cross-origin-isolation and dual-build costs.

### Validation and consensus

- Validate the standard checksum before emitting a result.
- Preserve the observed format and raw value.
- Define UPC-A/EAN-13-leading-zero canonicalization explicitly.
- Require consistent observations across frames according to a benchmark-calibrated policy.
- Do not expose an uncalibrated percentage confidence.

## Public API qualities

- Engine-independent and framework-independent.
- Abortable lifecycle with idempotent `stop()` and resource cleanup.
- Typed state, result, guidance, and recoverable/non-recoverable errors.
- Version information in results and diagnostics.
- No analytics dependency.

## Deferred decisions

- Native iOS/Android packages.
- WASM threads and COOP/COEP requirements.
- Custom 1D localizer or decoder changes.
- Public support SLA and LTS policy.
- Additional barcode formats.
