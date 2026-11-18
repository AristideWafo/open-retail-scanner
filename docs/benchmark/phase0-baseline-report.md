# Phase 0 baseline report (160-clip development + locked validation & wrong-code stress)

**Protocol version:** `v1.0.0-lite` (`orc-protocol-v1.0.0-lite-20261118`, SHA-256 `19cdc9fc49d6df36c76e02d3cb436104d031d30a6b5b76bc66b792b33c4c77c6`)  
**Corpus version:** `phase0-v1.0.0-lite-2026-11-18` (40 distinct GS1 products × 4 conditions = 160 sequences: `80` `development` + `80` locked `validation`, `0` product overlap)  
**Manifest & results:** [`manifest.json`](manifest.json) (160 entries, outside-git raw binary store) | [`phase0-results.json`](phase0-results.json) (immutable privacy-validated aggregate summary)  
**Runner:** [`packages/web/src/phase0-runner.ts`](../../packages/web/src/phase0-runner.ts)  
**Engines:**
- `safeeat-current-reader`: `html5-qrcode@2.3.8 (single-pass-equiv)` (`tryHarder: false, tryRotate: false, tryInvert: false, tryDownscale: false`)
- `zxing-wasm`: `zxing-wasm@3.1.7 (zxing-cpp@f19f7c6e0509fe0eeb822bf35c41b0f637dec290)` using local `zxing_reader.wasm` (remote CDN URLs blocked)
- `native-barcode-detector`: `web-barcodedetector@1.0.0 (ci-shim-zxing-wasm@3.1.7+f19f7c6)` on Android Chrome segments only (`N = 40` dev, `N = 40` val)
**Runtime:** Node.js >= 22.18 deterministic replay (`3` frames/clip @ `33 ms` cadence, `2`-frame `ConsensusTracker` within `1500 ms`)  
**Date:** 2026-11-18  

> **Scope limitation:** This report documents reproducible deterministic replay measurements over rendered GS1 EAN-13 (`20` products / `80` clips), UPC-A (`12` products / `48` clips), and EAN-8 (`8` products / `32` clips) sequences assigned across all 4 conditions and 4 mobile device profiles, plus a 100,000-frame synthetic wrong-code stress test. In Node.js CI, `native-barcode-detector` exercises [`NativeBarcodeDetectorAdapter`](../../packages/web/src/native-detector.ts) through a deterministic `BarcodeDetector` shim on the Android Chrome subset; it is never evaluated as available on `ios_safari_low` / `ios_safari_mid`. Physical camera video captures on real handsets remain the hardware field-validation track (`#5`), and named parity claims are excluded.

---

## 1. Corpus coverage & configurations

The 40 distinct owned-product GS1 barcodes are partitioned strictly by physical product (`20` `development`: `10` `ean13`, `6` `upca`, `4` `ean8`; `20` `validation`: `10` `ean13`, `6` `upca`, `4` `ean8`; `0` overlap) across all 4 conditions (`40` clips each) and all 4 mandatory mobile device tiers (`40` clips each: `20` in `development`, `20` in `validation`). Raw `.bin` clip payloads and private ground-truth mappings are written strictly outside the git repository (`os.tmpdir()`).

| Configuration ID | Engine | `tryHarder` | `tryRotate` | `tryInvert` | `tryDownscale` | Splits evaluated |
|---|---|---|---|---|---|---|
| `safeeat-current-reader` | `safeeat-current-reader` | `false` | `false` | `false` | `false` | `development` (`80`), `validation` (`80`) |
| `zxing-ablation-no-tryRotate` | `zxing-wasm` | `true` | `false` | `false` | `true` | `development` (`80`) |
| `zxing-ablation-no-tryHarder` | `zxing-wasm` | `false` | `true` | `false` | `true` | `development` (`80`) |
| `zxing-ablation-tryInvert-on` | `zxing-wasm` | `true` | `true` | `true` | `true` | `development` (`80`) |
| `zxing-tuned-th1-tr1-ti0` | `zxing-wasm` | `true` | `true` | `false` | `true` | `development` (`80`), `validation` (`80`, frozen) |
| `native-barcode-detector` | `native-barcode-detector` | — | — | — | — | `development` Android Chrome (`40`), `validation` Android Chrome (`40`) |

