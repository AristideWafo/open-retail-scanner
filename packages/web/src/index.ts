export interface ScannerOptions {
  readonly formats?: readonly ("ean8" | "ean13" | "upca")[];
  readonly requiredConfirmingFrames?: number;
}

/** Runtime implementation is intentionally deferred until Phase 0 is complete. */
export class WebBarcodeScanner {
  constructor(_options: ScannerOptions = {}) {
    throw new Error("Not implemented: complete Phase 0 benchmark first");
  }
}
