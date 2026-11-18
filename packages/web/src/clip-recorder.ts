/**
 * Privacy-safe, rights-clean physical device clip recording and ground-truth
 * verification for benchmark corpus curation (Issue #5).
 *
 * Corpus clips and ground-truth annotations remain outside git in a separately
 * governed store. Only SHA-256 digests (`productHash`, `clipSha256`) and
 * non-identifying metadata enter the manifest.
 */

import {
  MOBILE_MATRIX_DEVICE_IDS,
  canonicalValue,
  isValidCode,
  validateFrameBounds,
  type BarcodeFormat,
  type CorpusCondition,
  type CorpusManifestEntry,
  type CorpusPartition,
  type ReplayClip,
  type ReplayFrame,
  type RightsAttestation,
} from "open-retail-scanner-core";

export type TargetDeviceId = (typeof MOBILE_MATRIX_DEVICE_IDS)[number];

export interface DeviceRuntimeProfile {
  readonly deviceClass: string;
  readonly osFamily: string;
  readonly osVersion: string;
  readonly browserFamily: string;
  readonly browserVersion: string;
}

export const TARGET_DEVICE_PROFILES: Readonly<
  Record<TargetDeviceId, DeviceRuntimeProfile>
> = {
  ios_safari_low: {
    deviceClass: "low-tier-ios",
    osFamily: "iOS",
    osVersion: "17",
    browserFamily: "Mobile Safari",
    browserVersion: "17",
  },
  ios_safari_mid: {
    deviceClass: "mid-tier-ios",
    osFamily: "iOS",
    osVersion: "18",
    browserFamily: "Mobile Safari",
    browserVersion: "18",
  },
  android_chrome_low: {
    deviceClass: "low-tier-android",
    osFamily: "Android",
    osVersion: "13",
    browserFamily: "Chrome Mobile",
    browserVersion: "130",
  },
  android_chrome_mid: {
    deviceClass: "mid-tier-android",
    osFamily: "Android",
    osVersion: "14",
    browserFamily: "Chrome Mobile",
    browserVersion: "130",
  },
};

export interface GroundTruthObservation {
  readonly primaryReaderDigits: string;
  readonly primarySymbology: BarcodeFormat;
  readonly secondaryArbitratorDigits?: string | undefined;
  readonly disagreementObserved: boolean;
  readonly rightsAttestation: RightsAttestation;
  readonly containsPersonalData: boolean;
}

export interface VerifiedGroundTruth {
  readonly canonicalCode: string;
  readonly format: BarcodeFormat;
  readonly verifiedByTwoOnDisagreement: boolean;
}

export interface BuildRecordedClipParams {
  readonly sequenceId: string;
  readonly partition: CorpusPartition;
  readonly condition: CorpusCondition;
  readonly deviceId: string;
  readonly frames: readonly ReplayFrame[];
  readonly groundTruth: GroundTruthObservation;
  readonly corpusSalt: string;
}

export interface RecordedClipResult {
  readonly manifestEntry: CorpusManifestEntry;
  readonly replayClip: ReplayClip;
}

const TEXT_ENCODER = new TextEncoder();
const CLIP_DIGEST_MAGIC = TEXT_ENCODER.encode("ORC-CLIP-V1");
const MAX_IDENTIFIER_LENGTH = 128;

/**
 * Verifies rights-cleanliness, absence of personal data, two-person
 * arbitration on disagreement, and GS1 mod-10 checksum validity.
 * Never echoes raw barcode digits in error messages.
 */
export function verifyGroundTruth(
  obs: GroundTruthObservation,
): VerifiedGroundTruth {
  if (obs.containsPersonalData !== false) {
    throw new Error(
      "Clip rejected: personal data (faces, identifying hands, receipts) must not be retained",
    );
  }
  if (obs.rightsAttestation !== "owned_physical_product") {
    throw new Error(
      'Clip rejected: rightsAttestation must be "owned_physical_product"',
    );
  }

  let resolvedDigits: string;
  if (obs.disagreementObserved === true) {
    if (
      typeof obs.secondaryArbitratorDigits !== "string" ||
      obs.secondaryArbitratorDigits.length === 0
    ) {
      throw new Error(
        "Clip rejected: secondaryArbitratorDigits is required when disagreementObserved is true",
      );
    }
    resolvedDigits = obs.secondaryArbitratorDigits;
  } else {
    resolvedDigits = obs.primaryReaderDigits;
  }

  if (!isValidCode(resolvedDigits, obs.primarySymbology)) {
    throw new Error(
      `Clip rejected: ground-truth digits failed GS1 mod-10 checksum validation for ${obs.primarySymbology}`,
    );
  }

  return {
    canonicalCode: canonicalValue(resolvedDigits, obs.primarySymbology),
    format: obs.primarySymbology,
    verifiedByTwoOnDisagreement: true,
  };
}

/**
 * Computes a 64-character lowercase SHA-256 hex digest using Web Crypto
 * (`globalThis.crypto.subtle.digest`), compatible with both browsers and Node.js.
 */
