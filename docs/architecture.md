# Target architecture

## Decision

Use the `zxing-wasm` package (ZXing-C++, single-thread WASM, reader build, pinned) as the portable decoder, with native `BarcodeDetector` as an optional fast path. Build an engine-independent TypeScript contract and own the Web capture and orchestration pipeline.

## Components

```text
MediaDevices / camera controls
  └─ latest-frame scheduler
      └─ [Phase 2] quality estimator
          └─ decoder adapter
              ├─ zxing-wasm (universal)
              └─ native BarcodeDetector (optional, feature-detected)
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

### Image handling

- Full frame first, decoded at native camera resolution rather than a downscaled video frame.
- Optional centre ROI crop at native resolution, kept only if measured to help.
- Preprocessing only if measured; do not apply unmeasured filters permanently.
- Quality estimator (blur, brightness, glare, motion) is Phase 2.
- Keep transformation metadata for reproducibility without retaining the image.

### Decoder

- Decoder: pinned `zxing-wasm` reader build behind the adapter, with EAN-8/EAN-13/UPC-A hints. `tryHarder`, `tryRotate`, and `tryInvert` are measured, not assumed.
- Native `BarcodeDetector` is used only when feature-detected and `getSupportedFormats()` includes the three formats (see ADR 0003). It uses the same `ScanResult` contract.
- Single-thread WASM is mandatory. SIMD may be progressive enhancement.
- WASM threads are out of scope for Phase 1 because of cross-origin-isolation and dual-build costs.

### Validation and consensus

- Validate the standard checksum before emitting a result.
- Preserve the observed format and raw value.
- Define UPC-A/EAN-13-leading-zero canonicalization explicitly.
- Require consistent observations across frames according to a benchmark-calibrated policy.
- Do not expose an uncalibrated percentage confidence.

## Where the real gains are

Expected gains come from the pipeline around the decoder, not a decoder rewrite:

- camera constraints: resolution, focus, zoom, torch;
- decoding at native resolution, not downscaled video;
- frame selection;
- multi-frame consensus;
- an adaptive time budget.

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
