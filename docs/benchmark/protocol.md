# Preregistered barcode benchmark protocol

**Status:** draft; lock before collecting validation results
**Decision unlocked:** whether to invest in a supported Open Retail Scanner Web SDK
**Primary hypothesis:** an open-source pipeline can be non-inferior to the approved Scanbot baseline on the bounded retail EAN/UPC use case.

## Evidence classes

- `USER_OBSERVATION`: Scanbot felt more performant in historical use by the SafeEat pilot team.
- `PRIMARY_EXTERNAL`: ZXing-C++ supports EAN/UPC and uses Apache-2.0; browser/platform constraints are documented by their maintainers.
- `UNKNOWN`: the measured performance gap on the pilot product corpus and target devices.

The unknown performance gap blocks any parity claim and is converted into this experiment.

## Units

- **Product unit:** one distinct physical packaged-food barcode.
- **Sequence unit:** one independent camera attempt with randomized engine order.
- **Trial unit:** one engine processing one sequence under the same documented settings.

Repeated frames from one sequence are not independent observations for confidence calculations.

## Minimum coverage

- At least 150 distinct physical products.
- At least 12 target device/OS/browser combinations.
- EAN-8, EAN-13, and UPC-A represented; report each separately.
- Four mandatory conditions:
  1. normal light and presentation;
  2. low light;
  3. glare or curved packaging;
  4. small, distant, or visibly damaged code.
- Include low-, mid-, and high-tier devices; current iOS Safari/PWA and Android Chrome must be represented if they are target segments.

The final matrix and quotas must be frozen in `manifest.json` before validation.

## Ground truth

- Two independent annotators record the printed digits and symbology.
- Disagreements are arbitrated before evaluation.
- The standard checksum is verified.
- Assets require documented ownership, licence, or consent.
- Development and validation partitions are separated by physical product and locked by content hash.

## Engines

Record exact package/SDK, engine, build flags, browser, OS, device, and configuration for:

- current SafeEat pilot reader;
- ZXing-C++/WASM candidate;
- Quagga2 baseline;
- native `BarcodeDetector` where available;
- Scanbot only as a documented black box after legal approval.

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

### `GO`

All must pass:

- success within 3 seconds is no more than 2 percentage points below Scanbot overall;
- no critical subgroup is more than 5 points below Scanbot;
- candidate P95 detection time is at most 1.2 times Scanbot P95;
- no wrong checksum-valid code across at least 10,000 independent sequences, with the confidence bound and denominator published;
- camera failure outside user denial is below 2% on each target platform segment;
- candidate improves the SafeEat pilot's completed-task rate by at least 5 percentage points over its current reader;
- manual entry is reachable in 100% of recoverable failure paths;
- privacy and teardown tests pass.

### `ITERATE`

No wrong-code or privacy gate fails, and the candidate misses a performance gate by an amount plausibly addressable within the remaining spike budget.

### `NO-GO`

Any applies:

- fewer than 20% of observed SafeEat pilot failures/abandons are attributable to barcode capture or decoding;
- projected improvement in completed tasks is below 5 points;
- a wrong-code, privacy, or clean-room incident is unresolved;
- no path to `GO` exists within six engineer-weeks or four calendar weeks of spike work;
- projected maintenance exceeds 0.5 FTE/year without validated external demand.

## Analysis

- Report denominators and confidence intervals, not only percentages.
- Report every mandatory subgroup; do not hide a failed subgroup behind an average.
- For zero observed wrong-code events, publish the independent-trial count and a one-sided confidence bound; never say real-world risk is zero.
- Freeze analysis code before opening the validation results.
- Keep raw aggregate measurements immutable and append corrections with provenance.

## Incident procedure

Stop validation immediately for a wrong accepted code, undisclosed transmission/persistence, corpus-rights issue, proprietary-licence concern, or repeatable camera hang. Preserve only permitted diagnostic metadata, open a private security/legal incident, and invalidate affected runs.

## Publication limitations

Passing this protocol supports only the named versions, device matrix, formats, conditions, and dates. It is not evidence of universal scanner superiority. A legal reviewer must approve any named commercial comparison before publication.
