export const MAX_FRAME_WIDTH = 4096;
export const MAX_FRAME_HEIGHT = 4096;
export const MAX_FRAME_BYTES = 67_108_864; // 64 MiB

export type PlatformClass =
  | "ios_safari"
  | "android_chrome"
  | "desktop_web"
  | "ci_node";

export type DiagnosticStage =
  | "init"
  | "camera"
  | "decode"
  | "consensus"
  | "teardown";

export type DurationMsBand = "0_10" | "10_50" | "50_200" | "200_plus";

export type FailureCategory =
  | "permission"
  | "camera_lifecycle"
  | "timeout"
  | "engine"
  | "oversized_input";

export interface DiagnosticEvent {
  readonly sdkVersion: string;
  readonly engineVersion: string;
  readonly platformClass: PlatformClass;
  readonly stage: DiagnosticStage;
  readonly durationMsBand: DurationMsBand;
  readonly failureCategory?: FailureCategory;
  readonly featureBarcodeDetector: boolean;
}

const FORBIDDEN_KEY_EXACT = new Set([
  "frame",
  "image",
  "crop",
  "pixels",
  "bitmap",
  "dataurl",
  "base64",
  "rawvalue",
  "canonicalvalue",
  "barcode",
  "gtin",
  "ean",
  "upc",
  "productname",
  "ingredients",
  "allergens",
  "profile",
  "deviceidlabel",
  "product",
  "user",
  "health",
  "allergy",
  "symptom",
  "medical",
  "identity",
  "cameralabel",
  "devicelabel",
]);

const FORBIDDEN_KEY_TOKENS = new Set([
  "frame",
  "image",
  "crop",
  "pixels",
  "bitmap",
  "dataurl",
  "base64",
  "rawvalue",
  "canonicalvalue",
  "barcode",
  "gtin",
  "ean",
  "upc",
  "productname",
  "ingredients",
  "allergens",
  "profile",
  "deviceidlabel",
  "product",
  "user",
  "health",
  "allergy",
  "symptom",
  "medical",
  "identity",
  "cameralabel",
  "devicelabel",
]);

const BARCODE_DIGITS_RE = /(?<!\d)(?:\d{8}|\d{12}|\d{13}|\d{14})(?!\d)/;
const DATA_URL_RE = /^\s*data:|data:[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+/i;
const EMBEDDED_BARCODE_RE =
  /(?:\b(?:barcode|gtin|ean|upc)\b\s*[:=]\s*["']?\d{8,14}|\b(?:barcode|gtin)\b[^\n\r\d]{0,16}\d{8,14}|\b(?:barcode|gtin)\s*[:=]\s*["']?[^\s"']{4,})/i;

const ALLOWED_DIAGNOSTIC_KEYS = new Set([
  "sdkVersion",
  "engineVersion",
  "platformClass",
  "stage",
  "durationMsBand",
  "failureCategory",
  "featureBarcodeDetector",
]);

const PLATFORM_CLASSES = new Set<PlatformClass>([
  "ios_safari",
  "android_chrome",
  "desktop_web",
  "ci_node",
]);

const DIAGNOSTIC_STAGES = new Set<DiagnosticStage>([
  "init",
  "camera",
  "decode",
  "consensus",
  "teardown",
]);

const DURATION_MS_BANDS = new Set<DurationMsBand>([
  "0_10",
  "10_50",
  "50_200",
  "200_plus",
]);

const FAILURE_CATEGORIES = new Set<FailureCategory>([
  "permission",
  "camera_lifecycle",
  "timeout",
  "engine",
  "oversized_input",
]);

/**
 * Validates frame dimensions and optional byte length against hard memory
 * and dimension bounds before pixel buffers are passed to a decoder.
 */
export function validateFrameBounds(
  width: number,
  height: number,
  byteLength?: number,
): void {
  if (!Number.isInteger(width) || width <= 0 || width > MAX_FRAME_WIDTH) {
    throw new RangeError(
      `Frame width must be an integer in [1, ${MAX_FRAME_WIDTH}]`,
    );
  }
  if (!Number.isInteger(height) || height <= 0 || height > MAX_FRAME_HEIGHT) {
    throw new RangeError(
      `Frame height must be an integer in [1, ${MAX_FRAME_HEIGHT}]`,
    );
  }
  if (byteLength !== undefined) {
    if (
      !Number.isInteger(byteLength) ||
      byteLength <= 0 ||
      byteLength > MAX_FRAME_BYTES
    ) {
      throw new RangeError(
        `Frame byteLength must be an integer in [1, ${MAX_FRAME_BYTES}]`,
      );
    }
  }
}

function isForbiddenKey(key: string): boolean {
  if (key === "featureBarcodeDetector") {
    return false;
  }
  const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (FORBIDDEN_KEY_EXACT.has(normalized)) {
    return true;
  }
  const tokens = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());

  for (const token of tokens) {
    if (FORBIDDEN_KEY_TOKENS.has(token)) {
      return true;
    }
    const alphaPrefix = token.replace(/\d+$/, "");
    if (alphaPrefix !== token && FORBIDDEN_KEY_TOKENS.has(alphaPrefix)) {
      return true;
    }
  }
  return false;
}

