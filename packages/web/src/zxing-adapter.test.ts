import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateBenchmarkResults,
  canonicalValue,
  computeCheckDigit,
  isValidCode,
  runReplayBenchmark,
  runSyntheticWrongCodeStressTest,
  type BarcodeFormat,
  type BenchmarkCondition,
  type ReplayClip,
  type ReplayFrame,
} from "open-retail-scanner-core";
import {
  loadLocalZxingWasmBinary,
  renderLinearBarcodeFrame,
  ZXING_ENGINE_VERSION,
  ZxingWasmAdapter,
} from "./zxing-adapter.ts";

function buildValidCode(body: string): string {
  return `${body}${computeCheckDigit(body)}`;
}

function makeRgbaFrame(gray: ReplayFrame): ReplayFrame {
  const pixelCount = gray.width * gray.height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0, dst = 0; i < pixelCount; i++, dst += 4) {
    const lum = gray.data[i] ?? 0;
    rgba[dst] = lum;
    rgba[dst + 1] = lum;
    rgba[dst + 2] = lum;
    rgba[dst + 3] = 255;
  }
  return {
    timestampMs: gray.timestampMs,
    width: gray.width,
    height: gray.height,
    data: rgba,
  };
}

function buildMultiFrameClip(
  sequenceId: string,
  code: string,
  format: BarcodeFormat,
  condition: BenchmarkCondition,
  rotate90: boolean,
): ReplayClip {
  const longSide = format === "ean8" ? 280 : 340;
  const shortSide = 180;
  const baseFrame = renderLinearBarcodeFrame(code, format, {
    width: rotate90 ? shortSide : longSide,
    height: rotate90 ? longSide : shortSide,
    condition,
    rotate90,
  });
  const frames: ReplayFrame[] = [
    { ...baseFrame, timestampMs: 0 },
    { ...baseFrame, timestampMs: 33 },
    { ...baseFrame, timestampMs: 66 },
  ];
  return {
    sequenceId,
    partition: "development",
    symbology: format,
    condition,
    groundTruthCanonical: canonicalValue(code, format),
    groundTruthFormat: format,
    deviceClass: "ci_deterministic_replay",
    osFamily: "linux",
    osVersion: "6.8",
    browserFamily: "nodejs",
    browserVersion: process.versions.node,
    frames,
  };
}

function buildPhase0CorpusClips(): ReplayClip[] {
  const conditions: readonly BenchmarkCondition[] = [
    "normal",
    "low_light",
    "glare_curved",
    "small_damaged",
  ];
  const formats: readonly BarcodeFormat[] = [
    "ean13",
    "ean13",
    "upca",
    "ean8",
    "ean13",
    "upca",
    "ean8",
    "ean13",
    "upca",
    "ean13",
  ];

  const clips: ReplayClip[] = [];
  let index = 0;

  for (const condition of conditions) {
    for (let j = 0; j < 10; j++) {
      const format = formats[j] ?? "ean13";
      const seedNum = 1000 + index * 17;
      let code: string;
      if (format === "ean8") {
        code = buildValidCode(`9638${String(seedNum).slice(-3)}`);
      } else if (format === "upca") {
        code = buildValidCode(`03600029${String(seedNum).slice(-3)}`);
      } else {
        code = buildValidCode(`400638133${String(seedNum).slice(-3)}`);
      }
      assert.ok(isValidCode(code, format));
      const rotate90 = condition === "small_damaged" && j % 2 === 0;
      clips.push(
        buildMultiFrameClip(
          `seq-${condition}-${String(j + 1).padStart(2, "0")}`,
          code,
          format,
          condition,
          rotate90,
        ),
      );
      index++;
    }
  }

  return clips;
}

test("loadLocalZxingWasmBinary loads and caches local WASM binary in Node", async () => {
  const first = await loadLocalZxingWasmBinary();
  const second = await loadLocalZxingWasmBinary();
  assert.ok(first instanceof Uint8Array);
  assert.ok(first.byteLength > 100_000);
  assert.equal(first, second);
  // WASM magic bytes: \0asm
  assert.equal(first[0], 0x00);
  assert.equal(first[1], 0x61);
  assert.equal(first[2], 0x73);
  assert.equal(first[3], 0x6d);
});

