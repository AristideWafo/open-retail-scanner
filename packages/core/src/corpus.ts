import type { BarcodeFormat } from "./index.ts";

export type CorpusPartition = "development" | "validation";
export type CorpusCondition = "normal" | "low_light" | "glare_curved" | "small_damaged";
export type RightsAttestation = "owned_physical_product";

export const FROZEN_PROTOCOL_VERSION = "v1.0.0-lite";
export const CI_REPLAY_DEVICE_ID = "ci_deterministic_replay";

export const MOBILE_MATRIX_DEVICE_IDS = [
  "ios_safari_low",
  "ios_safari_mid",
  "android_chrome_low",
  "android_chrome_mid",
] as const;

export const CORPUS_CONDITIONS: readonly CorpusCondition[] = [
  "normal",
  "low_light",
  "glare_curved",
  "small_damaged",
];

export const CORPUS_PARTITIONS: readonly CorpusPartition[] = [
  "development",
  "validation",
];

export const CORPUS_SYMBOLOGIES: readonly BarcodeFormat[] = [
  "ean8",
  "ean13",
  "upca",
];

export const V1_LITE_QUOTAS = {
  minDistinctProducts: 40,
  minDistinctProductsPerCondition: 10,
  minDistinctMobileDevices: 4,
} as const;

export interface CorpusManifestEntry {
  readonly sequenceId: string;
  readonly productHash: string;
  readonly clipSha256: string;
  readonly partition: CorpusPartition;
  readonly symbology: BarcodeFormat;
  readonly condition: CorpusCondition;
  readonly deviceId: string;
  readonly frameCount: number;
  readonly durationMs: number;
  readonly rightsAttestation: RightsAttestation;
  readonly groundTruthVerifiedByTwoOnDisagreement: boolean;
}

export interface CorpusManifest {
  readonly protocolVersion: string;
  readonly corpusVersion: string;
  readonly frozenAt: string;
  readonly entries: readonly CorpusManifestEntry[];
}

export type CorpusValidationResult =
  | { readonly valid: true; readonly manifest: CorpusManifest }
  | { readonly valid: false; readonly errors: readonly string[] };

export interface CorpusSubgroupCounts {
  readonly totalEntries: number;
  readonly distinctProducts: number;
  readonly distinctMobileDevices: number;
  readonly byPartition: Readonly<Record<CorpusPartition, number>>;
  readonly distinctProductsByPartition: Readonly<Record<CorpusPartition, number>>;
  readonly byCondition: Readonly<Record<CorpusCondition, number>>;
  readonly distinctProductsByCondition: Readonly<Record<CorpusCondition, number>>;
  readonly bySymbology: Readonly<Record<BarcodeFormat, number>>;
  readonly distinctProductsBySymbology: Readonly<Record<BarcodeFormat, number>>;
  readonly byDeviceId: Readonly<Record<string, number>>;
}

export interface CorpusQuotaReport {
  readonly meetsQuotas: boolean;
  readonly checks: {
    readonly minDistinctProducts: {
      readonly required: number;
      readonly actual: number;
      readonly passed: boolean;
    };
    readonly minPerCondition: {
      readonly required: number;
      readonly passed: boolean;
      readonly actualByCondition: Readonly<Record<CorpusCondition, number>>;
    };
    readonly minMobileDevices: {
      readonly required: number;
      readonly actual: number;
      readonly missingMandatoryMobileDevices: readonly string[];
      readonly passed: boolean;
    };
  };
  readonly deficits: readonly string[];
  readonly counts: CorpusSubgroupCounts;
}

const MANIFEST_KEYS = new Set([
  "protocolVersion",
  "corpusVersion",
  "frozenAt",
  "entries",
]);

