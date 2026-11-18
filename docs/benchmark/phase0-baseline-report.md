# Phase 0 baseline report (deterministic CI replay & wrong-code stress)

**Protocol version:** `v1.0.0-lite` (`orc-protocol-v1.0.0-lite-20261118`)  
**Corpus version:** `phase0-deterministic-v1` (40 distinct product sequences, `development` partition)  
**Engine:** `zxing-wasm@3.1.7` (`zxing-cpp@f19f7c6e0509fe0eeb822bf35c41b0f637dec290`)  
**WASM artifact:** local `zxing_reader.wasm` (946,598 bytes uncompressed; remote CDN URLs blocked)  
**Runtime:** `ci_deterministic_replay` (Node.js >= 22.18, 3 frames/clip @ 33 ms cadence, 2-frame `ConsensusTracker`)  
**Date:** 2026-11-18  

> **Scope limitation:** This report documents reproducible deterministic CI replay measurements on rendered GS1 EAN-8, EAN-13, and UPC-A pixel frames and a 100,000-frame synthetic wrong-code stress test. It does **not** claim universal scanner parity or physical mobile camera performance; physical mobile camera clips across the 4-device matrix (`ios_safari_low`, `ios_safari_mid`, `android_chrome_low`, `android_chrome_mid`) and the locked `validation` split remain an ongoing field validation track (`#5`).

---

## 1. Configurations compared

All configurations ran identically through `runReplayBenchmark` (`seed = 20261118`) with `formats: ["ean8", "ean13", "upca"]` and `returnErrors: false`:

| Configuration ID | `tryHarder` | `tryRotate` | `tryInvert` | `tryDownscale` | Role |
|---|---|---|---|---|---|
| `safeeat-baseline-single-pass` | `false` | `false` | `false` | `false` | Current SafeEat-equivalent single-pass baseline |
| `zxing-ablation-no-tryRotate` | `true` | `false` | `false` | `true` | Rotation ablation |
| `zxing-ablation-no-tryHarder` | `false` | `true` | `false` | `true` | Effort/scanline-density ablation |
| `zxing-tuned-th1-tr1-ti0` | `true` | `true` | `false` | `true` | Tuned `zxing-wasm` Phase 1 candidate |
| `zxing-ablation-tryInvert-on` | `true` | `true` | `true` | `true` | Inverted-reflectance ablation |

Native `BarcodeDetector` is not present in Node.js CI (`ci_deterministic_replay`) or by default in iOS Safari (`ios_safari_low`, `ios_safari_mid`). Per [ADR 0003](../adr/0003-native-barcodedetector-fast-path.md), `zxing-wasm` is the mandatory universal baseline, while native `BarcodeDetector` remains an optional Chromium fast path to be benchmarked on Android/desktop hardware during field validation (`#5`).

---

## 2. Overall results (`N_seq = 40` per configuration)

| Configuration | `correctWithin3s` (`k / N`) | Wilson 95% CI | `timeToFirstCorrectMs` (P50 / P90 / P95) | `noResultRate` | `wrongValidCount` (95% upper bound) | `recoverableFailureRate` | Cold init P50 / P95 |
|---|---|---|---|---|---|---|---|
| `safeeat-baseline-single-pass` | `35 / 40` (`87.5%`) | `[73.9%, 94.5%]` | `33 / 33 / 33 ms` | `12.5%` (`5 / 40`) | `0 / 40` (`<= 0.0749`) | `0.0%` (`0 / 40`) | `2.12 / 3.11 ms` |
| `zxing-ablation-no-tryRotate` | `35 / 40` (`87.5%`) | `[73.9%, 94.5%]` | `33 / 33 / 33 ms` | `12.5%` (`5 / 40`) | `0 / 40` (`<= 0.0749`) | `0.0%` (`0 / 40`) | `2.19 / 3.40 ms` |
| `zxing-ablation-no-tryHarder` | `40 / 40` (`100.0%`) | `[91.2%, 100.0%]` | `33 / 33 / 33 ms` | `0.0%` (`0 / 40`) | `0 / 40` (`<= 0.0749`) | `0.0%` (`0 / 40`) | `2.15 / 3.17 ms` |
| `zxing-tuned-th1-tr1-ti0` | `40 / 40` (`100.0%`) | `[91.2%, 100.0%]` | `33 / 33 / 33 ms` | `0.0%` (`0 / 40`) | `0 / 40` (`<= 0.0749`) | `0.0%` (`0 / 40`) | `2.35 / 3.69 ms` |
| `zxing-ablation-tryInvert-on` | `40 / 40` (`100.0%`) | `[91.2%, 100.0%]` | `33 / 33 / 33 ms` | `0.0%` (`0 / 40`) | `0 / 40` (`<= 0.0749`) | `0.0%` (`0 / 40`) | `2.15 / 3.32 ms` |

