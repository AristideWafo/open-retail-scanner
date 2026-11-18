# Preregistered barcode benchmark protocol

**Status:** FROZEN (v1.0.0-lite)
**Protocol version:** v1.0.0-lite
**Frozen config ID:** orc-protocol-v1.0.0-lite-20261118
**Owner & human decision-maker:** Aristide Wafo
**Frozen date:** 2026-11-18
**Spike budget:** at most 2 weeks, 1 person (hard kill gate if no GO/ITERATE path within 3 calendar weeks)
**Decision unlocked:** whether to invest in a supported Open Retail Scanner Web SDK
**Primary hypothesis:** an open-source pipeline built on `zxing-wasm` is clearly better than the current SafeEat reader on the bounded retail EAN/UPC use case, with no wrong checksum-valid code in replay.

## Evidence classes

- `USER_OBSERVATION`: Scanbot felt more performant in historical use by the SafeEat pilot team.
- `PRIMARY_EXTERNAL`: ZXing-C++ supports EAN/UPC and uses Apache-2.0; browser/platform constraints are documented by their maintainers.
- `UNKNOWN`: the measured performance gap versus the current reader on the pilot product corpus and target devices.

The unknown performance gap blocks any parity or superiority claim and is converted into this experiment.

## Units

- **Product unit:** one distinct physical packaged-food barcode (`productHash`).
- **Sequence unit:** one independent camera attempt (`sequenceId`) with randomized engine order.
- **Trial unit:** one engine processing one sequence under the same documented settings.

Repeated frames from one sequence are not independent observations for confidence calculations.

## Frozen device, OS, and browser matrix

| `deviceId` | Hardware tier | OS | Browser / Runtime | Native `BarcodeDetector` | Role in v1.0.0-lite |
| --- | --- | --- | --- | --- | --- |
| `ios_safari_low` | iPhone SE (2nd/3rd gen) or iPhone 11 | iOS 17 / 18 | Mobile Safari | Absent by default; WASM path mandatory | Mandatory low-tier iOS |
| `ios_safari_mid` | iPhone 13 / 14 / 15 | iOS 17 / 18 | Mobile Safari | Absent by default; WASM path mandatory | Mandatory mid-tier iOS |
| `android_chrome_low` | Redmi Note / Samsung Galaxy A-series (2–4 GB RAM) | Android 13 / 14 | Chrome Mobile | Present (`BarcodeDetector` + WASM) | Mandatory low-tier Android |
| `android_chrome_mid` | Pixel 6a / 7 / 8 or Galaxy S-series | Android 14 / 15 | Chrome Mobile | Present (`BarcodeDetector` + WASM) | Mandatory mid-tier Android |
| `ci_deterministic_replay` | GitHub Actions / local CI runner | Linux / macOS | Node.js >= 22.18 / Headless Chromium | Environment-dependent | Deterministic clip replay & synthetic stress verification (does not count toward the 4 mobile devices quota) |

## Frozen corpus quotas and coverage

- **Total distinct products:** `>= 40` distinct owned physical packaged-food products (`productHash`).
- **Mobile device coverage:** `>= 4` distinct mobile `deviceId`s spanning all four mobile matrix segments (`ios_safari_low`, `ios_safari_mid`, `android_chrome_low`, `android_chrome_mid`).
- **Mandatory condition quotas (`>= 10` distinct products per condition):**
  1. `normal`: normal light and presentation (`>= 10` distinct `productHash`)
  2. `low_light`: low light (`>= 10` distinct `productHash`)
  3. `glare_curved`: glare or curved packaging (`>= 10` distinct `productHash`)
  4. `small_damaged`: small, distant, or visibly damaged code (`>= 10` distinct `productHash`)
- **Symbologies:** `ean13`, `upca`, and `ean8` represented where products exist and reported separately (never pooled without subgroup breakdown).
- **Partitioning & manifest lock:** physical products are partitioned into `development` and locked `validation` splits so **zero** `productHash` values appear in both partitions. Each clip and product is identified only by SHA-256 hashes (`clipSha256`, `productHash`) in `manifest.json` conforming to [`docs/benchmark/manifest.schema.json`](./manifest.schema.json) (`additionalProperties: false`, no raw barcode values, frames, or image paths).
- **Sample-size caution:** with roughly 40 products, results are indicative only. Widen the corpus before any broader claim.

## Ground truth

