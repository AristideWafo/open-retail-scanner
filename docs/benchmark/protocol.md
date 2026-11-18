# Preregistered barcode benchmark protocol

**Status:** draft; lock before collecting validation results
**Decision unlocked:** whether to invest in a supported Open Retail Scanner Web SDK
**Primary hypothesis:** an open-source pipeline built on `zxing-wasm` is clearly better than the current SafeEat reader on the bounded retail EAN/UPC use case, with no wrong checksum-valid code in replay.

## Evidence classes

- `USER_OBSERVATION`: Scanbot felt more performant in historical use by the SafeEat pilot team.
- `PRIMARY_EXTERNAL`: ZXing-C++ supports EAN/UPC and uses Apache-2.0; browser/platform constraints are documented by their maintainers.
- `UNKNOWN`: the measured performance gap versus the current reader on the pilot product corpus and target devices.

The unknown performance gap blocks any parity or superiority claim and is converted into this experiment.

## Units

- **Product unit:** one distinct physical packaged-food barcode.
- **Sequence unit:** one independent camera attempt with randomized engine order.
- **Trial unit:** one engine processing one sequence under the same documented settings.

Repeated frames from one sequence are not independent observations for confidence calculations.

## Minimum coverage

- At least 40 distinct physical products, at least 10 per condition.
- At least 4 device/OS/browser combinations, including iOS Safari and Android Chrome, low and mid tier.
- EAN-8, EAN-13, and UPC-A represented where products exist; report each separately.
- Four mandatory conditions:
  1. normal light and presentation;
  2. low light;
  3. glare or curved packaging;
  4. small, distant, or visibly damaged code.
- Report per symbology and per condition with Wilson confidence intervals.
- With about 40 products, results are indicative only. Widen the corpus before any broader claim.

The final matrix and quotas must be frozen in `manifest.json` before validation.

## Ground truth

- One person records the printed digits and symbology; the standard checksum must agree.
- A second person reviews only disagreements and arbitrates before evaluation.
- The standard checksum is verified.
- Assets require documented ownership, licence, or consent.
- Development and validation partitions are separated by physical product and locked by content hash.

## Engines

Record exact package/SDK, engine, build flags, browser, OS, device, and configuration for:

- current SafeEat pilot reader;
- `zxing-wasm` candidate;
- `zxing-wasm` (reader build, EAN/UPC only);
- Quagga2, optional;
- native `BarcodeDetector` where available;
- Scanbot only as an optional, informational black box after legal approval; never a gate.

Engines are compared by replaying identical recorded clips.

Do not tune one engine with privileged ROI, resolution, lighting, or time unless that difference is a declared production configuration. Randomize execution order to reduce learning, heat, and battery bias.

## Primary metrics

- Correct result within 1, 2, 3, and 5 seconds.
- Time to first correct detection: P50, P90, and P95.
- Wrong but checksum-valid code accepted.
- No-result and recoverable-failure rate.
- End-to-end task completion and abandonment in the SafeEat pilot integration.

## Secondary metrics

- Cold initialization P50/P95.
- Main-thread long tasks over 50 ms.
- CPU, memory, analyzed FPS, battery, and thermal observations.
- Compressed lazy-loaded bundle size.
- Camera crash, hang, permission, and interruption rates.
- Results by symbology, condition, device tier, OS, and browser.

## Gates

The primary comparison is the current SafeEat reader.

### Wrong-code measurement

Wrong checksum-valid acceptance is measured by:

1. replaying every recorded clip (all frames, per-frame decode, then the consensus policy);
2. a synthetic stress set of at least 100,000 frames built from noise, blur, occlusion, and partial-bar perturbations of real frames, with the consensus policy applied.

Publish denominators and a one-sided 95% upper bound (rule of three: 0 events in N gives a bound of about 3/N). Zero wrong-valid is required in the replay set. Never claim zero real-world risk.

### `GO`

All must pass:

- correct within 3 seconds at least 10 points above the current reader overall;
- no mandatory subgroup more than 3 points worse than the current reader;
- P95 time-to-result not worse than the current reader;
- zero wrong checksum-valid codes in the replay set, with the stress-set bound published;
- camera failure outside user denial below 2% on each platform segment;
- manual entry reachable in 100% of recoverable failure paths;
- privacy and teardown tests pass.

The end-to-end SafeEat pilot additionally requires a completed-task improvement of at least 5 percentage points over its current reader.

Scanbot comparison is an optional informational row, never a gate (legal and licence dependency).

### `ITERATE`

No wrong-code or privacy gate fails, and the candidate misses a performance gate by an amount plausibly addressable within the remaining spike budget.

### `NO-GO`

Any applies:

- fewer than 20% of observed SafeEat pilot failures/abandons are attributable to barcode capture or decoding;
- projected improvement in completed tasks is below 5 points;
- a wrong-code, privacy, or clean-room incident is unresolved;
- no `GO` or `ITERATE` path within 3 calendar weeks of spike work;
- no named maintainer.

## Known platform limits

- iOS Safari gives weak camera control (no reliable focus mode control), so parity on iOS may be capped by the platform, not the decoder.
- Native `BarcodeDetector` is not available by default in iOS Safari; it exists in Chrome on Android, ChromeOS, and macOS. The WASM path is therefore mandatory.

## Analysis

- Report denominators and confidence intervals, not only percentages.
- Report every mandatory subgroup; do not hide a failed subgroup behind an average.
- For zero observed wrong-code events, publish the denominators and the one-sided 95% upper bound; never say real-world risk is zero.
- Freeze analysis code before opening the validation results.
- Keep raw aggregate measurements immutable and append corrections with provenance.

## Incident procedure

Stop validation immediately for a wrong accepted code, undisclosed transmission/persistence, corpus-rights issue, proprietary-licence concern, or repeatable camera hang. Preserve only permitted diagnostic metadata, open a private security/legal incident, and invalidate affected runs.

## Publication limitations

Passing this protocol supports only the named versions, device matrix, formats, conditions, and dates. It is not evidence of universal scanner superiority. A legal reviewer must approve any named commercial comparison before publication.