const ENTRY_KEYS = new Set([
  "sequenceId",
  "productHash",
  "clipSha256",
  "partition",
  "symbology",
  "condition",
  "deviceId",
  "frameCount",
  "durationMs",
  "rightsAttestation",
  "groundTruthVerifiedByTwoOnDisagreement",
]);

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const PROTOCOL_VERSION_RE = /^v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/;
const ISO_DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/;
const BARCODE_DIGITS_RE = /(?<!\d)(?:\d{8}|\d{12}|\d{13}|\d{14})(?!\d)/;
const DATA_URL_RE =
  /^\s*data:|data:[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+/i;
const MEDIA_PATH_RE =
  /(?:[\/\\]|^(?:file|blob|https?):|\.(?:png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif|raw|dng|mp4|mov|webm|mkv|avi|m4v|y4m|yuv)(?:$|[?#\s]))/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject barcode digit runs (8/12/13/14), data URLs, and image/video file paths without echoing sensitive values. */
function detectForbiddenContent(value: string): string | null {
  if (DATA_URL_RE.test(value)) {
    return "contains a forbidden data URL";
  }
  if (MEDIA_PATH_RE.test(value)) {
    return "contains a forbidden file path or media reference";
  }
  if (BARCODE_DIGITS_RE.test(value)) {
    return "contains a forbidden 8/12/13/14-digit barcode sequence";
  }
  return null;
}

function isValidIsoDateOrDateTime(value: string): boolean {
  const match = ISO_DATE_TIME_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

function validateNonSensitiveString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
  maxLength = 128,
): string | null {
  const raw = obj[key];
  if (typeof raw !== "string") {
    errors.push(`${path}.${key} must be a string`);
    return null;
  }
  if (raw.trim().length === 0 || raw.length > maxLength) {
    errors.push(`${path}.${key} must be a non-empty string (max ${maxLength} chars)`);
    return null;
  }
  const forbidden = detectForbiddenContent(raw);
  if (forbidden !== null) {
    errors.push(`${path}.${key} ${forbidden}`);
    return null;
  }
  return raw;
}

function validateEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
  errors: string[],
): T | null {
  const raw = obj[key];
  if (typeof raw !== "string") {
    errors.push(`${path}.${key} must be one of: ${allowed.join(", ")}`);
    return null;
  }
  const forbidden = detectForbiddenContent(raw);
  if (forbidden !== null) {
    errors.push(`${path}.${key} ${forbidden}`);
    return null;
  }
  if (!(allowed as readonly string[]).includes(raw)) {
    errors.push(`${path}.${key} must be one of: ${allowed.join(", ")}`);
    return null;
  }
  return raw as T;
}

function validateSha256Hex(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): string | null {
  const raw = obj[key];
  if (typeof raw !== "string" || !SHA256_HEX_RE.test(raw)) {
    errors.push(`${path}.${key} must be a 64-character lowercase SHA-256 hex string`);
    return null;
  }
  return raw;
}

function validateEntry(
  rawEntry: unknown,
  index: number,
  errors: string[],
): CorpusManifestEntry | null {
  const path = `entries[${index}]`;
  if (!isPlainObject(rawEntry)) {
    errors.push(`${path} must be an object`);
    return null;
  }

  for (const key of Object.keys(rawEntry)) {
    if (!ENTRY_KEYS.has(key)) {
      errors.push(`${path} contains unexpected property "${key}"`);
    }
  }

  const sequenceId = validateNonSensitiveString(rawEntry, "sequenceId", path, errors);
  const productHash = validateSha256Hex(rawEntry, "productHash", path, errors);
  const clipSha256 = validateSha256Hex(rawEntry, "clipSha256", path, errors);
  const partition = validateEnum(rawEntry, "partition", CORPUS_PARTITIONS, path, errors);
  const symbology = validateEnum(rawEntry, "symbology", CORPUS_SYMBOLOGIES, path, errors);
  const condition = validateEnum(rawEntry, "condition", CORPUS_CONDITIONS, path, errors);
  const deviceId = validateNonSensitiveString(rawEntry, "deviceId", path, errors);

  const frameCount = rawEntry["frameCount"];
  const validFrameCount =
    typeof frameCount === "number" && Number.isSafeInteger(frameCount) && frameCount >= 1;
  if (!validFrameCount) {
    errors.push(`${path}.frameCount must be an integer >= 1`);
  }

  const durationMs = rawEntry["durationMs"];
  const validDurationMs =
    typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0;
  if (!validDurationMs) {
    errors.push(`${path}.durationMs must be a finite number > 0`);
  }

  const rightsAttestation = rawEntry["rightsAttestation"];
  const validRights = rightsAttestation === "owned_physical_product";
  if (!validRights) {
    if (typeof rightsAttestation === "string") {
      const forbidden = detectForbiddenContent(rightsAttestation);
      if (forbidden !== null) {
        errors.push(`${path}.rightsAttestation ${forbidden}`);
      }
    }
    errors.push(`${path}.rightsAttestation must be "owned_physical_product"`);
  }

  const verified = rawEntry["groundTruthVerifiedByTwoOnDisagreement"];
  const validVerified = typeof verified === "boolean";
  if (!validVerified) {
    errors.push(`${path}.groundTruthVerifiedByTwoOnDisagreement must be a boolean`);
  }

  if (
    sequenceId === null ||
    productHash === null ||
    clipSha256 === null ||
    partition === null ||
    symbology === null ||
    condition === null ||
    deviceId === null ||
    !validFrameCount ||
    !validDurationMs ||
    !validRights ||
    !validVerified
  ) {
    return null;
  }

  return {
    sequenceId,
    productHash,
    clipSha256,
    partition,
    symbology,
    condition,
    deviceId,
    frameCount,
    durationMs,
    rightsAttestation: "owned_physical_product",
    groundTruthVerifiedByTwoOnDisagreement: verified,
  };
}

/**
 * Validate a rights-clean corpus manifest.
 * Strictly rejects barcode digit strings, data URLs, raw image/video paths,
 * unexpected properties, missing rights attestations, invalid SHA-256 digests,
 * duplicate sequence IDs, and physical products appearing in both splits.
 */
export function validateCorpusManifest(input: unknown): CorpusValidationResult {
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["manifest must be a JSON object"] };
  }

  const errors: string[] = [];

  for (const key of Object.keys(input)) {
    if (!MANIFEST_KEYS.has(key)) {
      errors.push(`manifest contains unexpected property "${key}"`);
    }
  }

  const protocolVersion = validateNonSensitiveString(
    input,
    "protocolVersion",
    "manifest",
    errors,
  );
  if (protocolVersion !== null && !PROTOCOL_VERSION_RE.test(protocolVersion)) {
    errors.push(
      'manifest.protocolVersion must follow semantic version format (e.g. "v1.0.0-lite")',
    );
  }

  const corpusVersion = validateNonSensitiveString(
    input,
    "corpusVersion",
    "manifest",
    errors,
  );

  const frozenAt = validateNonSensitiveString(input, "frozenAt", "manifest", errors);
  if (frozenAt !== null && !isValidIsoDateOrDateTime(frozenAt)) {
    errors.push("manifest.frozenAt must be a valid ISO 8601 date or timestamp");
  }

  const rawEntries = input["entries"];
  if (!Array.isArray(rawEntries)) {
    errors.push("manifest.entries must be an array");
    return { valid: false, errors };
  }

  const entries: CorpusManifestEntry[] = [];
  const seenSequenceIds = new Set<string>();
  const productPartitions = new Map<string, CorpusPartition>();

  for (let i = 0; i < rawEntries.length; i++) {
    const entry = validateEntry(rawEntries[i], i, errors);
    if (entry === null) continue;

    if (seenSequenceIds.has(entry.sequenceId)) {
      errors.push(`entries[${i}].sequenceId "${entry.sequenceId}" is duplicated`);
      continue;
    }
    seenSequenceIds.add(entry.sequenceId);

    const existingPartition = productPartitions.get(entry.productHash);
    if (existingPartition !== undefined && existingPartition !== entry.partition) {
      errors.push(
        `entries[${i}].productHash appears in both "development" and "validation" partitions`,
      );
      continue;
    }
    productPartitions.set(entry.productHash, entry.partition);
    entries.push(entry);
  }

  if (
    errors.length > 0 ||
    protocolVersion === null ||
    corpusVersion === null ||
    frozenAt === null
  ) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    manifest: {
      protocolVersion,
      corpusVersion,
      frozenAt,
      entries,
    },
  };
}

