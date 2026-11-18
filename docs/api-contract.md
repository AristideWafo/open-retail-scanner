# Proposed API contract

The contract is provisional until Phase 0 establishes measurable requirements.

```ts
type BarcodeFormat = "ean8" | "ean13" | "upca";

type ScanResult = {
  rawValue: string;
  canonicalValue: string;
  format: BarcodeFormat;
  bounds?: readonly { x: number; y: number }[];
  timestampMs: number;
  engineVersion: string;
  evidence: {
    checksumValid: true;
    confirmingFrames: number;
  };
};

interface BarcodeScanner {
  start(options: ScannerOptions): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (event: ScannerEvent) => void): () => void;
}
```

## Error taxonomy

- `permission_denied`
- `camera_unavailable`
- `camera_interrupted`
- `unsupported_platform`
- `engine_load_failed`
- `decode_timeout`
- `resource_limit`
- `internal_error`

Errors must include `recoverable` and a stable code, but no frame, barcode value, product identifier, or user data.

## Normalization

UPC-A may be representable as EAN-13 with a leading zero. Implementations must retain `rawValue` and `format`, then expose an explicitly documented `canonicalValue`. Silent rewriting is prohibited.
