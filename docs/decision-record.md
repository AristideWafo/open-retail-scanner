# Decision — create an independent benchmark-first public scanner project

**Status:** PROVISIONAL (`PROVISIONAL_GO_SYNTHETIC_ONLY` — synthetic replay only; audit 2026-11-21, see `#5`, `#8`, `#10`)
**Owner:** Aristide Wafo, to confirm
**Human decision-maker:** Aristide Wafo
**Date:** 2026-11-18
**Review:** at physical mobile handset clip validation (`#5`) and SafeEat pilot integration checkpoint, or within 30 days, whichever comes first

## Question

Should Open Retail Scanner be created as an independent open-source barcode SDK, with SafeEat as its first pilot?

## Why now

The SafeEat team's previous experience suggested that Scanbot outperformed other tried readers. The scanner should be reusable outside SafeEat, while SafeEat provides the first real integration. A future implementation agent needs a bounded, evidence-based project rather than an untestable mandate to “clone Scanbot.”

## Evidence

| Claim | Classification | Evidence | Limitation / action |
|---|---|---|---|
| Scanbot was the best reader tried in SafeEat | `USER_OBSERVATION` | Project owner report | No controlled benchmark; measure in Phase 0 |
| ZXing-C++ supports EAN/UPC and is Apache-2.0 | `PRIMARY_EXTERNAL` | Official ZXing-C++ repository | Audit exact release and transitive notices before shipping |
| A WASM pipeline is clearly better than the current SafeEat reader | `UNKNOWN` (synthetic replay only) | [`benchmark/phase0-baseline-report.md`](benchmark/phase0-baseline-report.md), [`benchmark/phase0-results.json`](benchmark/phase0-results.json) (`zxing-wasm@3.1.7`, 160-clip 40-product corpus: `N=80` dev + `N=80` locked val + 100k stress) | Tuned `zxing-wasm` (`zxing-tuned-th1-tr1-ti0`: `tryHarder: true, tryRotate: true, tryInvert: false`) achieved `80/80` (`100.0%`, 95% CI `[95.4%, 100.0%]`) vs `68/80` (`85.0%`, 95% CI `[75.6%, 91.2%]`) for `safeeat-current-reader` in **both** `development` and locked `validation` (`+15.0 pp`, `0` subgroup regressions across 4 conditions / 3 symbologies / 4 mobile device profiles; `native-barcode-detector` `40/40` on Android Chrome only; `0` wrong-valid in replay and `0/100,000` synthetic wrong-valid with 95% upper bound `<= 0.00003`). Synthetic replay (rendered codes, Node, proxy reader, shimmed native detector): `safeeat-current-reader` is `zxing-wasm` with every `try*` option off, not the deployed reader, and the delta is a decoder-setting (`tryRotate`) ablation, not camera performance. Real-device clips (`#5`), the deployed reader (`#8`), and the pilot task-completion gate are pending |
| Barcode scanning is a leading SafeEat pilot funnel problem | `UNVERIFIED` | [`pilots/funnel-template.md`](pilots/funnel-template.md) | `60/120` (`50.0%`, 95% CI `[41.2%, 58.8%]`) capture/decode failure share (`>= 20%` threshold) with `20.0 pp` projected lift upper bound (`>= 5 pp`). Provenance unverified: the cited `safe-foods#15` adds a trial-log CSV export and contains no funnel counts |
| Independent governance will attract other adopters | `ASSUMPTION` | No external adopters yet | Validate with design partners after technical gates |
| Scanbot comparison is legally publishable | `DECIDED_EXCLUDED` | [`clean-room-policy.md`](clean-room-policy.md) (Issue `#9`, 2026-11-18, Aristide Wafo) | Black-box evaluation and named comparative publication of Scanbot are **excluded / not authorized** for Phase 0 and Phase 1; no Scanbot binary, licence, or automation is used |

## Options

1. **Status quo:** keep current open-source reader and do not invest.
2. **Selected experiment:** independent public benchmark-first repository using `zxing-wasm`, with SafeEat as first pilot.
3. Buy Scanbot for SafeEat and defer the independent open-source project.
4. Write a new decoder from scratch.
5. Immediately build a general multi-platform, multi-format SDK business.

## Independent advice

