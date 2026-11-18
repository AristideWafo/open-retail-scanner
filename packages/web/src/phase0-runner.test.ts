import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertPrivacySafePayload,
  checkCorpusQuotas,
  CORPUS_CONDITIONS,
  MOBILE_MATRIX_DEVICE_IDS,
  validateCorpusManifest,
} from "open-retail-scanner-core";
import {
  generatePhase0CorpusAndManifest,
  runFullPhase0Benchmark,
  type Phase0BenchmarkSummary,
} from "./phase0-runner.ts";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("docs/benchmark/manifest.json passes validateCorpusManifest, checkCorpusQuotas, and privacy checks", async () => {
  const manifestPath = path.join(REPO_ROOT, "docs/benchmark/manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const parsed: unknown = JSON.parse(raw);

  const validation = validateCorpusManifest(parsed);
  assert.equal(
    validation.valid,
    true,
    validation.valid ? undefined : validation.errors.join("; "),
  );
  if (!validation.valid) return;

  const { manifest } = validation;
  assert.equal(manifest.entries.length, 160);

  const quotas = checkCorpusQuotas(manifest);
  assert.equal(quotas.meetsQuotas, true);
  assert.deepEqual(quotas.deficits, []);
  assert.equal(quotas.counts.distinctProducts, 40);
  assert.equal(quotas.counts.byPartition.development, 80);
  assert.equal(quotas.counts.byPartition.validation, 80);
  assert.equal(quotas.counts.distinctProductsByPartition.development, 20);
  assert.equal(quotas.counts.distinctProductsByPartition.validation, 20);

  for (const condition of CORPUS_CONDITIONS) {
    assert.ok(quotas.counts.distinctProductsByCondition[condition] >= 10);
    assert.equal(quotas.counts.byCondition[condition], 40);
  }

  assert.equal(quotas.counts.distinctMobileDevices, 4);
  assert.deepEqual(
    quotas.checks.minMobileDevices.missingMandatoryMobileDevices,
    [],
  );
  for (const deviceId of MOBILE_MATRIX_DEVICE_IDS) {
    assert.equal(quotas.counts.byDeviceId[deviceId], 40);
  }

  // Zero product overlap between development and validation partitions.
  const devProducts = new Set<string>();
  const valProducts = new Set<string>();
  for (const entry of manifest.entries) {
    if (entry.partition === "development") {
      devProducts.add(entry.productHash);
    } else {
      valProducts.add(entry.productHash);
    }
  }
  assert.equal(devProducts.size, 20);
  assert.equal(valProducts.size, 20);
  for (const hash of devProducts) {
    assert.equal(valProducts.has(hash), false);
  }

  // Assert all non-hash manifest fields pass assertPrivacySafePayload
  // (manifest.schema.json uses fixed keys `productHash` / `frameCount` and
  // 64-char SHA-256 hex digests may naturally contain 8 decimal hex chars,
  // which `validateCorpusManifest` explicitly validates via `SHA256_HEX_RE`).
  assertPrivacySafePayload([
    manifest.protocolVersion,
    manifest.corpusVersion,
    manifest.frozenAt,
    manifest.entries.map((entry) => ({
      sequenceId: entry.sequenceId,
      partition: entry.partition,
      symbology: entry.symbology,
      condition: entry.condition,
      deviceId: entry.deviceId,
      durationMs: entry.durationMs,
      rightsAttestation: entry.rightsAttestation,
      groundTruthVerifiedByTwoOnDisagreement:
        entry.groundTruthVerifiedByTwoOnDisagreement,
    })),
  ]);
});

test("docs/benchmark/phase0-results.json passes assertPrivacySafePayload and all Phase 0 GO gates", async () => {
  const resultsPath = path.join(
    REPO_ROOT,
    "docs/benchmark/phase0-results.json",
  );
  const raw = await readFile(resultsPath, "utf8");
  const results = JSON.parse(raw) as Phase0BenchmarkSummary;

  assertPrivacySafePayload(results);

  assert.equal(results.schema, "orc.phase0-results.v1");
  assert.equal(results.phase0Decision, "GO");
  assert.equal(results.frozenConfigurationId, "zxing-tuned-th1-tr1-ti0");
  assert.equal(results.validation.analysisFrozen, true);
  assert.equal(results.corpusSummary.totalSequences, 160);
  assert.equal(results.corpusSummary.distinctProducts, 40);
  assert.equal(results.development.sequenceCount, 80);
  assert.equal(results.development.androidChromeSequenceCount, 40);
  assert.equal(results.validation.sequenceCount, 80);
  assert.equal(results.validation.androidChromeSequenceCount, 40);

  for (const split of [results.development, results.validation]) {
    const gate = split.gateCheck;
    assert.equal(gate.passed, true);
    assert.ok(
      gate.overallDeltaPp >= 10,
      `Expected >= +10 pp improvement, got ${gate.overallDeltaPp}`,
    );
    assert.ok(
      gate.minSubgroupDeltaPp >= -3,
      `Expected no subgroup worse than -3 pp, got ${gate.minSubgroupDeltaPp}`,
    );
    assert.equal(gate.p95NotWorse, true);
    assert.equal(gate.replayWrongValidCount, 0);
    assert.equal(gate.syntheticWrongValidCount, 0);
    assert.ok(gate.syntheticUpperBound95 <= 0.00003);
    assert.equal(gate.nativeDetectorEvaluatedOnIos, false);

    const nativeCfg = split.configurations.find(
      (c) => c.configurationId === "native-barcode-detector",
    );
    assert.ok(nativeCfg !== undefined);
    assert.equal(nativeCfg.overall.totalTrials, 40);
    assert.equal(nativeCfg.byDeviceClass["ios_safari_low"], undefined);
    assert.equal(nativeCfg.byDeviceClass["ios_safari_mid"], undefined);
    assert.equal(nativeCfg.byDeviceClass["android_chrome_low"]?.totalTrials, 20);
    assert.equal(nativeCfg.byDeviceClass["android_chrome_mid"]?.totalTrials, 20);
  }

  assert.equal(results.syntheticStressTest.totalFrames, 100_000);
  assert.equal(results.syntheticStressTest.wrongValidAccepted, 0);
  assert.ok(results.syntheticStressTest.ruleOfThree95UpperBound <= 0.00003);
  assert.equal(
    results.legalAndCleanRoomDecision.scanbotComparisonStatus,
    "excluded_not_authorized",
  );
});

test("generatePhase0CorpusAndManifest stores raw clips outside git and matches committed manifest", async () => {
  await assert.rejects(
    () =>
      generatePhase0CorpusAndManifest(
        path.join(REPO_ROOT, "forbidden-corpus-inside-git"),
      ),
    /must never be inside the git repository/,
  );

  const tmpRoot = await mkdtemp(
    path.join(os.tmpdir(), "orc-phase0-test-corpus-"),
  );
  try {
    const generated = await generatePhase0CorpusAndManifest(tmpRoot);
    assert.equal(generated.clipCount, 160);
    assert.equal(generated.quotaReport.meetsQuotas, true);

    const sampleClipStat = await stat(
      path.join(tmpRoot, "clips", "seq-dev-001.bin"),
    );
    assert.ok(sampleClipStat.size > 0);

    const committedRaw = await readFile(
      path.join(REPO_ROOT, "docs/benchmark/manifest.json"),
      "utf8",
    );
    const committedManifest = JSON.parse(committedRaw);
    assert.deepEqual(generated.manifest, committedManifest);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("runFullPhase0Benchmark deterministically reproduces committed phase0-results.json gates", async () => {
  const live = await runFullPhase0Benchmark();
  assertPrivacySafePayload(live);

  const committedRaw = await readFile(
    path.join(REPO_ROOT, "docs/benchmark/phase0-results.json"),
    "utf8",
  );
  const committed = JSON.parse(committedRaw) as Phase0BenchmarkSummary;

  assert.equal(live.phase0Decision, committed.phase0Decision);
  assert.deepEqual(live.corpusSummary, committed.corpusSummary);
  assert.equal(
    live.development.gateCheck.overallDeltaPp,
    committed.development.gateCheck.overallDeltaPp,
  );
  assert.equal(
    live.validation.gateCheck.overallDeltaPp,
    committed.validation.gateCheck.overallDeltaPp,
  );
  assert.equal(
    live.development.gateCheck.replayWrongValidCount,
    committed.development.gateCheck.replayWrongValidCount,
  );
  assert.equal(
    live.validation.gateCheck.replayWrongValidCount,
    committed.validation.gateCheck.replayWrongValidCount,
  );
  assert.deepEqual(live.syntheticStressTest, committed.syntheticStressTest);
});
