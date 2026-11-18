# Privacy and security baseline

## Data minimization

The runtime processes frames locally. By default it must not transmit or persist:

- frames or crops;
- barcode values;
- product identities;
- camera labels beyond ephemeral selection;
- user, health, profile, or location data.

## Allowed diagnostics

Opt-in diagnostics may include only coarse platform class, SDK/engine version, stage durations, quality/failure category, and feature availability. Values must be bounded to prevent reconstruction or fingerprinting. Diagnostics are disabled until a separate privacy review approves their schema, retention, access, and lawful basis.

## Threats to address

- malicious or oversized image inputs exhausting memory;
- malformed WASM or decoder inputs causing crashes;
- dependency or toolchain compromise;
- accidental logging through errors and debug tooling;
- permission misuse and camera streams surviving teardown;
- third-party code receiving frames;
- CDN/WASM integrity and MIME misconfiguration;
- API consumers misrepresenting a decoded code as product or safety verification.

## Required controls

- strict input dimensions and time/memory budgets;
- dependency lockfile, SBOM, licence inventory, and signed releases;
- native and WASM fuzzing for untrusted input boundaries;
- explicit teardown tests for tracks, workers, buffers, and listeners;
- no external analytics or crash SDK in the core packages;
- security reporting process and supported-version policy;
- content-security guidance and self-hostable WASM assets.

## Logging rule

Errors and telemetry must pass an allow-list schema. Redaction after collection is insufficient.
