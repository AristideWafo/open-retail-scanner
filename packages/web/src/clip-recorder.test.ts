import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FROZEN_PROTOCOL_VERSION,
  MOBILE_MATRIX_DEVICE_IDS,
  assertPrivacySafePayload,
  validateCorpusManifest,
  type CorpusManifest,
  type ReplayFrame,
  type RightsAttestation,
} from "open-retail-scanner-core";
import {
  buildRecordedClipManifestEntry,
  hashProductIdentity,
  sha256HexFromBytes,
  verifyGroundTruth,
  type GroundTruthObservation,
} from "./clip-recorder.ts";

function makeFrames(
  count = 3,
  options: { readonly width?: number; readonly height?: number; readonly seed?: number } = {},
): ReplayFrame[] {
  const width = options.width ?? 64;
  const height = options.height ?? 48;
  const seed = options.seed ?? 1;
  const frames: ReplayFrame[] = [];
  for (let i = 0; i < count; i++) {
    const data = new Uint8Array(width * height);
    data.fill((seed + i * 7) & 0xff);
    frames.push({
      timestampMs: 100 + i * 33,
      width,
      height,
      data,
    });
  }
  return frames;
}

function makeManifest(entries: CorpusManifest["entries"]): CorpusManifest {
  return {
    protocolVersion: FROZEN_PROTOCOL_VERSION,
    corpusVersion: "corpus-2026-11-18-test",
    frozenAt: "2026-11-18T14:30:00Z",
    entries,
  };
}

test("verifyGroundTruth accepts valid single-reader observations and canonicalizes UPC-A", () => {
  const ean13 = verifyGroundTruth({
    primaryReaderDigits: "4006381333931",
    primarySymbology: "ean13",
    disagreementObserved: false,
    rightsAttestation: "owned_physical_product",
    containsPersonalData: false,
  });
  assert.deepEqual(ean13, {
    canonicalCode: "4006381333931",
    format: "ean13",
    verifiedByTwoOnDisagreement: true,
  });

  const upca = verifyGroundTruth({
    primaryReaderDigits: "036000291452",
    primarySymbology: "upca",
    disagreementObserved: false,
    rightsAttestation: "owned_physical_product",
    containsPersonalData: false,
  });
  assert.deepEqual(upca, {
    canonicalCode: "0036000291452",
    format: "upca",
    verifiedByTwoOnDisagreement: true,
  });

  const ean8 = verifyGroundTruth({
    primaryReaderDigits: "96385074",
    primarySymbology: "ean8",
    disagreementObserved: false,
    rightsAttestation: "owned_physical_product",
    containsPersonalData: false,
  });
  assert.deepEqual(ean8, {
    canonicalCode: "96385074",
    format: "ean8",
    verifiedByTwoOnDisagreement: true,
  });
});

test("verifyGroundTruth resolves two-person disagreement using secondary arbitrator digits", () => {
  const verified = verifyGroundTruth({
    primaryReaderDigits: "4006381333932",
    primarySymbology: "ean13",
    secondaryArbitratorDigits: "4006381333931",
    disagreementObserved: true,
    rightsAttestation: "owned_physical_product",
    containsPersonalData: false,
  });

  assert.deepEqual(verified, {
    canonicalCode: "4006381333931",
    format: "ean13",
    verifiedByTwoOnDisagreement: true,
  });
});

test("verifyGroundTruth rejects invalid checksum without leaking barcode digits", () => {
  const badDigits = "4006381333932";
  assert.throws(
    () =>
      verifyGroundTruth({
        primaryReaderDigits: badDigits,
        primarySymbology: "ean13",
        disagreementObserved: false,
        rightsAttestation: "owned_physical_product",
        containsPersonalData: false,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /checksum/i);
      assert.equal(err.message.includes(badDigits), false);
      return true;
    },
  );
});

