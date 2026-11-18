import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateBenchmarkResults,
  ruleOfThreeUpperBound,
  runReplayBenchmark,
  runSyntheticWrongCodeStressTest,
  seededRandom,
  shuffleWithSeed,
  type BenchmarkRunResult,
  type ReplayClip,
  type ReplayEngineAdapter,
  type ReplayFrame,
} from "./harness.ts";

function makeFrame(timestampMs: number): ReplayFrame {
  return {
    timestampMs,
    width: 640,
    height: 480,
    data: new Uint8Array(16),
  };
}

function makeClip(
  overrides: Partial<ReplayClip> & { readonly sequenceId: string },
): ReplayClip {
  return {
    partition: "development",
    symbology: "ean13",
    condition: "normal",
    groundTruthCanonical: "4006381333931",
    groundTruthFormat: "ean13",
    deviceClass: "mid-tier-phone",
    osFamily: "Android",
    osVersion: "14",
    browserFamily: "Chrome",
    browserVersion: "130",
    frames: [makeFrame(100), makeFrame(200), makeFrame(300)],
    ...overrides,
  };
}

test("seededRandom and shuffleWithSeed are deterministic", () => {
  const r1 = seededRandom(42);
  const r2 = seededRandom(42);
  const seq1 = [r1(), r1(), r1(), r1()];
  const seq2 = [r2(), r2(), r2(), r2()];
  assert.deepEqual(seq1, seq2);

  const items = ["a", "b", "c", "d", "e"] as const;
  const s1 = shuffleWithSeed(items, 1234);
  const s2 = shuffleWithSeed(items, 1234);
  assert.deepEqual(s1, s2);
  assert.deepEqual([...items].sort(), [...s1].sort());
});

test("runReplayBenchmark enforces validation partition lock", async () => {
  const validationClip = makeClip({
    sequenceId: "seq-val-1",
    partition: "validation",
  });

  const adapter: ReplayEngineAdapter = {
    engineName: "zxing-wasm",
    engineVersion: "2.0.0",
    buildId: "build-1",
    configurationId: "ean-upc-default",
    decodeFrame: () => ({ rawValue: "4006381333931", format: "ean13" }),
  };

  await assert.rejects(
    () =>
      runReplayBenchmark([validationClip], adapter, {
        protocolVersion: "1.0.0",
        corpusVersion: "corpus-v1",
      }),
    /Validation partition is locked until analysis code is frozen/,
  );

  await assert.rejects(
    () =>
      runReplayBenchmark([validationClip], adapter, {
        protocolVersion: "1.0.0",
        corpusVersion: "corpus-v1",
        analysisFrozen: true,
      }),
    /Validation partition is locked until analysis code is frozen/,
  );

  const unlocked = await runReplayBenchmark([validationClip], adapter, {
    protocolVersion: "1.0.0",
    corpusVersion: "corpus-v1",
    analysisFrozen: true,
    protocolFreezeHash: "sha256-frozen-protocol",
  });
  assert.equal(unlocked.length, 1);
  assert.equal(unlocked[0]?.outcome, "correct");
});

test("runReplayBenchmark replays deterministically and classifies outcomes without leaking barcode values", async () => {
  const clips: readonly ReplayClip[] = [
    makeClip({
      sequenceId: "seq-ok",
      symbology: "upca",
      groundTruthCanonical: "0036000291452",
      groundTruthFormat: "upca",
      frames: [makeFrame(1000), makeFrame(1300), makeFrame(1600)],
    }),
    makeClip({
      sequenceId: "seq-wrong",
      symbology: "ean8",
      condition: "glare_curved",
      groundTruthCanonical: "96385074",
      groundTruthFormat: "ean8",
      frames: [makeFrame(100), makeFrame(200)],
    }),
    makeClip({
      sequenceId: "seq-none",
      condition: "low_light",
      frames: [makeFrame(100), makeFrame(200)],
    }),
    makeClip({
      sequenceId: "seq-cam-err",
      condition: "small_damaged",
      cameraError: true,
    }),
  ];

  const adapter: ReplayEngineAdapter = {
    engineName: "zxing-wasm",
    engineVersion: "2.0.0",
    buildId: "build-1",
    configurationId: "ean-upc-only",
    decodeFrame(frame) {
      if (frame.timestampMs >= 1000) {
        return { rawValue: "036000291452", format: "upca" };
      }
      if (frame.timestampMs === 100 || frame.timestampMs === 200) {
        return { rawValue: "40170725", format: "ean8" };
      }
      return null;
    },
  };

  // Clip 3 ("seq-none") also has 100/200 frames -> let's use distinct timestamps for seq-none
  const adjustedClips: readonly ReplayClip[] = [
    clips[0]!,
    clips[1]!,
    makeClip({
      sequenceId: "seq-none",
      condition: "low_light",
      frames: [makeFrame(500), makeFrame(600)],
    }),
    clips[3]!,
  ];

  const resultsA = await runReplayBenchmark(adjustedClips, adapter, {
    protocolVersion: "1.0.0",
    corpusVersion: "corpus-v1",
    seed: 99,
  });
  const resultsB = await runReplayBenchmark(adjustedClips, adapter, {
    protocolVersion: "1.0.0",
    corpusVersion: "corpus-v1",
    seed: 99,
  });

  assert.deepEqual(
    resultsA.map((r) => ({ seq: r.sequenceId, outcome: r.outcome })),
    resultsB.map((r) => ({ seq: r.sequenceId, outcome: r.outcome })),
  );

  const bySeq = new Map(resultsA.map((r) => [r.sequenceId, r]));
  assert.equal(bySeq.get("seq-ok")?.outcome, "correct");
  assert.equal(bySeq.get("seq-ok")?.timeToResultMs, 300);
  assert.equal(bySeq.get("seq-wrong")?.outcome, "wrong_valid");
  assert.equal(bySeq.get("seq-none")?.outcome, "no_result");
  assert.equal(bySeq.get("seq-cam-err")?.outcome, "camera_error");

  const serialized = JSON.stringify(resultsA);
  assert.equal(serialized.includes("036000291452"), false);
  assert.equal(serialized.includes("96385074"), false);
  assert.equal(serialized.includes("40170725"), false);
});