export async function sha256HexFromBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("Web Crypto subtle.digest is required for SHA-256 hashing");
  }
  // Copy into a fresh ArrayBuffer-backed view to satisfy BufferSource cleanly.
  const digestBuffer = await subtle.digest("SHA-256", new Uint8Array(bytes));
  const digestBytes = new Uint8Array(digestBuffer);
  let hex = "";
  for (let i = 0; i < digestBytes.length; i++) {
    hex += digestBytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Computes a salted SHA-256 `productHash` so corpus manifests group clips by
 * physical product without ever storing or revealing barcode digits.
 */
export async function hashProductIdentity(
  canonicalCode: string,
  corpusSalt: string,
): Promise<string> {
  if (canonicalCode.trim().length === 0) {
    throw new RangeError("canonicalCode must be a non-empty string");
  }
  if (corpusSalt.trim().length === 0) {
    throw new RangeError("corpusSalt must be a non-empty string");
  }
  const encoded = TEXT_ENCODER.encode(
    `orc-product:${corpusSalt}:${canonicalCode}`,
  );
  return sha256HexFromBytes(encoded);
}

function validateIdentifier(value: string, fieldName: string): void {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH
  ) {
    throw new RangeError(
      `${fieldName} must be a non-empty string (max ${MAX_IDENTIFIER_LENGTH} chars)`,
    );
  }
}

function validateAndSerializeFrames(frames: readonly ReplayFrame[]): {
  readonly serialized: Uint8Array;
  readonly durationMs: number;
} {
  if (frames.length === 0) {
    throw new RangeError(
      "At least one frame is required to build a clip manifest entry",
    );
  }

  let totalBytes = CLIP_DIGEST_MAGIC.byteLength + 4;
  let prevTimestampMs = -1;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    validateFrameBounds(frame.width, frame.height, frame.data.byteLength);
    if (!Number.isFinite(frame.timestampMs) || frame.timestampMs < 0) {
      throw new RangeError(
        `frames[${i}].timestampMs must be a finite number >= 0`,
      );
    }
    if (i > 0 && frame.timestampMs < prevTimestampMs) {
      throw new RangeError(
        `frames[${i}].timestampMs must be monotonically non-decreasing`,
      );
    }
    prevTimestampMs = frame.timestampMs;
    // 8 bytes timestampMs + 4 width + 4 height + 4 byteLength + pixel bytes.
    totalBytes += 20 + frame.data.byteLength;
  }

  const buffer = new Uint8Array(totalBytes);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  buffer.set(CLIP_DIGEST_MAGIC, offset);
  offset += CLIP_DIGEST_MAGIC.byteLength;
  view.setUint32(offset, frames.length, true);
  offset += 4;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    view.setFloat64(offset, frame.timestampMs, true);
    offset += 8;
    view.setUint32(offset, frame.width, true);
    offset += 4;
    view.setUint32(offset, frame.height, true);
    offset += 4;
    view.setUint32(offset, frame.data.byteLength, true);
    offset += 4;

    const pixelView = new Uint8Array(
      frame.data.buffer,
      frame.data.byteOffset,
      frame.data.byteLength,
    );
    buffer.set(pixelView, offset);
    offset += pixelView.byteLength;
  }

  const firstTimestampMs = frames[0]!.timestampMs;
  const lastTimestampMs = frames[frames.length - 1]!.timestampMs;
  const spanMs = lastTimestampMs - firstTimestampMs;
  const durationMs = spanMs > 0 ? spanMs : frames.length;

  return { serialized: buffer, durationMs };
}

function resolveDeviceProfile(deviceId: string): DeviceRuntimeProfile {
  if (Object.hasOwn(TARGET_DEVICE_PROFILES, deviceId)) {
    return TARGET_DEVICE_PROFILES[deviceId as TargetDeviceId];
  }
  return {
    deviceClass: deviceId,
    osFamily: "unknown",
    osVersion: "unknown",
    browserFamily: "unknown",
    browserVersion: "unknown",
  };
}

/**
 * Verifies ground truth, validates frame bounds, hashes the clip and product
 * identity, and produces both a privacy-safe `CorpusManifestEntry` (zero
 * barcode digits or pixel frames) and an in-memory `ReplayClip` for external
 * corpus storage and deterministic replay.
 */
export async function buildRecordedClipManifestEntry(
  params: BuildRecordedClipParams,
): Promise<RecordedClipResult> {
  validateIdentifier(params.sequenceId, "sequenceId");
  validateIdentifier(params.deviceId, "deviceId");

  const verified = verifyGroundTruth(params.groundTruth);
  const { serialized, durationMs } = validateAndSerializeFrames(params.frames);

  const [clipSha256, productHash] = await Promise.all([
    sha256HexFromBytes(serialized),
    hashProductIdentity(verified.canonicalCode, params.corpusSalt),
  ]);

  const manifestEntry: CorpusManifestEntry = {
    sequenceId: params.sequenceId,
    productHash,
    clipSha256,
    partition: params.partition,
    symbology: verified.format,
    condition: params.condition,
    deviceId: params.deviceId,
    frameCount: params.frames.length,
    durationMs,
    rightsAttestation: params.groundTruth.rightsAttestation,
    groundTruthVerifiedByTwoOnDisagreement:
      verified.verifiedByTwoOnDisagreement,
  };

  const deviceProfile = resolveDeviceProfile(params.deviceId);
  const replayClip: ReplayClip = {
    sequenceId: params.sequenceId,
    partition: params.partition,
    symbology: verified.format,
    condition: params.condition,
    groundTruthCanonical: verified.canonicalCode,
    groundTruthFormat: verified.format,
    deviceClass: deviceProfile.deviceClass,
    osFamily: deviceProfile.osFamily,
    osVersion: deviceProfile.osVersion,
    browserFamily: deviceProfile.browserFamily,
    browserVersion: deviceProfile.browserVersion,
    frames: params.frames.map((frame) => ({
      timestampMs: frame.timestampMs,
      width: frame.width,
      height: frame.height,
      data: frame.data,
    })),
  };

  return { manifestEntry, replayClip };
}