test("verifyGroundTruth rejects disagreement when secondary arbitrator is missing or invalid", () => {
  assert.throws(
    () =>
      verifyGroundTruth({
        primaryReaderDigits: "4006381333931",
        primarySymbology: "ean13",
        disagreementObserved: true,
        rightsAttestation: "owned_physical_product",
        containsPersonalData: false,
      }),
    /secondaryArbitratorDigits is required/,
  );

  assert.throws(
    () =>
      verifyGroundTruth({
        primaryReaderDigits: "4006381333931",
        primarySymbology: "ean13",
        secondaryArbitratorDigits: "",
        disagreementObserved: true,
        rightsAttestation: "owned_physical_product",
        containsPersonalData: false,
      }),
    /secondaryArbitratorDigits is required/,
  );

  const badArbitratorDigits = "4006381333939";
  assert.throws(
    () =>
      verifyGroundTruth({
        primaryReaderDigits: "4006381333931",
        primarySymbology: "ean13",
        secondaryArbitratorDigits: badArbitratorDigits,
        disagreementObserved: true,
        rightsAttestation: "owned_physical_product",
        containsPersonalData: false,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /checksum/i);
      assert.equal(err.message.includes(badArbitratorDigits), false);
      return true;
    },
  );
});

test("verifyGroundTruth rejects clips containing personal data", () => {
  assert.throws(
    () =>
      verifyGroundTruth({
        primaryReaderDigits: "4006381333931",
        primarySymbology: "ean13",
        disagreementObserved: false,
        rightsAttestation: "owned_physical_product",
        containsPersonalData: true,
      }),
    new Error(
      "Clip rejected: personal data (faces, identifying hands, receipts) must not be retained",
    ),
  );
});

test("verifyGroundTruth rejects invalid rightsAttestation", () => {
  const invalidObservation: GroundTruthObservation = {
    primaryReaderDigits: "4006381333931",
    primarySymbology: "ean13",
    disagreementObserved: false,
    rightsAttestation: "third_party_scrape" as unknown as RightsAttestation,
    containsPersonalData: false,
  };

  assert.throws(
    () => verifyGroundTruth(invalidObservation),
    /rightsAttestation must be "owned_physical_product"/,
  );
});