test("runReplayBenchmark classifies adapter errors as engine_error", async () => {
  const clip = makeClip({ sequenceId: "seq-err" });
  const failingAdapter: ReplayEngineAdapter = {
    engineName: "broken-engine",
    engineVersion: "0.0.1",
    buildId: "build-err",
    configurationId: "default",
    decodeFrame() {
      throw new Error("wasm trap");
    },
  };

  const results = await runReplayBenchmark([clip], failingAdapter, {
    protocolVersion: "1.0.0",
    corpusVersion: "corpus-v1",
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.outcome, "engine_error");
  assert.equal("timeToResultMs" in results[0]!, false);
});

test("aggregateBenchmarkResults computes rates, Wilson CIs, quantiles, rule-of-three, and subgroups", () => {
  const base: Omit<
    BenchmarkRunResult,
    "sequenceId" | "symbology" | "condition" | "deviceClass" | "outcome" | "timeToResultMs" | "initializationMs"
  > = {
    protocolVersion: "1.0.0",
    corpusVersion: "corpus-v1",
    partition: "development",
    engineName: "zxing-wasm",
    engineVersion: "2.0.0",
    buildId: "b1",
    configurationId: "cfg-1",
    osFamily: "iOS",
    osVersion: "17.5",
    browserFamily: "Safari",
    browserVersion: "17",
    startedAtMonotonicMs: 1000,
    longTaskCount: 0,
    peakMemoryClass: "low",
  };

  const runs: readonly BenchmarkRunResult[] = [
    {
      ...base,
      sequenceId: "s1",
      symbology: "ean13",
      condition: "normal",
      deviceClass: "iphone-13",
      outcome: "correct",
      timeToResultMs: 400,
      initializationMs: 50,
    },
    {
      ...base,
      sequenceId: "s2",
      symbology: "ean13",
      condition: "low_light",
      deviceClass: "iphone-13",
      outcome: "correct",
      timeToResultMs: 1500,
      initializationMs: 100,
    },
    {
      ...base,
      sequenceId: "s3",
      symbology: "upca",
      condition: "glare_curved",
      deviceClass: "pixel-7",
      outcome: "correct",
      timeToResultMs: 2500,
      initializationMs: 150,
    },
    {
      ...base,
      sequenceId: "s4",
      symbology: "ean8",
      condition: "small_damaged",
      deviceClass: "pixel-7",
      outcome: "no_result",
      initializationMs: 200,
    },
  ];

  const report = aggregateBenchmarkResults(runs);
  assert.equal(report.totalTrials, 4);
  assert.equal(report.correctWithin1s.count, 1);
  assert.equal(report.correctWithin1s.rate, 0.25);
  assert.equal(report.correctWithin2s.count, 2);
  assert.equal(report.correctWithin3s.count, 3);
  assert.equal(report.correctWithin5s.count, 3);
  assert.ok(report.correctWithin3s.ci95.lower > 0 && report.correctWithin3s.ci95.upper <= 1);
  assert.equal(report.timeToFirstCorrectMs.p50, 1500);
  assert.equal(report.wrongValidCount, 0);
  assert.equal(report.wrongValidNote, "one_sided_95_upper_bound_not_zero_risk");
  assert.equal(
    report.wrongValidRuleOfThree95UpperBound,
    ruleOfThreeUpperBound(0, 4),
  );
  assert.equal(report.noResultRate, 0.25);
  assert.equal(report.recoverableFailureRate, 0);
  assert.equal(report.coldInitP50Ms, 125);

  assert.equal(report.byEngine["zxing-wasm"]?.totalTrials, 4);
  assert.equal(report.byConfiguration["zxing-wasm@cfg-1"]?.totalTrials, 4);
  assert.equal(report.bySymbology["ean13"]?.totalTrials, 2);
  assert.equal(report.bySymbology["upca"]?.totalTrials, 1);
  assert.equal(report.byCondition["low_light"]?.totalTrials, 1);
  assert.equal(report.byDeviceClass["iphone-13"]?.totalTrials, 2);
  assert.equal(report.byDeviceClass["pixel-7"]?.totalTrials, 2);
});

test("aggregateBenchmarkResults computes recoverableFailureRate across camera_error and engine_error and groups byEngine and byConfiguration", () => {
  const template: Omit<
    BenchmarkRunResult,
    "sequenceId" | "engineName" | "outcome" | "timeToResultMs"
  > = {
    protocolVersion: "1.0.0",
    corpusVersion: "corpus-v1",
    partition: "development",
    engineVersion: "2.0.0",
    buildId: "b1",
    configurationId: "cfg-1",
    deviceClass: "iphone-13",
    osFamily: "iOS",
    osVersion: "17.5",
    browserFamily: "Safari",
    browserVersion: "17",
    symbology: "ean13",
    condition: "normal",
    startedAtMonotonicMs: 1000,
    initializationMs: 50,
    longTaskCount: 0,
    peakMemoryClass: "low",
  };

  const runs: readonly BenchmarkRunResult[] = [
    { ...template, sequenceId: "s1", engineName: "zxing-wasm", outcome: "correct", timeToResultMs: 300 },
    { ...template, sequenceId: "s2", engineName: "zxing-wasm", outcome: "no_result" },
    { ...template, sequenceId: "s3", engineName: "zxing-wasm", outcome: "camera_error" },
    { ...template, sequenceId: "s4", engineName: "native-detector", outcome: "engine_error" },
    { ...template, sequenceId: "s5", engineName: "native-detector", outcome: "wrong_valid", timeToResultMs: 200 },
  ];

  const report = aggregateBenchmarkResults(runs);
  assert.equal(report.noResultRate, 1 / 5);
  assert.equal(report.recoverableFailureRate, 2 / 5);
  assert.equal(report.byEngine["zxing-wasm"]?.totalTrials, 3);
  assert.equal(report.byEngine["zxing-wasm"]?.noResultRate, 1 / 3);
  assert.equal(report.byEngine["zxing-wasm"]?.recoverableFailureRate, 1 / 3);
  assert.equal(report.byConfiguration["zxing-wasm@cfg-1"]?.totalTrials, 3);
  assert.equal(report.byEngine["native-detector"]?.totalTrials, 2);
  assert.equal(report.byEngine["native-detector"]?.recoverableFailureRate, 1 / 2);
  assert.equal(report.byEngine["native-detector"]?.wrongValidCount, 1);

  const emptyReport = aggregateBenchmarkResults([]);
  assert.equal(emptyReport.recoverableFailureRate, 0);
  assert.deepEqual(emptyReport.byEngine, {});
  assert.deepEqual(emptyReport.byConfiguration, {});
});

test("aggregateBenchmarkResults rejects leaked barcode or frame payloads", () => {
  const leaked = {
    protocolVersion: "1.0.0",
    corpusVersion: "corpus-v1",
    partition: "development",
    engineName: "zxing-wasm",
    engineVersion: "2.0.0",
    buildId: "b1",
    configurationId: "cfg-1",
    deviceClass: "iphone-13",
    osFamily: "iOS",
    osVersion: "17.5",
    browserFamily: "Safari",
    browserVersion: "17",
    symbology: "ean13",
    condition: "normal",
    sequenceId: "4006381333931",
    startedAtMonotonicMs: 1000,
    outcome: "correct",
    timeToResultMs: 400,
    initializationMs: 50,
    longTaskCount: 0,
    peakMemoryClass: "low",
  } satisfies BenchmarkRunResult;

  assert.throws(() => aggregateBenchmarkResults([leaked]), /Privacy violation/);
});

test("runSyntheticWrongCodeStressTest processes 100,000 perturbed frames fast with 0 wrong-valid", () => {
  const start = performance.now();
  const res = runSyntheticWrongCodeStressTest({ frameCount: 100_000 });
  const elapsedMs = performance.now() - start;

  assert.equal(res.totalFrames, 100_000);
  assert.equal(res.wrongValidAccepted, 0);
  assert.ok(res.ruleOfThree95UpperBound <= 0.00003);
  assert.equal(
    res.riskDisclaimer,
    "One-sided 95% upper bound; never claim zero real-world risk.",
  );
  assert.ok(
    elapsedMs < 300,
    `Expected 100k stress test under 300ms, took ${elapsedMs.toFixed(1)}ms`,
  );
});