test("ZxingWasmAdapter decodes rendered EAN-13, UPC-A, and EAN-8 frames across conditions", async () => {
  const adapter = new ZxingWasmAdapter();
  await adapter.init();

  try {
    assert.match(adapter.engineVersion, /^zxing-wasm@3\.1\.7 \(zxing-cpp@/);

    const samples: ReadonlyArray<{
      readonly code: string;
      readonly format: BarcodeFormat;
      readonly condition: BenchmarkCondition;
      readonly rotate90: boolean;
    }> = [
      { code: "4006381333931", format: "ean13", condition: "normal", rotate90: false },
      { code: "036000291452", format: "upca", condition: "normal", rotate90: false },
      { code: "96385074", format: "ean8", condition: "normal", rotate90: false },
      { code: "4006381333931", format: "ean13", condition: "low_light", rotate90: false },
      { code: "036000291452", format: "upca", condition: "glare_curved", rotate90: false },
      { code: "96385074", format: "ean8", condition: "small_damaged", rotate90: true },
      { code: "4006381333931", format: "ean13", condition: "small_damaged", rotate90: true },
    ];

    for (const sample of samples) {
      const longSide = sample.format === "ean8" ? 280 : 340;
      const shortSide = 180;
      const frame = renderLinearBarcodeFrame(sample.code, sample.format, {
        width: sample.rotate90 ? shortSide : longSide,
        height: sample.rotate90 ? longSide : shortSide,
        condition: sample.condition,
        rotate90: sample.rotate90,
      });
      const result = await adapter.decodeFrame(frame);
      assert.ok(
        result !== null,
        `Expected decode for ${sample.format} (${sample.condition}, rotate90=${sample.rotate90})`,
      );
      assert.equal(
        canonicalValue(result.rawValue, result.format),
        canonicalValue(sample.code, sample.format),
      );
      assert.equal(result.bounds?.length, 4);
    }

    // Verify 4-channel RGBA input path as well.
    const gray = renderLinearBarcodeFrame("4006381333931", "ean13", {
      condition: "normal",
    });
    const rgbaResult = await adapter.decodeFrame(makeRgbaFrame(gray));
    assert.ok(rgbaResult !== null);
    assert.equal(rgbaResult.rawValue, "4006381333931");
    assert.equal(rgbaResult.format, "ean13");
  } finally {
    await adapter.dispose();
  }
});

test("ZxingWasmAdapter rejects remote CDN wasmUrl, oversized frames, and post-dispose calls", async () => {
  const cdnAdapter = new ZxingWasmAdapter({
    wasmUrl: "https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.7/dist/reader/zxing_reader.wasm",
  });
  await assert.rejects(
    () => cdnAdapter.init(),
    /Remote WASM CDN URLs are forbidden; serve zxing_reader\.wasm locally/,
  );

  const protocolRelativeAdapter = new ZxingWasmAdapter({
    wasmUrl: "//cdn.example.com/zxing_reader.wasm",
  });
  await assert.rejects(
    () => protocolRelativeAdapter.init(),
    /Remote WASM CDN URLs are forbidden; serve zxing_reader\.wasm locally/,
  );

  const adapter = new ZxingWasmAdapter({
    wasmBinary: (await loadLocalZxingWasmBinary()).slice().buffer,
  });
  await adapter.init();

  // Verify browser location origin enforcement for wasmUrl.
  const originalLocationDesc = Object.getOwnPropertyDescriptor(
    globalThis,
    "location",
  );
  try {
    Object.defineProperty(globalThis, "location", {
      value: { origin: "https://scanner.local" },
      configurable: true,
    });

    const crossOriginAdapter = new ZxingWasmAdapter({
      wasmUrl: "https://cdn.example.com/zxing_reader.wasm",
    });
    await assert.rejects(
      () => crossOriginAdapter.init(),
      /Remote WASM CDN URLs are forbidden; serve zxing_reader\.wasm locally/,
    );
  } finally {
    if (originalLocationDesc !== undefined) {
      Object.defineProperty(globalThis, "location", originalLocationDesc);
    } else {
      delete (globalThis as { location?: unknown }).location;
    }
  }

  const oversizedFrame: ReplayFrame = {
    timestampMs: 0,
    width: 4097,
    height: 100,
    data: new Uint8Array(100),
  };
  await assert.rejects(() => adapter.decodeFrame(oversizedFrame), RangeError);

  const mismatchedFrame: ReplayFrame = {
    timestampMs: 0,
    width: 100,
    height: 100,
    data: new Uint8Array(1234),
  };
  await assert.rejects(() => adapter.decodeFrame(mismatchedFrame), RangeError);

  await adapter.dispose();
  const validFrame = renderLinearBarcodeFrame("4006381333931", "ean13");
  await assert.rejects(
    () => adapter.decodeFrame(validFrame),
    /not initialized/i,
  );
});

test("ablation and 40-product replay benchmark: tuned zxing-wasm outperforms baseline single-pass with 0 wrong-valid", async () => {
  const clips = buildPhase0CorpusClips();
  assert.equal(clips.length, 40);

  const baselineAdapter = new ZxingWasmAdapter({
    configurationId: "safeeat-baseline-single-pass",
    tryHarder: false,
    tryRotate: false,
    tryInvert: false,
    tryDownscale: false,
  });

  const noRotateAblationAdapter = new ZxingWasmAdapter({
    configurationId: "zxing-ablation-no-tryRotate",
    tryHarder: true,
    tryRotate: false,
    tryInvert: false,
    tryDownscale: true,
  });

  const noHarderAblationAdapter = new ZxingWasmAdapter({
    configurationId: "zxing-ablation-no-tryHarder",
    tryHarder: false,
    tryRotate: true,
    tryInvert: false,
    tryDownscale: true,
  });

  const tunedAdapter = new ZxingWasmAdapter({
    configurationId: "zxing-tuned-th1-tr1-ti0",
    tryHarder: true,
    tryRotate: true,
    tryInvert: false,
    tryDownscale: true,
  });

  const invertAblationAdapter = new ZxingWasmAdapter({
    configurationId: "zxing-ablation-th1-tr1-ti1",
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
  });

  const runs = await runReplayBenchmark(
    clips,
    [
      baselineAdapter,
      noRotateAblationAdapter,
      noHarderAblationAdapter,
      tunedAdapter,
      invertAblationAdapter,
    ],
    {
      protocolVersion: "v1.0.0-lite",
      corpusVersion: "phase0-deterministic-v1",
      seed: 20261118,
    },
  );

  const report = aggregateBenchmarkResults(runs);
  const baselineMetrics =
    report.byConfiguration["zxing-wasm@safeeat-baseline-single-pass"];
  const noRotateMetrics =
    report.byConfiguration["zxing-wasm@zxing-ablation-no-tryRotate"];
  const noHarderMetrics =
    report.byConfiguration["zxing-wasm@zxing-ablation-no-tryHarder"];
  const tunedMetrics =
    report.byConfiguration["zxing-wasm@zxing-tuned-th1-tr1-ti0"];
  const invertMetrics =
    report.byConfiguration["zxing-wasm@zxing-ablation-th1-tr1-ti1"];

  assert.ok(baselineMetrics !== undefined);
  assert.ok(noRotateMetrics !== undefined);
  assert.ok(noHarderMetrics !== undefined);
  assert.ok(tunedMetrics !== undefined);
  assert.ok(invertMetrics !== undefined);

  assert.equal(baselineMetrics.totalTrials, 40);
  assert.equal(noRotateMetrics.totalTrials, 40);
  assert.equal(noHarderMetrics.totalTrials, 40);
  assert.equal(tunedMetrics.totalTrials, 40);
  assert.equal(invertMetrics.totalTrials, 40);

  assert.equal(baselineMetrics.wrongValidCount, 0);
  assert.equal(noRotateMetrics.wrongValidCount, 0);
  assert.equal(noHarderMetrics.wrongValidCount, 0);
  assert.equal(tunedMetrics.wrongValidCount, 0);
  assert.equal(invertMetrics.wrongValidCount, 0);

  // Tuned must beat baseline single-pass and no-rotate ablation by well over +10 pp.
  const gain = tunedMetrics.correctWithin3s.rate - baselineMetrics.correctWithin3s.rate;
  assert.ok(
    gain >= 0.1,
    `Expected >= 0.10 gain, got baseline=${baselineMetrics.correctWithin3s.rate}, tuned=${tunedMetrics.correctWithin3s.rate}`,
  );
  assert.ok(tunedMetrics.correctWithin3s.rate > noRotateMetrics.correctWithin3s.rate);
  assert.equal(tunedMetrics.correctWithin3s.rate, 1);
  assert.equal(noHarderMetrics.correctWithin3s.rate, 1);

  // tryInvert: false matches tryInvert: true on standard dark-on-light retail prints.
  assert.equal(
    invertMetrics.correctWithin3s.rate,
    tunedMetrics.correctWithin3s.rate,
  );

  // Also print structured privacy-safe summary for Phase 0 reporting verification.
  const stress = runSyntheticWrongCodeStressTest({ frameCount: 100_000 });
  assert.equal(stress.wrongValidAccepted, 0);
  assert.ok(stress.ruleOfThree95UpperBound <= 0.00003);

  assert.ok(ZXING_ENGINE_VERSION.includes("3.1.7"));
});
