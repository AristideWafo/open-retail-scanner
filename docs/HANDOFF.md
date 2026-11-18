# Implementation handoff

## Read first

1. [`AGENTS.md`](../AGENTS.md)
2. [`docs/product-scope.md`](product-scope.md)
3. [`docs/benchmark/protocol.md`](benchmark/protocol.md)
4. [`docs/architecture.md`](architecture.md)
5. [`docs/clean-room-policy.md`](clean-room-policy.md)
6. GitHub milestone `Phase 0 — Evidence` and its issues

## First assignment

Deliver the benchmark harness and a baseline report. Do not implement a polished scanner UI or publish performance claims in the first assignment.

Expected first PR:

- schema for test cases, runs, devices, engines, conditions, and aggregate results;
- fixture validation and corpus manifest tooling;
- recorded-input adapter that invokes open-source engines deterministically;
- aggregate metrics and confidence intervals;
- CI tests proving values/crops cannot enter diagnostics;
- documentation for adding a device run without changing the locked validation set.

## Decisions already made

- initial formats: EAN-8, EAN-13, UPC-A;
- first platform: Web/PWA;
- initial decoder candidate: ZXing-C++/WASM;
- local-only processing;
- Apache-2.0 project licence;
- no proprietary reverse engineering;
- no public parity claim before passing the locked benchmark and legal review.

## Decisions still open

- exact corpus assets and their rights;
- supported device/browser matrix;
- acceptable bundle budget;
- canonical UPC-A/EAN-13 representation;
- temporal-consensus policy;
- benchmark automation boundary for commercial engines;
- named product owner and long-term maintenance budget.

## Definition of ready for Phase 1

- protocol preregistered and reviewed;
- corpus development split and locked validation split created legally;
- device matrix named;
- Scanbot black-box testing permission reviewed by counsel;
- baseline report produced;
- Phase 0 decision issue closed with `GO`.