- One person records the printed digits and symbology in the separately governed corpus store; the standard GS1 mod-10 checksum must agree.
- A second person reviews disagreements and arbitrates before evaluation (`groundTruthVerifiedByTwoOnDisagreement`).
- Assets require documented ownership, licence, or consent (`rightsAttestation: "owned_physical_product"`).
- Development and validation partitions are separated by physical product (`productHash`) and locked by SHA-256 content hashes before opening validation results.

## Engines

Record exact package/SDK, engine, build flags, browser, OS, device, and configuration for:

- current SafeEat pilot reader (primary baseline);
- `zxing-wasm` candidate;
- `zxing-wasm` (reader build, EAN/UPC only);
- Quagga2, optional;
- native `BarcodeDetector` where available;
- **Scanbot (optional informational black-box row only):** never required and never a decision gate; may only be exercised as a black box if applicable licence terms and a human legal reviewer explicitly approve.

Engines are compared by replaying identical recorded clips.

Do not tune one engine with privileged ROI, resolution, lighting, or time unless that difference is a declared production configuration. Randomize execution order to reduce learning, heat, and battery bias.

## Primary metrics, formulas, and denominators

Let $N_{\text{seq}}$ be the total number of evaluated sequences in the reporting group or mandatory subgroup.

### 1. `correctWithinNs` ($t \in \{1000, 2000, 3000, 5000\}\text{ ms}$)

$$\text{correctWithin}(t) = \frac{k_t}{N_{\text{seq}}}, \quad k_t = \left|\{ s \in \text{sequences} \mid s.\text{outcome} = \text{"correct"} \land s.\text{timeToResultMs} \le t \}\right|$$

- **Denominator:** $N_{\text{seq}}$ (all evaluated sequences in the subgroup, including `no_result`, `wrong_valid`, `camera_error`, and `engine_error`).
- **Confidence interval:** Wilson 95% score interval with $z = 1.959963984540054$ and $\hat{p} = k_t / N_{\text{seq}}$:

$$\text{CI}_{95\%} = \frac{\hat{p} + \frac{z^2}{2 N_{\text{seq}}} \pm z \sqrt{\frac{\hat{p}(1 - \hat{p})}{N_{\text{seq}}} + \frac{z^2}{4 N_{\text{seq}}^2}}}{1 + \frac{z^2}{N_{\text{seq}}}}$$

### 2. `timeToFirstCorrectMs` (P50, P90, P95)

- **Population:** sorted ascending array $T = [t_0, t_1, \dots, t_{m-1}]$ of `timeToResultMs` over sequences with `outcome === "correct"` ($m = |T|$).
- **Interpolation:** sorted linear interpolation for quantile $q \in \{0.50, 0.90, 0.95\}$:
  - Let $r = q \cdot (m - 1)$, $i = \lfloor r \rfloor$, $f = r - i$.
  - $P_q = t_i + f \cdot (t_{\min(i+1, m-1)} - t_i)$.
- **Censoring transparency:** the `no_result` count (and `noResultRate`) **must** be reported alongside P50/P90/P95 so right-censored sequences are never hidden.

### 3. `wrongValidRate`

$$\text{wrongValidRate} = \frac{w}{N}$$

- **Numerator ($w$):** number of sequences (in replay evaluation) or frames (in synthetic stress evaluation) that emit a checksum-valid code whose `canonicalValue !== groundTruthCanonicalValue`.
- **Denominator ($N$):** $N_{\text{seq}}$ for clip replay; $N_{\text{frames}} \ge 100{,}000$ for the synthetic stress test.
- **Zero-event upper bound:** when $w = 0$, publish $N$ and the one-sided 95% confidence upper bound:

$$p_{\text{upper}, 95\%} = \frac{-\ln(0.05)}{N} \approx \frac{3}{N}$$

  Never claim zero real-world risk.

### 4. `noResultRate` and `recoverableFailureRate`

$$\text{noResultRate} = \frac{|\{ s \mid s.\text{outcome} = \text{"no\_result"} \}|}{N_{\text{seq}}}$$

$$\text{recoverableFailureRate} = \frac{|\{ s \mid s.\text{outcome} \in \{\text{"camera\_error"}, \text{"engine\_error"}\} \}|}{N_{\text{seq}}}$$

- **Denominator:** $N_{\text{seq}}$ for both metrics.
- **Pilot integration metric:** end-to-end task completion and abandonment in the SafeEat pilot integration (measured separately in the pilot funnel).

