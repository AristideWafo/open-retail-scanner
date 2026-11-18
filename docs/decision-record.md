# Decision — create a benchmark-first public scanner repository

**Status:** PROPOSED
**Owner:** Aristide Wafo, to confirm
**Human decision-maker:** Aristide Wafo
**Date:** 2026-11-18
**Review:** at the Phase 0 gate or within 30 days, whichever comes first

## Question

Should SafeEat create a public open-source barcode SDK intended to approach Scanbot performance?

## Why now

The previous SafeEat experience suggested that Scanbot outperformed other tried readers. A future implementation agent needs a bounded, evidence-based repository rather than an untestable mandate to “clone Scanbot.”

## Evidence

| Claim | Classification | Evidence | Limitation / action |
|---|---|---|---|
| Scanbot was the best reader tried in SafeEat | `USER_OBSERVATION` | Project owner report | No controlled benchmark; measure in Phase 0 |
| ZXing-C++ supports EAN/UPC and is Apache-2.0 | `PRIMARY_EXTERNAL` | Official ZXing-C++ repository | Audit exact release and transitive notices before shipping |
| A WASM pipeline can match Scanbot on the target matrix | `UNKNOWN` | None yet | Critical unknown converted to locked benchmark |
| Barcode scanning is a leading SafeEat funnel problem | `UNKNOWN` | No separated funnel evidence | Instrument camera, decode, network, lookup, and data-quality failures |
| Scanbot comparison is legally publishable | `UNKNOWN` | Terms require current human review | Block named publication until counsel approves |

## Options

1. **Status quo:** keep current open-source reader and do not invest.
2. **Selected experiment:** public benchmark-first repository using ZXing-C++/WASM and a SafeEat-owned capture pipeline.
3. Buy Scanbot for SafeEat and defer open-source development.
4. Write a new decoder from scratch.
5. Immediately build a general multi-platform, multi-format SDK business.

## Independent advice

- Computer vision architecture: feasible for the bounded EAN/UPC matrix; use ZXing-C++ and differentiate in capture/localization/preprocessing/consensus.
- Open-source and business: Apache-2.0 and a narrow internal-first SDK; public support becomes a separate business and requires demand.
- Red Team: do not authorize a full SDK before a reproducible benchmark; scanner performance may not be SafeEat's dominant risk.

## Risks and controls

- **Unfalsifiable parity claim:** preregistered metrics, locked set, device matrix, subgroup reporting.
- **Product distraction:** strict formats/platform scope and Phase 0 kill criteria.
- **Wrong code:** checksum, temporal consistency, at least 10,000 independent trials, manual fallback.
- **Privacy leakage:** local-only processing and allow-listed diagnostics with no values or images.
- **Reverse engineering:** clean-room policy and legal gate.
- **Maintenance burden:** no supported public SDK until an owner, budget, and external demand exist.
- **Healthtech confusion:** explicit statement that a barcode only identifies a value and does not inspect food safety.

## Recommendation

Create the public repository and authorize Phase 0 only. Phase 1 is conditional on the benchmark and funnel gates. Do not authorize a from-scratch decoder, universal parity claim, or general SDK business.

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

Archive the repository or retain it as a benchmark harness if Phase 0 returns `NO-GO`. No SafeEat production migration is required for Phase 0.
