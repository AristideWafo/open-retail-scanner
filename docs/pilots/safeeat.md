# Pilot charter — SafeEat

## Relationship

Open Retail Scanner is an independent open-source project. SafeEat is its first pilot integrator and reference use case for packaged-food EAN/UPC scanning.

SafeEat does not own the SDK contract and the SDK does not inherit SafeEat's healthtech purpose. Changes learned through the pilot are accepted only when they improve the general scanner or are expressed through public extension points.

## Pilot hypothesis

On SafeEat's target device/browser matrix, Open Retail Scanner can reduce barcode capture and decoding friction without increasing wrong accepted codes, privacy exposure, or user misunderstanding.

## Responsibilities

### Open Retail Scanner

- capture and decode EAN-8, EAN-13, and UPC-A;
- expose raw/canonical values, observed format, bounds, engine version, and evidence;
- distinguish camera, lifecycle, engine, and timeout failures;
- provide accessible guidance and a manual-entry fallback;
- process locally and emit no image, code value, product identity, health, or profile telemetry.

### SafeEat

- integrate through the public SDK contract without forking hidden health logic into the scanner;
- own product lookup, Open Food Facts access, label/OCR workflow, user profile, allergen comparison, health-related wording, and application consent;
- preserve the distinction between a decoded code and verified current label information;
- instrument the funnel using an approved allow-list without frames, code values, product identities, profiles, or health data;
- provide aggregate pilot findings and reproducible non-sensitive defects upstream.

## Boundary

```text
Open Retail Scanner                     SafeEat
camera → decode → validated code event  → product lookup → label review → SafeEat analysis
```

A successful barcode event means only that a checksum-valid value was consistently observed. It does not prove product identity, database freshness, ingredient accuracy, allergen absence, or suitability for consumption.

## Pilot population and matrix

SafeEat defines its target devices and browsers before collection. The pilot initially covers packaged food carrying EAN-8, EAN-13, or UPC-A. Restaurants, unpackaged food, OCR, QR, and clinical decisions are outside the scanner pilot.

## Measures

- camera start and recoverable failure rates;
- correct decode within 1, 2, 3, and 5 seconds;
- P50/P90/P95 time to first correct result;
- wrong checksum-valid result events;
- fallback use;
- completed SafeEat task and abandonment, separated from network, product lookup, and data-quality failures;
- accessibility and comprehension incidents caused by the scanner boundary.

## Gates

- `GO`: the core benchmark gates pass (correct within 3 s at least 10 points above the current reader overall is the core metric) and, in the end-to-end pilot, SafeEat completed-task rate improves by at least 5 percentage points over its current reader.
- `ITERATE`: no wrong-code, privacy, or comprehension gate fails and remaining performance gaps fit the approved spike budget.
- `NO-GO`: barcode causes fewer than 20% of SafeEat failures/abandons, projected completion gain is below 5 points, no GO or ITERATE path exists within 3 calendar weeks of spike work, or any unresolved wrong-code/privacy/clean-room incident exists.

These are preregistered working thresholds, not a claim of universal performance or health safety.

## Data and incident separation

Open Retail Scanner receives no SafeEat profiles, symptoms, health data, product histories, or remote database records. A scanner incident and a SafeEat analysis incident use separate taxonomies and owners. Any ambiguity is escalated to both owners without combining sensitive logs.

## Exit and portability

SafeEat can replace the SDK without forking the project. Open Retail Scanner can add other pilots without access to SafeEat data. Pilot-specific adapters live in the SafeEat repository unless they are demonstrably generic.