---

## 2. Development split results (`N_seq = 80` universal; `N_seq = 40` Android Chrome)

### Overall by configuration

| Configuration | `N_seq` | `correctWithin3s` (`k / N`) | Wilson 95% CI | `timeToFirstCorrectMs` (P50 / P90 / P95) | `noResultRate` | `wrongValidCount` (95% upper bound) | `recoverableFailureRate` | Cold init P50 / P95 |
|---|---|---|---|---|---|---|---|---|
| `safeeat-current-reader` | `80` | `68 / 80` (`85.0%`) | `[75.6%, 91.2%]` | `33 / 33 / 33 ms` | `15.0%` (`12 / 80`) | `0 / 80` (`<= 0.0374`) | `0.0%` (`0 / 80`) | `2.22 / 3.76 ms` |
| `zxing-ablation-no-tryRotate` | `80` | `68 / 80` (`85.0%`) | `[75.6%, 91.2%]` | `33 / 33 / 33 ms` | `15.0%` (`12 / 80`) | `0 / 80` (`<= 0.0374`) | `0.0%` (`0 / 80`) | `1.98 / 3.17 ms` |
| `zxing-ablation-no-tryHarder` | `80` | `80 / 80` (`100.0%`) | `[95.4%, 100.0%]` | `33 / 33 / 33 ms` | `0.0%` (`0 / 80`) | `0 / 80` (`<= 0.0374`) | `0.0%` (`0 / 80`) | `2.03 / 3.33 ms` |
| `zxing-ablation-tryInvert-on` | `80` | `80 / 80` (`100.0%`) | `[95.4%, 100.0%]` | `33 / 33 / 33 ms` | `0.0%` (`0 / 80`) | `0 / 80` (`<= 0.0374`) | `0.0%` (`0 / 80`) | `1.99 / 3.25 ms` |
| `zxing-tuned-th1-tr1-ti0` | `80` | `80 / 80` (`100.0%`) | `[95.4%, 100.0%]` | `33 / 33 / 33 ms` | `0.0%` (`0 / 80`) | `0 / 80` (`<= 0.0374`) | `0.0%` (`0 / 80`) | `2.00 / 3.22 ms` |
| `native-barcode-detector` (Android Chrome only) | `40` | `40 / 40` (`100.0%`) | `[91.2%, 100.0%]` | `33 / 33 / 33 ms` | `0.0%` (`0 / 40`) | `0 / 40` (`<= 0.0749`) | `0.0%` (`0 / 40`) | `0.01 / 0.01 ms` |

- **Development overall delta (`zxing-tuned-th1-tr1-ti0` vs `safeeat-current-reader`):** `+15.0` percentage points (`>= +10` pp required).
- **Ablation conclusion:** `tryRotate: true` drives the `+15.0 pp` gain (`12 / 12` rotated `small_damaged` sequences recovered); `tryInvert: false` matches `tryInvert: true` on dark-on-light retail labels; `tryHarder: true` is retained in the frozen candidate `zxing-tuned-th1-tr1-ti0` with P95 cold init `3.22 ms`.

### Development mandatory subgroups (`safeeat-current-reader` vs `zxing-tuned-th1-tr1-ti0` vs Android Chrome `native-barcode-detector`)