- Computer vision architecture: feasible for the bounded EAN/UPC matrix; use ZXing-C++ via `zxing-wasm` and differentiate in capture constraints, frame selection, and consensus.
- Open-source and business: Apache-2.0 and a narrow internal-first SDK; public support becomes a separate business and requires demand.
- Red Team: do not authorize a full SDK before a reproducible benchmark; scanner performance may not be SafeEat's dominant risk.

## Risks and controls

- **Unfalsifiable parity claim:** preregistered metrics, locked set, device matrix, subgroup reporting.
- **Product distraction:** strict formats/platform scope and Phase 0 kill criteria.
- **Wrong code:** checksum, temporal consistency, full-clip replay plus a synthetic stress set with published bounds, manual fallback.
- **Privacy leakage:** local-only processing and allow-listed diagnostics with no values or images.
- **Reverse engineering:** clean-room policy and legal gate.
- **Maintenance burden:** no supported public SDK until an owner, budget, and external demand exist.
- **Healthtech confusion:** explicit statement that a barcode only identifies a value and does not inspect food safety.
- **Pilot capture of the roadmap:** independent governance and a written pilot boundary; SafeEat-specific logic remains in SafeEat.

## Recommendation

Create the independent public repository and authorize Phase 0 only. SafeEat is the first pilot and reference integration, not the owner of the SDK contract. Phase 1 is conditional on the benchmark and pilot gates. Do not authorize a from-scratch decoder, universal parity claim, or supported SDK business yet.

## Go/no-go

The authoritative gates are in [`benchmark/protocol.md`](benchmark/protocol.md). On the frozen `v1.0.0-lite` 160-clip benchmark ([`benchmark/manifest.json`](benchmark/manifest.json), [`benchmark/phase0-results.json`](benchmark/phase0-results.json), [`benchmark/phase0-baseline-report.md`](benchmark/phase0-baseline-report.md)), `zxing-wasm@3.1.7` (`zxing-tuned-th1-tr1-ti0`) passes the Phase 0 gate checks **only as a synthetic replay** (rendered codes, Node, proxy reader, shimmed native detector), which is not a `GO`, across both `development` (`N = 80`: `100.0%` vs `85.0%`, `+15.0 pp`) and locked `validation` (`N = 80`: `100.0%` vs `85.0%`, `+15.0 pp`) splits, across all 4 conditions (`normal`, `low_light`, `glare_curved`, `small_damaged`), all 3 symbologies (`ean13`, `upca`, `ean8`), and all 4 mobile matrix device profiles (`ios_safari_low`, `ios_safari_mid`, `android_chrome_low`, `android_chrome_mid`), alongside the Android Chrome `native-barcode-detector` row (`40/40` dev, `40/40` val; not evaluated on iOS Safari), `0` wrong-valid codes in replay, `0 / 100,000` in synthetic stress (`95%` upper bound `<= 0.00003`), privacy checks, and local-only WASM enforcement. Per Issue `#9` ([`clean-room-policy.md`](clean-room-policy.md)), Scanbot evaluation and named comparison are excluded / not authorized for Phase 0 and Phase 1.

## Required human validations

| Domain | Validator | Status | Scope |
|---|---|---|---|
| Product | Project owner (Aristide Wafo) | Provisional (synthetic only; `GO` pending real-device evidence) | Phase 1 Web POC on `zxing-wasm@3.1.7` + Android Chrome `BarcodeDetector` fast path; physical handset clips (`#5`) tracked as hardware field validation |
| Legal/licensing | Aristide Wafo (`#9`, 2026-11-18) | Approved (`Excluded`) | Scanbot black-box evaluation & named comparative publication excluded / not authorized for Phase 0 and Phase 1 |
| Privacy/security | Qualified security/privacy reviewer | Pending before telemetry or external pilot | Runtime and benchmark data flows |

The Phase 0 decision is `PROVISIONAL_GO_SYNTHETIC_ONLY`. A `GO` requires real-device clips on >= 4 devices including iOS Safari and Android Chrome (`#5`), the deployed SafeEat reader (`#8`), native `BarcodeDetector` on real Chrome Android, and the SafeEat pilot task-completion gate, before any performance claim.

## Reversibility

Archive the repository or retain it as a benchmark harness if Phase 0 returns `NO-GO`. The SafeEat pilot may keep its existing reader; no production migration is required for Phase 0.
