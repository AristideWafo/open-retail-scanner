# Contributing

Thank you for helping build an auditable scanner.

## Before starting

- Read [`AGENTS.md`](AGENTS.md), the [scope](docs/product-scope.md), and the [clean-room policy](docs/clean-room-policy.md).
- Discuss substantial changes in an issue before implementation.
- Do not submit proprietary material, reverse-engineered information, private corpus assets, barcode values, or product images.
- Confirm that you have the right to contribute the code and data you submit.

## Development

Use Node.js 22.18 or newer (native TypeScript type stripping).

```bash
npm install
npm run check
```

## Pull requests

A PR must:

- link an approved issue;
- stay within its declared scope;
- include tests proportional to risk;
- describe privacy, performance, compatibility, and licence effects;
- update decisions or benchmark versions when behavior changes;
- avoid performance claims based on development fixtures alone.

Contributions use the Developer Certificate of Origin. Add a `Signed-off-by:` line to each commit using `git commit -s`.

## Benchmark contributions

Development fixtures and locked validation assets are separated. Contributors may improve against the development set but must not inspect or tune against the locked validation set. Results must retain configuration and version provenance.
