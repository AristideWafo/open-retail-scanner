import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CI_REPLAY_DEVICE_ID,
  CORPUS_CONDITIONS,
  MOBILE_MATRIX_DEVICE_IDS,
  checkCorpusQuotas,
  validateCorpusManifest,
  type CorpusCondition,
  type CorpusManifest,
  type CorpusManifestEntry,
  type CorpusPartition,
} from "./corpus.ts";
import type { BarcodeFormat } from "./index.ts";

function makeSha256(seed: number): string {
  return seed.toString(16).padStart(64, "a");
}

function makeEntry(
  index: number,
  overrides: Partial<CorpusManifestEntry> = {},
): CorpusManifestEntry {
  const symbologies: readonly BarcodeFormat[] = ["ean13", "upca", "ean8"];
  const condition = CORPUS_CONDITIONS[index % CORPUS_CONDITIONS.length]!;
  const symbology = symbologies[index % symbologies.length]!;
  const deviceId =
    MOBILE_MATRIX_DEVICE_IDS[index % MOBILE_MATRIX_DEVICE_IDS.length]!;
  const partition: CorpusPartition = index % 2 === 0 ? "development" : "validation";

  return {
    sequenceId: `seq-${String(index).padStart(4, "0")}`,
    productHash: makeSha256(index + 1),
    clipSha256: makeSha256(index + 10_001),
    partition,
    symbology,
    condition,
    deviceId,
    frameCount: 90,
    durationMs: 3000,
    rightsAttestation: "owned_physical_product",
    groundTruthVerifiedByTwoOnDisagreement: true,
    ...overrides,
  };
}

function makeValidManifest(entries: readonly CorpusManifestEntry[]): CorpusManifest {
  return {
    protocolVersion: "v1.0.0-lite",
    corpusVersion: "corpus-2026-11-18",
    frozenAt: "2026-11-18T13:51:28Z",
    entries,
  };
}

test("validates a well-formed manifest with multiple conditions of the same product in one split", () => {
  const entries: CorpusManifestEntry[] = [
    makeEntry(0, { partition: "development", condition: "normal" }),
    makeEntry(1, {
      sequenceId: "seq-0001-b",
      productHash: makeSha256(1),
      partition: "development",
      condition: "low_light",
    }),
    makeEntry(2, { partition: "validation", condition: "glare_curved" }),
  ];

  const result = validateCorpusManifest(makeValidManifest(entries));
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.manifest.entries.length, 3);
    assert.equal(result.manifest.protocolVersion, "v1.0.0-lite");
  }
});

test("rejects non-objects, missing fields, invalid dates, and unexpected properties", () => {
  assert.equal(validateCorpusManifest(null).valid, false);
  assert.equal(validateCorpusManifest([]).valid, false);

  const badDate = validateCorpusManifest({
    ...makeValidManifest([]),
    frozenAt: "2026-02-30",
  });
  assert.equal(badDate.valid, false);

  const badVersion = validateCorpusManifest({
    ...makeValidManifest([]),
    protocolVersion: "1.0",
  });
  assert.equal(badVersion.valid, false);

  const extraTop = validateCorpusManifest({
    ...makeValidManifest([makeEntry(0)]),
    notes: "should not be allowed",
  });
  assert.equal(extraTop.valid, false);

  const extraEntry = validateCorpusManifest(
    makeValidManifest([
      {
        ...makeEntry(0),
        rawValue: "4006381333931",
      } as unknown as CorpusManifestEntry,
    ]),
  );
  assert.equal(extraEntry.valid, false);
  if (!extraEntry.valid) {
    assert.equal(extraEntry.errors.join("\n").includes("4006381333931"), false);
  }
});

test("rejects 8, 12, 13, and 14-digit barcode strings in any field without echoing them", () => {
  const samples = ["96385074", "036000291452", "4006381333931", "04006381333931"];

  for (const digits of samples) {
    const inSeq = validateCorpusManifest(
      makeValidManifest([makeEntry(0, { sequenceId: `seq-${digits}` })]),
    );
    assert.equal(inSeq.valid, false);
    if (!inSeq.valid) {
      assert.equal(inSeq.errors.join("\n").includes(digits), false);
    }

    const inDevice = validateCorpusManifest(
      makeValidManifest([makeEntry(0, { deviceId: digits })]),
    );
    assert.equal(inDevice.valid, false);
    if (!inDevice.valid) {
      assert.equal(inDevice.errors.join("\n").includes(digits), false);
    }

    const inCorpusVersion = validateCorpusManifest({
      ...makeValidManifest([makeEntry(0)]),
      corpusVersion: `corpus-${digits}`,
    });
    assert.equal(inCorpusVersion.valid, false);
    if (!inCorpusVersion.valid) {
      assert.equal(inCorpusVersion.errors.join("\n").includes(digits), false);
    }
  }
});