/**
 * Evaluate whether a validated corpus manifest meets all frozen v1.0.0-lite quotas
 * and compute subgroup breakdowns without leaking product or barcode identities.
 */
export function checkCorpusQuotas(manifest: CorpusManifest): CorpusQuotaReport {
  const distinctProducts = new Set<string>();
  const distinctMobileDevices = new Set<string>();

  const byPartition: Record<CorpusPartition, number> = {
    development: 0,
    validation: 0,
  };
  const productsByPartition: Record<CorpusPartition, Set<string>> = {
    development: new Set<string>(),
    validation: new Set<string>(),
  };

  const byCondition: Record<CorpusCondition, number> = {
    normal: 0,
    low_light: 0,
    glare_curved: 0,
    small_damaged: 0,
  };
  const productsByCondition: Record<CorpusCondition, Set<string>> = {
    normal: new Set<string>(),
    low_light: new Set<string>(),
    glare_curved: new Set<string>(),
    small_damaged: new Set<string>(),
  };

  const bySymbology: Record<BarcodeFormat, number> = {
    ean8: 0,
    ean13: 0,
    upca: 0,
  };
  const productsBySymbology: Record<BarcodeFormat, Set<string>> = {
    ean8: new Set<string>(),
    ean13: new Set<string>(),
    upca: new Set<string>(),
  };

  const byDeviceId: Record<string, number> = {};

  for (const entry of manifest.entries) {
    distinctProducts.add(entry.productHash);
    if (entry.deviceId !== CI_REPLAY_DEVICE_ID) {
      distinctMobileDevices.add(entry.deviceId);
    }

    byPartition[entry.partition] += 1;
    productsByPartition[entry.partition].add(entry.productHash);

    byCondition[entry.condition] += 1;
    productsByCondition[entry.condition].add(entry.productHash);

    bySymbology[entry.symbology] += 1;
    productsBySymbology[entry.symbology].add(entry.productHash);

    byDeviceId[entry.deviceId] = (byDeviceId[entry.deviceId] ?? 0) + 1;
  }

  const distinctProductsByPartition: Record<CorpusPartition, number> = {
    development: productsByPartition.development.size,
    validation: productsByPartition.validation.size,
  };
  const distinctProductsByCondition: Record<CorpusCondition, number> = {
    normal: productsByCondition.normal.size,
    low_light: productsByCondition.low_light.size,
    glare_curved: productsByCondition.glare_curved.size,
    small_damaged: productsByCondition.small_damaged.size,
  };
  const distinctProductsBySymbology: Record<BarcodeFormat, number> = {
    ean8: productsBySymbology.ean8.size,
    ean13: productsBySymbology.ean13.size,
    upca: productsBySymbology.upca.size,
  };

  const deficits: string[] = [];

  const minDistinctProductsPassed =
    distinctProducts.size >= V1_LITE_QUOTAS.minDistinctProducts;
  if (!minDistinctProductsPassed) {
    deficits.push(
      `distinctProducts is ${distinctProducts.size}, required >= ${V1_LITE_QUOTAS.minDistinctProducts}`,
    );
  }

  let minPerConditionPassed = true;
  for (const condition of CORPUS_CONDITIONS) {
    const actual = distinctProductsByCondition[condition];
    if (actual < V1_LITE_QUOTAS.minDistinctProductsPerCondition) {
      minPerConditionPassed = false;
      deficits.push(
        `condition "${condition}" has ${actual} distinct products, required >= ${V1_LITE_QUOTAS.minDistinctProductsPerCondition}`,
      );
    }
  }

  const missingMandatoryMobileDevices = MOBILE_MATRIX_DEVICE_IDS.filter(
    (id) => !distinctMobileDevices.has(id),
  );
  const minMobileDevicesPassed =
    distinctMobileDevices.size >= V1_LITE_QUOTAS.minDistinctMobileDevices &&
    missingMandatoryMobileDevices.length === 0;
  if (distinctMobileDevices.size < V1_LITE_QUOTAS.minDistinctMobileDevices) {
    deficits.push(
      `distinctMobileDevices is ${distinctMobileDevices.size}, required >= ${V1_LITE_QUOTAS.minDistinctMobileDevices}`,
    );
  }
  if (missingMandatoryMobileDevices.length > 0) {
    deficits.push(
      `missing mandatory mobile matrix devices: ${missingMandatoryMobileDevices.join(", ")}`,
    );
  }

  return {
    meetsQuotas:
      minDistinctProductsPassed && minPerConditionPassed && minMobileDevicesPassed,
    checks: {
      minDistinctProducts: {
        required: V1_LITE_QUOTAS.minDistinctProducts,
        actual: distinctProducts.size,
        passed: minDistinctProductsPassed,
      },
      minPerCondition: {
        required: V1_LITE_QUOTAS.minDistinctProductsPerCondition,
        passed: minPerConditionPassed,
        actualByCondition: distinctProductsByCondition,
      },
      minMobileDevices: {
        required: V1_LITE_QUOTAS.minDistinctMobileDevices,
        actual: distinctMobileDevices.size,
        missingMandatoryMobileDevices,
        passed: minMobileDevicesPassed,
      },
    },
    deficits,
    counts: {
      totalEntries: manifest.entries.length,
      distinctProducts: distinctProducts.size,
      distinctMobileDevices: distinctMobileDevices.size,
      byPartition,
      distinctProductsByPartition,
      byCondition,
      distinctProductsByCondition,
      bySymbology,
      distinctProductsBySymbology,
      byDeviceId,
    },
  };
}