function assertSafeString(value: string, path: string): void {
  if (DATA_URL_RE.test(value)) {
    throw new Error(`Privacy violation: data URL detected at ${path}`);
  }
  if (BARCODE_DIGITS_RE.test(value)) {
    throw new Error(`Privacy violation: barcode digit run detected at ${path}`);
  }
  if (EMBEDDED_BARCODE_RE.test(value)) {
    throw new Error(
      `Privacy violation: embedded barcode/gtin value detected at ${path}`,
    );
  }
}

function isDisallowedBinary(value: object): boolean {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return true;
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return true;
  }
  if (typeof ImageData !== "undefined" && value instanceof ImageData) {
    return true;
  }
  if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
    return true;
  }
  return false;
}

function scanValue(value: unknown, path: string, seen: WeakSet<object>): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    assertSafeString(value, path);
    return;
  }
  if (typeof value !== "object") {
    return;
  }

  if (isDisallowedBinary(value)) {
    throw new Error(`Privacy violation: binary frame/image payload at ${path}`);
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanValue(value[i], `${path}[${i}]`, seen);
    }
    return;
  }

  if (value instanceof Set) {
    let idx = 0;
    for (const entry of value) {
      scanValue(entry, `${path}[set:${idx}]`, seen);
      idx++;
    }
    return;
  }

  if (value instanceof Map) {
    let idx = 0;
    for (const [k, v] of value) {
      if (typeof k === "string" && isForbiddenKey(k)) {
        throw new Error(
          `Privacy violation: forbidden key "${k}" at ${path}`,
        );
      }
      scanValue(k, `${path}[mapKey:${idx}]`, seen);
      scanValue(v, `${path}[mapVal:${idx}]`, seen);
      idx++;
    }
    return;
  }

  if (value instanceof Error) {
    scanValue(value.name, `${path}.name`, seen);
    scanValue(value.message, `${path}.message`, seen);
    scanValue(value.stack, `${path}.stack`, seen);
    scanValue((value as { cause?: unknown }).cause, `${path}.cause`, seen);
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (isForbiddenKey(key)) {
      throw new Error(`Privacy violation: forbidden key "${key}" at ${path}`);
    }
    scanValue(record[key], `${path}.${key}`, seen);
  }
}

/**
 * Deep-scans an arbitrary payload and throws if it contains binary image/frame
 * buffers, forbidden keys, data URLs, or barcode/product strings.
 */
export function assertPrivacySafePayload(payload: unknown): void {
  scanValue(payload, "$", new WeakSet<object>());
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates and normalizes an input object against the strict DiagnosticEvent
 * allow-list schema after running privacy checks.
 */
export function validateDiagnosticEvent(input: unknown): DiagnosticEvent {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Privacy violation: diagnostic event must be a plain object");
  }

  assertPrivacySafePayload(input);

  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_DIAGNOSTIC_KEYS.has(key)) {
      throw new Error(
        `Privacy violation: unexpected diagnostic field "${key}"`,
      );
    }
  }

  const sdkVersion = record["sdkVersion"];
  const engineVersion = record["engineVersion"];
  const platformClass = record["platformClass"];
  const stage = record["stage"];
  const durationMsBand = record["durationMsBand"];
  const failureCategory = record["failureCategory"];
  const featureBarcodeDetector = record["featureBarcodeDetector"];

  if (!isNonEmptyString(sdkVersion)) {
    throw new Error("DiagnosticEvent requires a non-empty sdkVersion");
  }
  if (!isNonEmptyString(engineVersion)) {
    throw new Error("DiagnosticEvent requires a non-empty engineVersion");
  }
  if (
    typeof platformClass !== "string" ||
    !PLATFORM_CLASSES.has(platformClass as PlatformClass)
  ) {
    throw new Error("DiagnosticEvent has invalid platformClass");
  }
  if (
    typeof stage !== "string" ||
    !DIAGNOSTIC_STAGES.has(stage as DiagnosticStage)
  ) {
    throw new Error("DiagnosticEvent has invalid stage");
  }
  if (
    typeof durationMsBand !== "string" ||
    !DURATION_MS_BANDS.has(durationMsBand as DurationMsBand)
  ) {
    throw new Error("DiagnosticEvent has invalid durationMsBand");
  }
  if (typeof featureBarcodeDetector !== "boolean") {
    throw new Error("DiagnosticEvent requires boolean featureBarcodeDetector");
  }

  if (failureCategory !== undefined) {
    if (
      typeof failureCategory !== "string" ||
      !FAILURE_CATEGORIES.has(failureCategory as FailureCategory)
    ) {
      throw new Error("DiagnosticEvent has invalid failureCategory");
    }
    return {
      sdkVersion,
      engineVersion,
      platformClass: platformClass as PlatformClass,
      stage: stage as DiagnosticStage,
      durationMsBand: durationMsBand as DurationMsBand,
      failureCategory: failureCategory as FailureCategory,
      featureBarcodeDetector,
    };
  }

  return {
    sdkVersion,
    engineVersion,
    platformClass: platformClass as PlatformClass,
    stage: stage as DiagnosticStage,
    durationMsBand: durationMsBand as DurationMsBand,
    featureBarcodeDetector,
  };
}
