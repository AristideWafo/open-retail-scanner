import type { BarcodeFormat } from "./index.ts";

const LENGTH: Record<BarcodeFormat, number> = { ean8: 8, ean13: 13, upca: 12 };

/** GS1 mod-10 check digit for a digit string WITHOUT its final check digit. */
export function computeCheckDigit(body: string): number {
  if (!/^\d+$/.test(body)) throw new RangeError("digits only");
  let sum = 0;
  // Weights 3,1,3,1... starting from the digit nearest the check digit.
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = 4 - w) {
    sum += Number(body[i]) * w;
  }
  return (10 - (sum % 10)) % 10;
}

/** True only for a full-length, digits-only value of the given format with a valid check digit. */
export function isValidCode(value: string, format: BarcodeFormat): boolean {
  if (value.length !== LENGTH[format] || !/^\d+$/.test(value)) return false;
  return computeCheckDigit(value.slice(0, -1)) === Number(value.at(-1));
}

/**
 * Documented canonical form: EAN-13 (UPC-A is the EAN-13 with one leading zero).
 * EAN-8 is never padded. The raw value and observed format must be kept by the caller.
 */
export function canonicalValue(value: string, format: BarcodeFormat): string {
  return format === "upca" ? `0${value}` : value;
}
