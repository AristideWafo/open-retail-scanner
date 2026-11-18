export type BarcodeFormat = "ean8" | "ean13" | "upca";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ScanResult {
  readonly rawValue: string;
  readonly canonicalValue: string;
  readonly format: BarcodeFormat;
  readonly bounds?: readonly Point[];
  readonly timestampMs: number;
  readonly engineVersion: string;
  readonly evidence: {
    readonly checksumValid: true;
    readonly confirmingFrames: number;
  };
}

export type GuidanceReason =
  | "too_dark"
  | "too_blurry"
  | "too_far"
  | "glare"
  | "code_not_found";

export type ScannerEvent =
  | { readonly type: "result"; readonly result: ScanResult }
  | { readonly type: "guidance"; readonly reason: GuidanceReason }
  | { readonly type: "state"; readonly state: "starting" | "running" | "stopped" }
  | { readonly type: "error"; readonly code: string; readonly recoverable: boolean };

export { canonicalValue, computeCheckDigit, isValidCode } from "./checksum.ts";
