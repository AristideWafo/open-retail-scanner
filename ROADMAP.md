# Gated roadmap

Dates are intentionally absent until owners and capacity are assigned. Each phase is gated on the previous one.

## Phase 0 — Evidence-lite

Target: at most 2 weeks, one person.

1. **Measure the SafeEat funnel first.** Determine what share of failures and abandons is camera/decode versus network, lookup, or data quality. If it is below 20%, stop: `NO-GO` stands.
2. **Build a small replay harness.**
   - Record raw camera clips on 4–6 real devices, including iOS Safari and Android Chrome, low and mid tier.
   - Use about 40 distinct products you own, under 4 conditions: normal, low light, glare/curved, small/damaged.
   - Ground truth: printed digits read by one person plus checksum; a second person only for disagreements.
   - Replay identical clips through each engine: the current SafeEat reader, `zxing-wasm` (reader build, EAN/UPC only), native `BarcodeDetector` where it exists (Chrome Android; not shipped by default in iOS Safari), and optionally Quagga2.
3. Scanbot is optional, only after legal review. The gate must not depend on it.
4. Decide `GO`, `ITERATE`, or `NO-GO` using the preregistered gates.

## Phase 1 — Thin web slice

- Package built on the `zxing-wasm` npm package; do not compile our own WASM.
- Native `BarcodeDetector` as a fast path when feature-detected, behind the same engine-independent interface.
- Latest-frame worker.
- Checksum, and 2-frame consensus within a time window.
- Manual fallback and a minimal accessible UI.

## Phase 2 — Robustness, only what Phase 0 data justifies

- Camera constraint tuning: resolution of at least 1080p where available, continuous focus, zoom, torch.
- ROI versus full-frame.
- Quality guidance (blur, dark, glare).
- Device matrix and budgets.
- Each preprocessing step must show a measured gain on the development split or it is removed.

## Phase 3 — Public SDK readiness

Conditional on external demand (five active design partners or two documented customers willing to pay) and a named maintenance owner.

- Stable API and semver policy.
- Signed releases, SBOM, provenance, security response.
- Framework integrations and examples.
- Support and compatibility policy.

## Not scheduled

- Native iOS/Android, React Native, Flutter, or Capacitor packages. If ever needed, wrap platform scanners (Google ML Kit / Apple Vision) rather than build a decoder.
- Additional barcode symbologies.
- Cloud analytics or hosted scanning.
- A custom decoder written from scratch.