test("rejects data URLs and file paths to raw images or videos", () => {
  const forbiddenInputs = [
    "data:image/png;base64,iVBORw0KGgo=",
    "data:video/mp4;base64,AAAA",
    "clips/normal/seq1.mp4",
    "/tmp/capture/frame.png",
    "C:\\clips\\barcode.jpg",
    "file:///Users/test/video.webm",
    "sample.webp",
  ];

  for (const sample of forbiddenInputs) {
    const res = validateCorpusManifest(
      makeValidManifest([makeEntry(0, { sequenceId: sample })]),
    );
    assert.equal(res.valid, false, `expected rejection for ${sample}`);
  }
});

test("rejects missing or invalid rightsAttestation and invalid SHA-256 hex strings", () => {
  const missingRights = makeEntry(0) as unknown as Record<string, unknown>;
  delete missingRights["rightsAttestation"];
  const resMissingRights = validateCorpusManifest(
    makeValidManifest([missingRights as unknown as CorpusManifestEntry]),
  );
  assert.equal(resMissingRights.valid, false);

  const badRights = validateCorpusManifest(
    makeValidManifest([
      makeEntry(0, {
        rightsAttestation: "scraped" as unknown as "owned_physical_product",
      }),
    ]),
  );
  assert.equal(badRights.valid, false);

  const badHashes = [
    "abc",
    "A".repeat(64),
    "g".repeat(64),
    "0".repeat(63),
    "0".repeat(65),
  ];
  for (const badHash of badHashes) {
    assert.equal(
      validateCorpusManifest(
        makeValidManifest([makeEntry(0, { productHash: badHash })]),
      ).valid,
      false,
    );
    assert.equal(
      validateCorpusManifest(
        makeValidManifest([makeEntry(0, { clipSha256: badHash })]),
      ).valid,
      false,
    );
  }
});

test("rejects invalid numeric bounds, booleans, enums, and duplicate sequenceId", () => {
  assert.equal(
    validateCorpusManifest(
      makeValidManifest([makeEntry(0, { frameCount: 0 })]),
    ).valid,
    false,
  );
  assert.equal(
    validateCorpusManifest(
      makeValidManifest([makeEntry(0, { frameCount: 12.5 })]),
    ).valid,
    false,
  );
  assert.equal(
    validateCorpusManifest(
      makeValidManifest([makeEntry(0, { durationMs: 0 })]),
    ).valid,
    false,
  );
  assert.equal(
    validateCorpusManifest(
      makeValidManifest([makeEntry(0, { durationMs: Number.NaN })]),
    ).valid,
    false,
  );
  assert.equal(
    validateCorpusManifest(
      makeValidManifest([
        makeEntry(0, {
          groundTruthVerifiedByTwoOnDisagreement: "true" as unknown as boolean,
        }),
      ]),
    ).valid,
    false,
  );

  const duplicateSeq = validateCorpusManifest(
    makeValidManifest([
      makeEntry(0, { sequenceId: "seq-dup" }),
      makeEntry(1, { sequenceId: "seq-dup" }),
    ]),
  );
  assert.equal(duplicateSeq.valid, false);
});

test("enforces product-level partition separation between development and validation", () => {
  const sharedProductHash = makeSha256(999);
  const res = validateCorpusManifest(
    makeValidManifest([
      makeEntry(0, { productHash: sharedProductHash, partition: "development" }),
      makeEntry(1, { productHash: sharedProductHash, partition: "validation" }),
    ]),
  );
  assert.equal(res.valid, false);
  if (!res.valid) {
    assert.ok(
      res.errors.some((e) => e.includes("both") && e.includes("development") && e.includes("validation")),
    );
  }
});

test("checkCorpusQuotas passes for 40 distinct products (10 per condition) across 4 mobile devices", () => {
  const entries: CorpusManifestEntry[] = [];
  for (let i = 0; i < 40; i++) {
    entries.push(makeEntry(i));
  }
  const validation = validateCorpusManifest(makeValidManifest(entries));
  assert.equal(validation.valid, true);
  if (!validation.valid) return;

  const report = checkCorpusQuotas(validation.manifest);
  assert.equal(report.meetsQuotas, true);
  assert.deepEqual(report.deficits, []);
  assert.equal(report.checks.minDistinctProducts.passed, true);
  assert.equal(report.checks.minDistinctProducts.actual, 40);
  assert.equal(report.checks.minPerCondition.passed, true);
  for (const cond of CORPUS_CONDITIONS) {
    assert.equal(report.counts.distinctProductsByCondition[cond], 10);
  }
  assert.equal(report.checks.minMobileDevices.passed, true);
  assert.equal(report.checks.minMobileDevices.actual, 4);
  assert.deepEqual(report.checks.minMobileDevices.missingMandatoryMobileDevices, []);
  assert.equal(report.counts.byPartition.development, 20);
  assert.equal(report.counts.byPartition.validation, 20);
  assert.equal(
    report.counts.bySymbology.ean13 +
      report.counts.bySymbology.upca +
      report.counts.bySymbology.ean8,
    40,
  );
});