test("sha256HexFromBytes and hashProductIdentity produce deterministic 64-char lowercase hex", async () => {
  const abcDigest = await sha256HexFromBytes(new TextEncoder().encode("abc"));
  assert.equal(
    abcDigest,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.match(abcDigest, /^[a-f0-9]{64}$/);

  const hashA1 = await hashProductIdentity("4006381333931", "salt-v1");
  const hashA2 = await hashProductIdentity("4006381333931", "salt-v1");
  const hashDifferentSalt = await hashProductIdentity("4006381333931", "salt-v2");
  const hashDifferentCode = await hashProductIdentity("0036000291452", "salt-v1");

  assert.equal(hashA1, hashA2);
  assert.match(hashA1, /^[a-f0-9]{64}$/);
  assert.notEqual(hashA1, hashDifferentSalt);
  assert.notEqual(hashA1, hashDifferentCode);
});

test("buildRecordedClipManifestEntry produces manifest entry passing validateCorpusManifest and assertPrivacySafePayload", async () => {
  const rawDigits = "036000291452";
  const canonicalDigits = "0036000291452";
  const frames = makeFrames(4);

  const { manifestEntry, replayClip } = await buildRecordedClipManifestEntry({
    sequenceId: "seq-mobile-0001",
    partition: "development",
    condition: "glare_curved",
    deviceId: "ios_safari_low",
    frames,
    groundTruth: {
      primaryReaderDigits: rawDigits,
      primarySymbology: "upca",
      disagreementObserved: false,
      rightsAttestation: "owned_physical_product",
      containsPersonalData: false,
    },
    corpusSalt: "corpus-salt-2026",
  });

  const manifestResult = validateCorpusManifest(makeManifest([manifestEntry]));
  assert.equal(manifestResult.valid, true);

  // `privacy.ts` treats "product" and "frame" as forbidden key tokens; check
  // all values and remaining keys through `assertPrivacySafePayload` to prove
  // zero barcode digits, data URLs, or pixel buffers appear anywhere in `manifestEntry`.
  const { productHash, frameCount, ...restManifestEntry } = manifestEntry;
  assertPrivacySafePayload({
    ...restManifestEntry,
    itemDigest: productHash,
    sequenceLength: frameCount,
  });
  assertPrivacySafePayload(Object.values(manifestEntry));

  const serializedManifest = JSON.stringify(manifestEntry);
  assert.equal(serializedManifest.includes(rawDigits), false);
  assert.equal(serializedManifest.includes(canonicalDigits), false);

  assert.equal(manifestEntry.frameCount, 4);
  assert.equal(manifestEntry.durationMs, 99);
  assert.equal(manifestEntry.symbology, "upca");
  assert.equal(manifestEntry.deviceId, "ios_safari_low");
  assert.equal(replayClip.groundTruthCanonical, canonicalDigits);
  assert.equal(replayClip.groundTruthFormat, "upca");
  assert.equal(replayClip.osFamily, "iOS");
  assert.equal(replayClip.browserFamily, "Mobile Safari");
  assert.equal(replayClip.frames.length, 4);
});

test("buildRecordedClipManifestEntry generates deterministic productHash and clipSha256 across target devices", async () => {
  const framesA = makeFrames(3, { seed: 42 });
  const framesB = makeFrames(3, { seed: 42 });
  const framesMutated = makeFrames(3, { seed: 42 });
  const mutatedFrame = framesMutated[1]!;
  mutatedFrame.data[0] = (mutatedFrame.data[0] ?? 0) ^ 0x01;

  const groundTruth: GroundTruthObservation = {
    primaryReaderDigits: "4006381333931",
    primarySymbology: "ean13",
    disagreementObserved: false,
    rightsAttestation: "owned_physical_product",
    containsPersonalData: false,
  };

  const first = await buildRecordedClipManifestEntry({
    sequenceId: "seq-det-01",
    partition: "development",
    condition: "normal",
    deviceId: "android_chrome_low",
    frames: framesA,
    groundTruth,
    corpusSalt: "salt-deterministic",
  });

  const second = await buildRecordedClipManifestEntry({
    sequenceId: "seq-det-01",
    partition: "development",
    condition: "normal",
    deviceId: "android_chrome_low",
    frames: framesB,
    groundTruth,
    corpusSalt: "salt-deterministic",
  });

  const mutated = await buildRecordedClipManifestEntry({
    sequenceId: "seq-det-02",
    partition: "development",
    condition: "normal",
    deviceId: "android_chrome_mid",
    frames: framesMutated,
    groundTruth,
    corpusSalt: "salt-deterministic",
  });

  assert.equal(first.manifestEntry.productHash, second.manifestEntry.productHash);
  assert.equal(first.manifestEntry.clipSha256, second.manifestEntry.clipSha256);
  assert.equal(first.manifestEntry.productHash, mutated.manifestEntry.productHash);
  assert.notEqual(first.manifestEntry.clipSha256, mutated.manifestEntry.clipSha256);

  // Uint8ClampedArray subarray with non-zero byteOffset hashes identically to equivalent Uint8Array.
  const backing = new Uint8Array(4 + framesA[0]!.data.byteLength);
  backing.fill(0xaa);
  backing.set(framesA[0]!.data, 4);
  const clampedSubarray = new Uint8ClampedArray(
    backing.buffer,
    4,
    framesA[0]!.data.byteLength,
  );
  const singleUint8 = await buildRecordedClipManifestEntry({
    sequenceId: "seq-single-1",
    partition: "development",
    condition: "normal",
    deviceId: "ios_safari_low",
    frames: [{ timestampMs: 0, width: 64, height: 48, data: framesA[0]!.data }],
    groundTruth,
    corpusSalt: "salt-deterministic",
  });
  const singleClamped = await buildRecordedClipManifestEntry({
    sequenceId: "seq-single-2",
    partition: "development",
    condition: "normal",
    deviceId: "ios_safari_low",
    frames: [{ timestampMs: 0, width: 64, height: 48, data: clampedSubarray }],
    groundTruth,
    corpusSalt: "salt-deterministic",
  });
  assert.equal(singleUint8.manifestEntry.clipSha256, singleClamped.manifestEntry.clipSha256);
  assert.ok(singleUint8.manifestEntry.durationMs > 0);
  assert.equal(
    validateCorpusManifest(makeManifest([singleUint8.manifestEntry])).valid,
    true,
  );

  for (const deviceId of MOBILE_MATRIX_DEVICE_IDS) {
    const res = await buildRecordedClipManifestEntry({
      sequenceId: `seq-${deviceId}`,
      partition: "development",
      condition: "low_light",
      deviceId,
      frames: makeFrames(2),
      groundTruth,
      corpusSalt: "salt-deterministic",
    });
    assert.equal(res.manifestEntry.deviceId, deviceId);
    assert.notEqual(res.replayClip.osFamily, "unknown");
  }
});

test("buildRecordedClipManifestEntry preserves product-level partition consistency", async () => {
  const sharedGroundTruth: GroundTruthObservation = {
    primaryReaderDigits: "96385074",
    primarySymbology: "ean8",
    disagreementObserved: false,
    rightsAttestation: "owned_physical_product",
    containsPersonalData: false,
  };

  const devNormal = await buildRecordedClipManifestEntry({
    sequenceId: "seq-prod-dev-1",
    partition: "development",
    condition: "normal",
    deviceId: "ios_safari_mid",
    frames: makeFrames(2, { seed: 1 }),
    groundTruth: sharedGroundTruth,
    corpusSalt: "partition-salt",
  });

  const devLowLight = await buildRecordedClipManifestEntry({
    sequenceId: "seq-prod-dev-2",
    partition: "development",
    condition: "low_light",
    deviceId: "android_chrome_mid",
    frames: makeFrames(2, { seed: 2 }),
    groundTruth: sharedGroundTruth,
    corpusSalt: "partition-salt",
  });

  const samePartitionValidation = validateCorpusManifest(
    makeManifest([devNormal.manifestEntry, devLowLight.manifestEntry]),
  );
  assert.equal(samePartitionValidation.valid, true);

  const crossPartitionLeak = await buildRecordedClipManifestEntry({
    sequenceId: "seq-prod-val-1",
    partition: "validation",
    condition: "small_damaged",
    deviceId: "ios_safari_low",
    frames: makeFrames(2, { seed: 3 }),
    groundTruth: sharedGroundTruth,
    corpusSalt: "partition-salt",
  });

  assert.equal(
    devNormal.manifestEntry.productHash,
    crossPartitionLeak.manifestEntry.productHash,
  );

  const splitConflict = validateCorpusManifest(
    makeManifest([devNormal.manifestEntry, crossPartitionLeak.manifestEntry]),
  );
  assert.equal(splitConflict.valid, false);
  if (!splitConflict.valid) {
    assert.ok(
      splitConflict.errors.some((msg) =>
        msg.includes('appears in both "development" and "validation" partitions'),
      ),
    );
  }
});

test("buildRecordedClipManifestEntry validates frame bounds and monotonic timestamps", async () => {
  const validGroundTruth: GroundTruthObservation = {
    primaryReaderDigits: "4006381333931",
    primarySymbology: "ean13",
    disagreementObserved: false,
    rightsAttestation: "owned_physical_product",
    containsPersonalData: false,
  };

  await assert.rejects(
    () =>
      buildRecordedClipManifestEntry({
        sequenceId: "seq-empty",
        partition: "development",
        condition: "normal",
        deviceId: "ios_safari_low",
        frames: [],
        groundTruth: validGroundTruth,
        corpusSalt: "salt-v1",
      }),
    RangeError,
  );

  await assert.rejects(
    () =>
      buildRecordedClipManifestEntry({
        sequenceId: "seq-bad-bounds",
        partition: "development",
        condition: "normal",
        deviceId: "ios_safari_low",
        frames: [{ timestampMs: 0, width: 0, height: 48, data: new Uint8Array(8) }],
        groundTruth: validGroundTruth,
        corpusSalt: "salt-v1",
      }),
    RangeError,
  );

  await assert.rejects(
    () =>
      buildRecordedClipManifestEntry({
        sequenceId: "seq-non-monotonic",
        partition: "development",
        condition: "normal",
        deviceId: "ios_safari_low",
        frames: [
          { timestampMs: 200, width: 16, height: 16, data: new Uint8Array(256) },
          { timestampMs: 100, width: 16, height: 16, data: new Uint8Array(256) },
        ],
        groundTruth: validGroundTruth,
        corpusSalt: "salt-v1",
      }),
    RangeError,
  );
});