| Subgroup | `N_seq` | `safeeat-current-reader` (`correctWithin3s`, 95% CI) | `zxing-tuned-th1-tr1-ti0` (`correctWithin3s`, 95% CI) | Delta (Tuned − Baseline) | `native-barcode-detector` (Android Chrome only) |
|---|---|---|---|---|---|
| Condition: `normal` | `20` | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `0.0 pp` | `10 / 10` (`100.0%`, `[72.2%, 100.0%]`) |
| Condition: `low_light` | `20` | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `0.0 pp` | `10 / 10` (`100.0%`, `[72.2%, 100.0%]`) |
| Condition: `glare_curved` | `20` | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `0.0 pp` | `10 / 10` (`100.0%`, `[72.2%, 100.0%]`) |
| Condition: `small_damaged` | `20` | `8 / 20` (`40.0%`, `[21.9%, 61.3%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `+60.0 pp` | `10 / 10` (`100.0%`, `[72.2%, 100.0%]`) |
| Symbology: `ean13` | `40` | `34 / 40` (`85.0%`, `[70.9%, 92.9%]`) | `40 / 40` (`100.0%`, `[91.2%, 100.0%]`) | `+15.0 pp` | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) |
| Symbology: `upca` | `24` | `21 / 24` (`87.5%`, `[69.0%, 95.7%]`) | `24 / 24` (`100.0%`, `[86.2%, 100.0%]`) | `+12.5 pp` | `12 / 12` (`100.0%`, `[75.8%, 100.0%]`) |
| Symbology: `ean8` | `16` | `13 / 16` (`81.3%`, `[57.0%, 93.4%]`) | `16 / 16` (`100.0%`, `[80.6%, 100.0%]`) | `+18.8 pp` | `8 / 8` (`100.0%`, `[67.6%, 100.0%]`) |
| Device: `ios_safari_low` | `20` | `17 / 20` (`85.0%`, `[64.0%, 94.8%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `+15.0 pp` | `N/A` (absent in iOS Safari) |
| Device: `ios_safari_mid` | `20` | `17 / 20` (`85.0%`, `[64.0%, 94.8%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `+15.0 pp` | `N/A` (absent in iOS Safari) |
| Device: `android_chrome_low` | `20` | `17 / 20` (`85.0%`, `[64.0%, 94.8%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `+15.0 pp` | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) |
| Device: `android_chrome_mid` | `20` | `17 / 20` (`85.0%`, `[64.0%, 94.8%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `+15.0 pp` | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) |

---

## 3. Locked validation split results (`analysisFrozen: true`, `N_seq = 80` universal; `N_seq = 40` Android Chrome)

The analysis configuration (`zxing-tuned-th1-tr1-ti0`, `protocolFreezeHash: "orc-protocol-v1.0.0-lite-20261118"`) was frozen prior to unlocking the `validation` partition.

### Overall validation comparison

| Configuration | `N_seq` | `correctWithin3s` (`k / N`) | Wilson 95% CI | `timeToFirstCorrectMs` (P50 / P90 / P95) | `noResultRate` | `wrongValidCount` (95% upper bound) | `recoverableFailureRate` | Cold init P50 / P95 |
|---|---|---|---|---|---|---|---|---|
| `safeeat-current-reader` | `80` | `68 / 80` (`85.0%`) | `[75.6%, 91.2%]` | `33 / 33 / 33 ms` | `15.0%` (`12 / 80`) | `0 / 80` (`<= 0.0374`) | `0.0%` (`0 / 80`) | `2.38 / 3.59 ms` |
| `zxing-tuned-th1-tr1-ti0` | `80` | `80 / 80` (`100.0%`) | `[95.4%, 100.0%]` | `33 / 33 / 33 ms` | `0.0%` (`0 / 80`) | `0 / 80` (`<= 0.0374`) | `0.0%` (`0 / 80`) | `2.35 / 3.23 ms` |
| `native-barcode-detector` (Android Chrome only) | `40` | `40 / 40` (`100.0%`) | `[91.2%, 100.0%]` | `33 / 33 / 33 ms` | `0.0%` (`0 / 40`) | `0 / 40` (`<= 0.0749`) | `0.0%` (`0 / 40`) | `0.01 / 0.01 ms` |

### Validation mandatory subgroups

| Subgroup | `N_seq` | `safeeat-current-reader` (`correctWithin3s`, 95% CI) | `zxing-tuned-th1-tr1-ti0` (`correctWithin3s`, 95% CI) | Delta (Tuned − Baseline) | `native-barcode-detector` (Android Chrome only) |
|---|---|---|---|---|---|
| Condition: `normal` | `20` | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `0.0 pp` | `10 / 10` (`100.0%`, `[72.2%, 100.0%]`) |
| Condition: `low_light` | `20` | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `0.0 pp` | `10 / 10` (`100.0%`, `[72.2%, 100.0%]`) |
| Condition: `glare_curved` | `20` | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `0.0 pp` | `10 / 10` (`100.0%`, `[72.2%, 100.0%]`) |
| Condition: `small_damaged` | `20` | `8 / 20` (`40.0%`, `[21.9%, 61.3%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `+60.0 pp` | `10 / 10` (`100.0%`, `[72.2%, 100.0%]`) |
| Symbology: `ean13` | `40` | `34 / 40` (`85.0%`, `[70.9%, 92.9%]`) | `40 / 40` (`100.0%`, `[91.2%, 100.0%]`) | `+15.0 pp` | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) |
| Symbology: `upca` | `24` | `21 / 24` (`87.5%`, `[69.0%, 95.7%]`) | `24 / 24` (`100.0%`, `[86.2%, 100.0%]`) | `+12.5 pp` | `12 / 12` (`100.0%`, `[75.8%, 100.0%]`) |
| Symbology: `ean8` | `16` | `13 / 16` (`81.3%`, `[57.0%, 93.4%]`) | `16 / 16` (`100.0%`, `[80.6%, 100.0%]`) | `+18.8 pp` | `8 / 8` (`100.0%`, `[67.6%, 100.0%]`) |
| Device: `ios_safari_low` | `20` | `17 / 20` (`85.0%`, `[64.0%, 94.8%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `+15.0 pp` | `N/A` (absent in iOS Safari) |
| Device: `ios_safari_mid` | `20` | `17 / 20` (`85.0%`, `[64.0%, 94.8%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `+15.0 pp` | `N/A` (absent in iOS Safari) |
| Device: `android_chrome_low` | `20` | `17 / 20` (`85.0%`, `[64.0%, 94.8%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `+15.0 pp` | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) |
| Device: `android_chrome_mid` | `20` | `17 / 20` (`85.0%`, `[64.0%, 94.8%]`) | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) | `+15.0 pp` | `20 / 20` (`100.0%`, `[83.9%, 100.0%]`) |

No mandatory subgroup in `development` (`N = 80`) or `validation` (`N = 80`) regressed (minimum delta `0.0 pp >= -3.0 pp`).

---

## 4. Synthetic wrong-code stress test

Executed via `runSyntheticWrongCodeStressTest({ frameCount: 100_000 })` applying GS1 mod-10 checksum validation + 2-frame `ConsensusTracker`:

- **Total perturbed frames (`N_frames`):** `100,000`
- **Wrong checksum-valid codes accepted (`w`):** `0`
- **One-sided 95% upper bound (`-ln(0.05) / 100,000`):** `0.00002996` (`<= 0.00003`)
- **Disclosure:** This is a one-sided 95% statistical upper bound under synthetic perturbations; never claim zero real-world risk.

---

## 5. Legal & clean-room disposition (Issue #9)

Per [`docs/clean-room-policy.md`](../clean-room-policy.md) (`2026-11-18`, Aristide Wafo), black-box evaluation and named comparative publication of Scanbot are **excluded / not authorized** for Phase 0 and Phase 1. No Scanbot binary, licence, or automation is used; Phase 0 gating relies exclusively on the open-source comparison against `safeeat-current-reader` and the optional Android Chrome `BarcodeDetector` row.

---

## 6. Gate summary

- **Phase 0 `GO` gates (both `development` `N = 80` and `validation` `N = 80`):**
  - `correctWithin3s` overall lift: `+15.0 pp` (`development`) and `+15.0 pp` (`validation`), both `>= +10.0 pp`
  - Subgroup non-regression: minimum delta `0.0 pp` (`>= -3.0 pp`) across all 4 conditions, 3 symbologies, and 4 mobile device profiles
  - P95 `timeToFirstCorrectMs`: `33 ms` vs `33 ms` (not worse than baseline)
  - Wrong checksum-valid accepted: `0 / 80` in development replay, `0 / 80` in validation replay, `0 / 100,000` in synthetic stress (`95%` upper bound `0.00002996 <= 0.00003`)
  - Privacy & clean-room: `assertPrivacySafePayload` passes on [`phase0-results.json`](phase0-results.json), `validateCorpusManifest` + `checkCorpusQuotas` (`meetsQuotas: true`) pass on [`manifest.json`](manifest.json), local-only WASM loading enforced, and Scanbot excluded (`#9`).
