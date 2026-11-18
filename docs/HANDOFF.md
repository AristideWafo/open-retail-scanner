# Implementation handoff

## Read first

1. [`AGENTS.md`](../AGENTS.md)
2. [`docs/product-scope.md`](product-scope.md)
3. [`docs/benchmark/protocol.md`](benchmark/protocol.md)
4. [`docs/architecture.md`](architecture.md)
5. [`docs/clean-room-policy.md`](clean-room-policy.md)
6. [`docs/pilots/safeeat.md`](pilots/safeeat.md)
7. GitHub milestone `Phase 0 — Evidence` and its issues

## First assignment

Deliver, in order, without a polished scanner UI or any published performance claim:

1. a funnel measurement note: share of SafeEat failures/abandons from camera/decode versus network, lookup, and data;
2. clip recording and a replay harness (lite): raw clips from 4–6 devices, about 40 products, 4 conditions, replayed identically through each engine;
3. a baseline report with denominators and Wilson confidence intervals.

Include CI tests proving values and frames cannot enter diagnostics.

## Decisions already made

- initial formats: EAN-8, EAN-13, UPC-A;
- first platform: Web/PWA;
- initial decoder: `zxing-wasm` package, with native `BarcodeDetector` as an optional fast path;
- local-only processing;
- Apache-2.0 project licence;
- independent project governance; SafeEat is the first pilot, not the SDK owner;
- no proprietary reverse engineering;
- no public parity claim before measurement and legal review; parity with Scanbot is not a gate.

## Decisions still open

- exact corpus assets and their rights;
- supported device/browser matrix;
- acceptable bundle budget;
- canonical UPC-A/EAN-13 representation;
- temporal-consensus policy;
- benchmark automation boundary for commercial engines;
- named product owner and long-term maintenance budget.

## Definition of ready for Phase 1

- protocol reviewed and gates fixed before results are opened;
- funnel measurement note shows at least 20% of failures/abandons are camera/decode;
- clips recorded, development split and locked split created legally;
- device matrix named, including iOS Safari and Android Chrome;
- baseline report produced;
- Phase 0 decision issue closed with `GO`.

Scanbot legal review is not required for Phase 1; it blocks only a named commercial comparison.
