# Benchmark result schema

Each run should be represented as append-only structured data. Do not store frames, crops, barcode values, product identities, or user identifiers in run results.

Required conceptual fields:

- `protocolVersion`
- `corpusVersion`
- `partition` (`development` or `validation`)
- `engineName`, `engineVersion`, `buildId`, `configurationId`
- `deviceClass`, `osFamily`, `osVersion`, `browserFamily`, `browserVersion`
- `symbology`
- `condition`
- `sequenceId` as a random benchmark identifier unrelated to product identity
- `startedAtMonotonicMs`
- `outcome` (`correct`, `wrong_valid`, `no_result`, `camera_error`, `engine_error`)
- `timeToResultMs` when applicable
- `initializationMs`
- `longTaskCount`, `peakMemoryClass`, and optional coarse resource bands

Ground truth and raw assets remain in a separately governed corpus store. Join keys must not be published if they allow reconstruction of product or barcode data.