test("checkCorpusQuotas detects product, condition, and mobile device deficits (excluding ci_deterministic_replay)", () => {
  // 40 entries, but only 20 distinct products, skewed condition counts, and 3 mobile + 1 CI device
  const entries: CorpusManifestEntry[] = [];
  const threeMobilePlusCi = [
    "ios_safari_low",
    "ios_safari_mid",
    "android_chrome_low",
    CI_REPLAY_DEVICE_ID,
  ];
  for (let i = 0; i < 40; i++) {
    const productIndex = i % 20;
    const condition: CorpusCondition = i < 34 ? "normal" : "low_light";
    entries.push(
      makeEntry(i, {
        productHash: makeSha256(productIndex + 1),
        partition: productIndex % 2 === 0 ? "development" : "validation",
        condition,
        deviceId: threeMobilePlusCi[i % threeMobilePlusCi.length]!,
      }),
    );
  }

  const validation = validateCorpusManifest(makeValidManifest(entries));
  assert.equal(validation.valid, true);
  if (!validation.valid) return;

  const report = checkCorpusQuotas(validation.manifest);
  assert.equal(report.meetsQuotas, false);
  assert.equal(report.checks.minDistinctProducts.passed, false);
  assert.equal(report.checks.minDistinctProducts.actual, 20);
  assert.equal(report.checks.minPerCondition.passed, false);
  assert.equal(report.counts.distinctProductsByCondition.glare_curved, 0);
  assert.equal(report.counts.distinctProductsByCondition.small_damaged, 0);
  assert.equal(report.checks.minMobileDevices.passed, false);
  assert.equal(report.checks.minMobileDevices.actual, 3);
  assert.deepEqual(report.checks.minMobileDevices.missingMandatoryMobileDevices, [
    "android_chrome_mid",
  ]);
  assert.ok(report.deficits.length >= 4);
});

test("checkCorpusQuotas fails when 4 distinct mobile deviceIds exist but a mandatory matrix device is missing", () => {
  const nonMatrixDevices = [
    "ios_safari_low",
    "ios_safari_mid",
    "android_chrome_low",
    "custom_android_tablet",
  ];
  const entries: CorpusManifestEntry[] = [];
  for (let i = 0; i < 40; i++) {
    entries.push(
      makeEntry(i, {
        deviceId: nonMatrixDevices[i % nonMatrixDevices.length]!,
      }),
    );
  }
  const validation = validateCorpusManifest(makeValidManifest(entries));
  assert.equal(validation.valid, true);
  if (!validation.valid) return;

  const report = checkCorpusQuotas(validation.manifest);
  assert.equal(report.meetsQuotas, false);
  assert.equal(report.checks.minMobileDevices.actual, 4);
  assert.deepEqual(report.checks.minMobileDevices.missingMandatoryMobileDevices, [
    "android_chrome_mid",
  ]);
  assert.equal(report.checks.minMobileDevices.passed, false);
  assert.ok(
    report.deficits.some((d) => d.includes("missing mandatory mobile matrix devices")),
  );
});

test("docs/benchmark/manifest.schema.json is valid JSON Schema draft 2020-12 with additionalProperties: false", async () => {
  const schemaUrl = new URL("../../../docs/benchmark/manifest.schema.json", import.meta.url);
  const raw = await readFile(schemaUrl, "utf8");
  const schema = JSON.parse(raw) as {
    $schema: string;
    additionalProperties: boolean;
    required: string[];
    $defs: { manifestEntry: { additionalProperties: boolean; required: string[] } };
  };

  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "protocolVersion",
    "corpusVersion",
    "frozenAt",
    "entries",
  ]);
  assert.equal(schema.$defs.manifestEntry.additionalProperties, false);
  assert.ok(schema.$defs.manifestEntry.required.includes("rightsAttestation"));
  assert.ok(
    schema.$defs.manifestEntry.required.includes(
      "groundTruthVerifiedByTwoOnDisagreement",
    ),
  );
});