- `correctWithin1s`, `correctWithin2s`, `correctWithin3s`, and `correctWithin5s` are identical within this 3-frame/clip cadence (`0 ms`, `33 ms`, `66 ms`).
- **Delta (`zxing-tuned-th1-tr1-ti0` vs `safeeat-baseline-single-pass`):** `+12.5` percentage points overall on `correctWithin3s`, exceeding the protocol's `>= +10` percentage-point `GO` threshold.
- **Ablation takeaways:**
  - `tryRotate: true` accounts for the `+12.5` pp improvement (`5 / 5` rotated `small_damaged` sequences recovered).
  - `tryInvert: true` is neutral on standard dark-on-light retail prints (`100.0%` vs `100.0%`), so `tryInvert: false` remains the default (configurable by callers).
  - `tryHarder: true` is retained as the default for physical camera low-light/motion-blur margin while preserving P95 cold init under `4 ms` in Node.js cached WASM loading.

---

## 3. Mandatory subgroup breakdowns (`safeeat-baseline-single-pass` vs `zxing-tuned-th1-tr1-ti0`)

### By condition (`N_seq = 10` per subgroup)

| Condition | Baseline `correctWithin3s` | Baseline Wilson 95% CI | Baseline `noResultRate` | Tuned `correctWithin3s` | Tuned Wilson 95% CI | Tuned `noResultRate` | Delta |
|---|---|---|---|---|---|---|---|
| `normal` | `10 / 10` (`100.0%`) | `[72.2%, 100.0%]` | `0.0%` | `10 / 10` (`100.0%`) | `[72.2%, 100.0%]` | `0.0%` | `0.0 pp` |
| `low_light` | `10 / 10` (`100.0%`) | `[72.2%, 100.0%]` | `0.0%` | `10 / 10` (`100.0%`) | `[72.2%, 100.0%]` | `0.0%` | `0.0 pp` |
| `glare_curved` | `10 / 10` (`100.0%`) | `[72.2%, 100.0%]` | `0.0%` | `10 / 10` (`100.0%`) | `[72.2%, 100.0%]` | `0.0%` | `0.0 pp` |
| `small_damaged` | `5 / 10` (`50.0%`) | `[23.7%, 76.3%]` | `50.0%` | `10 / 10` (`100.0%`) | `[72.2%, 100.0%]` | `0.0%` | `+50.0 pp` |

### By symbology

| Symbology | `N_seq` | Baseline `correctWithin3s` | Baseline Wilson 95% CI | Tuned `correctWithin3s` | Tuned Wilson 95% CI | Delta |
|---|---|---|---|---|---|---|
| `ean13` | `20` | `18 / 20` (`90.0%`) | `[69.9%, 97.2%]` | `20 / 20` (`100.0%`) | `[83.9%, 100.0%]` | `+10.0 pp` |
| `upca` | `12` | `10 / 12` (`83.3%`) | `[55.2%, 95.3%]` | `12 / 12` (`100.0%`) | `[75.8%, 100.0%]` | `+16.7 pp` |
| `ean8` | `8` | `7 / 8` (`87.5%`) | `[52.9%, 97.8%]` | `8 / 8` (`100.0%`) | `[67.6%, 100.0%]` | `+12.5 pp` |

No subgroup in `zxing-tuned-th1-tr1-ti0` regressed relative to `safeeat-baseline-single-pass` (minimum delta `0.0 pp`, well within the `<= 3 pp` non-regression gate).

---

## 4. Synthetic wrong-code stress test

Executed via `runSyntheticWrongCodeStressTest({ frameCount: 100_000 })` applying GS1 mod-10 checksum validation + 2-frame `ConsensusTracker`:

- **Total perturbed frames (`N_frames`):** `100,000` (truncated partial reads, blur/non-digit glyphs, single-digit noise, multi-digit severe noise, symbology boundary shifts)
- **Wrong checksum-valid codes accepted (`w`):** `0`
- **One-sided 95% upper bound (`-ln(0.05) / 100,000`):** `0.00002996` (`<= 0.00003`)
- **Disclosure:** This is a one-sided 95% statistical upper bound under synthetic perturbations; never claim zero real-world risk.

---

## 5. Gate summary & next track

- **Deterministic replay gates:** `correctWithin3s` delta `+12.5 pp` (`>= +10 pp`), `0` subgroup regressions, P95 latency `33 ms` (not worse than baseline), `0` wrong-valid codes in replay (`40 / 40`) and `0 / 100,000` in synthetic stress (`<= 0.00003` 95% upper bound), privacy/bounds/teardown tests passing, local-only WASM loading enforced.
- **Open field-validation track (`#5`):** Real physical camera recordings across `ios_safari_low`, `ios_safari_mid`, `android_chrome_low`, and `android_chrome_mid`, native `BarcodeDetector` comparison on Android Chrome, locked `validation` split execution after analysis freeze, and SafeEat pilot funnel confirmation (`>= 20%` capture/decode failure share and `>= 5 pp` end-to-end task completion lift).