## Secondary metrics

- Cold initialization P50 / P95 (`initializationMs`).
- Main-thread long tasks over 50 ms (`longTaskCount`).
- CPU, memory (`peakMemoryClass`), analyzed FPS, battery, and thermal observations.
- Compressed lazy-loaded bundle size.
- Camera crash, hang, permission denial, and interruption rates.
- Subgroup breakdowns by `symbology`, `condition`, `deviceId` (tier, OS, browser).

## Decision gates

The primary comparison is the current SafeEat pilot reader. The three decision outcomes below (`GO`, `ITERATE`, `NO-GO`) are **mutually exclusive**:

1. Evaluate **`NO-GO`** conditions first; if any applies, the outcome is `NO-GO`.
2. Otherwise, if all **`GO`** conditions pass, the outcome is `GO`.
3. Otherwise, the outcome is **`ITERATE`** (provided wrong-code, privacy, clean-room, and spike-budget constraints hold).

### Wrong-code measurement

Wrong checksum-valid acceptance is measured by:

1. replaying every recorded clip (all frames, per-frame decode, then the consensus policy);
2. a synthetic stress set of at least 100,000 frames built from noise, blur, occlusion, and partial-bar perturbations of real frames, with the consensus policy applied.

Publish denominators and the one-sided 95% upper bound (`-ln(0.05) / N`, rule of three: `~3 / N` when `w = 0`). Zero wrong-valid is required in the replay set. Never claim zero real-world risk.

### `GO`

All must pass (and no `NO-GO` condition applies):

- `correctWithinNs(3000)` at least 10 percentage points above the current SafeEat reader overall;
- no mandatory subgroup (`condition`, `symbology`, or mobile `deviceId` tier) more than 3 percentage points worse than the current SafeEat reader on `correctWithinNs(3000)`;
- `timeToFirstCorrectMs` P95 not worse than the current SafeEat reader;
- zero wrong checksum-valid codes (`w = 0`) in the replay set, with the synthetic stress-set denominator and one-sided 95% upper bound published;
- camera failure outside user denial below 2% on each platform segment;
- manual entry reachable in 100% of recoverable failure paths;
- privacy and teardown tests pass;
- SafeEat pilot end-to-end integration shows at least a 5 percentage-point improvement in completed tasks over its current reader.

Scanbot comparison is an **optional informational black-box row only** and is never a gate (subject to licence and human legal review).

### `ITERATE`

Applies when neither `NO-GO` nor `GO` is triggered:

- no wrong-code, privacy, or clean-room gate fails;
- at least one `GO` performance criterion is missed by a margin plausibly addressable within the remaining spike budget (at most 2 weeks / 1 person, hard cap 3 calendar weeks).

### `NO-GO`

Any applies:

- fewer than 20% of observed SafeEat pilot failures/abandons are attributable to barcode capture or decoding;
- projected improvement in completed SafeEat pilot tasks is below 5 percentage points;
- a wrong-code, privacy, or clean-room incident is unresolved;
- no `GO` or `ITERATE` path within 3 calendar weeks of spike work;
- no named maintainer.

## Known platform limits

- iOS Safari gives weak camera control (no reliable focus mode control), so parity on iOS may be capped by the platform, not the decoder.
- Native `BarcodeDetector` is not available by default in iOS Safari; it exists in Chrome on Android, ChromeOS, and macOS. The WASM path is therefore mandatory.

## Analysis

- Report denominators and Wilson 95% confidence intervals, not only percentages.
- Report every mandatory subgroup (`condition`, `symbology`, `deviceId`); do not hide a failed subgroup behind an average.
- Report `no_result` counts alongside `timeToFirstCorrectMs` quantiles.
- For zero observed wrong-code events, publish the denominators and the one-sided 95% upper bound; never say real-world risk is zero.
- Freeze analysis code before opening the validation results.
- Keep raw aggregate measurements immutable and append corrections with provenance.

## Incident procedure

Stop validation immediately for a wrong accepted code, undisclosed transmission/persistence, corpus-rights issue, proprietary-licence concern, or repeatable camera hang. Preserve only permitted diagnostic metadata, open a private security/legal incident, and invalidate affected runs.

## Publication limitations

Passing this protocol supports only the named versions, device matrix, formats, conditions, and dates. It is not evidence of universal scanner superiority. A legal reviewer must approve any named commercial comparison before publication.
