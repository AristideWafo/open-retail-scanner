# Decision — create an independent benchmark-first public scanner project

**Status:** PROPOSED
**Owner:** Aristide Wafo, to confirm
**Human decision-maker:** Aristide Wafo
**Date:** 2026-11-18
**Review:** at the Phase 0 gate or within 30 days, whichever comes first

## Question

Should Open Retail Scanner be created as an independent open-source barcode SDK, with SafeEat as its first pilot?

## Why now

The SafeEat team's previous experience suggested that Scanbot outperformed other tried readers. The scanner should be reusable outside SafeEat, while SafeEat provides the first real integration. A future implementation agent needs a bounded, evidence-based project rather than an untestable mandate to “clone Scanbot.”

## Evidence

| Claim | Classification | Evidence | Limitation / action |
|---|---|---|---|
| Scanbot was the best reader tried in SafeEat | `USER_OBSERVATION` | Project owner report | No controlled benchmark; measure in Phase 0 |
| ZXing-C++ supports EAN/UPC and is Apache-2.0 | `PRIMARY_EXTERNAL` | Official ZXing-C++ repository | Audit exact release and transitive notices before shipping |
| A WASM pipeline is clearly better than the current SafeEat reader | `UNKNOWN` | None yet | Parity with Scanbot is not a gate. Target: clearly better than the current reader on the replay corpus, with zero wrong-valid in replay |
| Barcode scanning is a leading SafeEat pilot funnel problem | `UNKNOWN` | No separated funnel evidence | Pilot must separate camera, decode, network, lookup, and data-quality failures |
| Independent governance will attract other adopters | `ASSUMPTION` | No external adopters yet | Validate with design partners after technical gates |
| Scanbot comparison is legally publishable | `UNKNOWN` | Terms require current human review | Block named publication until counsel approves; comparison is optional and not a gate |

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

The authoritative gates are in [`benchmark/protocol.md`](benchmark/protocol.md).

## Required human validations

| Domain | Validator | Status | Scope |
|---|---|---|---|
| Product | Project owner | Pending | Phase 0 budget, owner, target matrix |
| Legal/licensing | Qualified counsel | Pending | Clean-room process, Scanbot terms, comparative publication |
| Privacy/security | Qualified security/privacy reviewer | Pending before telemetry or external pilot | Runtime and benchmark data flows |

The decision remains `PROPOSED`; agent consensus is not human approval.

## Reversibility

Archive the repository or retain it as a benchmark harness if Phase 0 returns `NO-GO`. The SafeEat pilot may keep its existing reader; no production migration is required for Phase 0.
