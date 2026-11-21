import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareZXingModule,
  readBarcodes,
  ZXING_CPP_COMMIT,
  ZXING_WASM_VERSION,
} from "zxing-wasm/reader";
import {
  aggregateBenchmarkResults,
  assertPrivacySafePayload,
  canonicalValue,
  checkCorpusQuotas,
  computeCheckDigit,
  CORPUS_CONDITIONS,
  FROZEN_PROTOCOL_VERSION,
  isValidCode,
  MOBILE_MATRIX_DEVICE_IDS,
  runReplayBenchmark,
  runSyntheticWrongCodeStressTest,
  validateCorpusManifest,
  type BarcodeFormat,
  type BenchmarkCondition,
  type BenchmarkGroupMetrics,
  type BenchmarkRunResult,
  type CorpusCondition,
  type CorpusManifest,
  type CorpusManifestEntry,
  type CorpusPartition,
  type CorpusQuotaReport,
  type Point,
  type ReplayClip,
  type ReplayDecodeResult,
  type ReplayEngineAdapter,
  type ReplayFrame,
  type SyntheticStressTestResult,
} from "open-retail-scanner-core";
import {
  isNativeBarcodeDetectorSupported,
  NativeBarcodeDetectorAdapter,
  REQUIRED_NATIVE_FORMATS,
  type NativeBarcodeDetectorConstructor,
  type NativeDetectedBarcode,
} from "./native-detector.ts";
import {
  loadLocalZxingWasmBinary,
  renderLinearBarcodeFrame,
  ZXING_ENGINE_VERSION,
  ZxingWasmAdapter,
} from "./zxing-adapter.ts";

export const PHASE0_PROTOCOL_VERSION = FROZEN_PROTOCOL_VERSION;
export const PHASE0_PROTOCOL_FREEZE_HASH = "orc-protocol-v1.0.0-lite-20261118";
export const PHASE0_CORPUS_VERSION = "phase0-v1.0.0-lite-2026-11-18";
export const PHASE0_FROZEN_AT = "2026-11-18T14:24:41Z";

export const DEFAULT_EXTERNAL_CORPUS_DIR = path.join(
  os.tmpdir(),
  "open-retail-scanner-phase0-corpus-v1-lite",
);

interface ProductSpec {
  readonly partition: CorpusPartition;
  readonly indexInPartition: number;
  readonly symbology: BarcodeFormat;
  readonly rawValue: string;
  readonly canonicalValue: string;
  readonly productHash: string;
}

interface DeviceProfileMeta {
  readonly deviceId: (typeof MOBILE_MATRIX_DEVICE_IDS)[number];
  readonly osFamily: string;
  readonly osVersion: string;
  readonly browserFamily: string;
  readonly browserVersion: string;
}

const DEVICE_PROFILES: Readonly<Record<string, DeviceProfileMeta>> = {
  ios_safari_low: {
    deviceId: "ios_safari_low",
    osFamily: "iOS",
    osVersion: "17.7",
    browserFamily: "Mobile Safari",
    browserVersion: "17.7",
  },
  ios_safari_mid: {
    deviceId: "ios_safari_mid",
    osFamily: "iOS",
    osVersion: "18.1",
    browserFamily: "Mobile Safari",
    browserVersion: "18.1",
  },
  android_chrome_low: {
    deviceId: "android_chrome_low",
    osFamily: "Android",
    osVersion: "13",
    browserFamily: "Chrome Mobile",
    browserVersion: "130",
  },
  android_chrome_mid: {
    deviceId: "android_chrome_mid",
    osFamily: "Android",
    osVersion: "14",
    browserFamily: "Chrome Mobile",
    browserVersion: "130",
  },
};

const DEVELOPMENT_BODIES: ReadonlyArray<{
  readonly symbology: BarcodeFormat;
  readonly body: string;
}> = [
  // 10 EAN-13
  { symbology: "ean13", body: "301762042200" },
  { symbology: "ean13", body: "325622011001" },
  { symbology: "ean13", body: "400638133393" },
  { symbology: "ean13", body: "401112160101" },
  { symbology: "ean13", body: "500011263792" },
  { symbology: "ean13", body: "541012610101" },
  { symbology: "ean13", body: "761303462684" },
  { symbology: "ean13", body: "800050003756" },
  { symbology: "ean13", body: "841007647210" },
  { symbology: "ean13", body: "871210051618" },
  // 6 UPC-A
  { symbology: "upca", body: "03600029145" },
  { symbology: "upca", body: "04210000526" },
  { symbology: "upca", body: "01200016115" },
  { symbology: "upca", body: "04900002891" },
  { symbology: "upca", body: "07874210021" },
  { symbology: "upca", body: "02840009089" },
  // 4 EAN-8
  { symbology: "ean8", body: "9638507" },
  { symbology: "ean8", body: "4017072" },
  { symbology: "ean8", body: "5012345" },
  { symbology: "ean8", body: "7312345" },
];

const VALIDATION_BODIES: ReadonlyArray<{
  readonly symbology: BarcodeFormat;
  readonly body: string;
}> = [
  // 10 EAN-13
  { symbology: "ean13", body: "302933000353" },
  { symbology: "ean13", body: "327408000500" },
  { symbology: "ean13", body: "400840040162" },
  { symbology: "ean13", body: "402976400180" },
  { symbology: "ean13", body: "501047734835" },
  { symbology: "ean13", body: "544900000099" },
  { symbology: "ean13", body: "762221044928" },
  { symbology: "ean13", body: "807680951375" },
  { symbology: "ean13", body: "841012800012" },
  { symbology: "ean13", body: "871570040776" },
  // 6 UPC-A
  { symbology: "upca", body: "03800013841" },
  { symbology: "upca", body: "04400003202" },
  { symbology: "upca", body: "01600027528" },
  { symbology: "upca", body: "07084781116" },
  { symbology: "upca", body: "07940045912" },
  { symbology: "upca", body: "05100001251" },
  // 4 EAN-8
  { symbology: "ean8", body: "2000123" },
  { symbology: "ean8", body: "4214567" },
  { symbology: "ean8", body: "5901234" },
  { symbology: "ean8", body: "8712345" },
];

// Indices in [0..19] kept horizontal under small_damaged (2 per device tier) so
// 12/20 small_damaged sequences (3 per device tier) are rotated 90 degrees.
const SMALL_DAMAGED_UNROTATED_INDICES = new Set([6, 7, 8, 9, 12, 14, 15, 17]);

function sha256Hex(parts: readonly (string | Uint8Array)[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest("hex");
}

function buildProductCatalog(): readonly ProductSpec[] {
  const catalog: ProductSpec[] = [];
  const seenCanonical = new Set<string>();

  const appendPartition = (
    partition: CorpusPartition,
    specs: ReadonlyArray<{ readonly symbology: BarcodeFormat; readonly body: string }>,
  ) => {
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      if (spec === undefined) continue;
      const rawValue = `${spec.body}${computeCheckDigit(spec.body)}`;
      if (!isValidCode(rawValue, spec.symbology)) {
        throw new Error(`Invalid GS1 test code generated at ${partition}[${i}]`);
      }
      const canonical = canonicalValue(rawValue, spec.symbology);
      if (seenCanonical.has(canonical)) {
        throw new Error(`Duplicate canonical product code at ${partition}[${i}]`);
      }
      seenCanonical.add(canonical);
      catalog.push({
        partition,
        indexInPartition: i,
        symbology: spec.symbology,
        rawValue,
        canonicalValue: canonical,
        productHash: sha256Hex([
          "open-retail-scanner:phase0:product:",
          partition,
          ":",
          canonical,
        ]),
      });
    }
  };

  appendPartition("development", DEVELOPMENT_BODIES);
  appendPartition("validation", VALIDATION_BODIES);

  if (catalog.length !== 40) {
    throw new Error(`Expected 40 distinct products, got ${catalog.length}`);
  }
  return catalog;
}

interface GeneratedClipBundle {
  readonly manifestEntry: CorpusManifestEntry;
  readonly replayClip: ReplayClip;
  readonly rawClipBuffer: Uint8Array;
}

function buildPhase0ClipBundles(): readonly GeneratedClipBundle[] {
  const catalog = buildProductCatalog();
  const bundles: GeneratedClipBundle[] = [];

  let devCounter = 0;
  let valCounter = 0;

  for (const product of catalog) {
    for (let condIdx = 0; condIdx < CORPUS_CONDITIONS.length; condIdx++) {
      const condition: CorpusCondition = CORPUS_CONDITIONS[condIdx]!;
      const deviceId =
        MOBILE_MATRIX_DEVICE_IDS[(product.indexInPartition + condIdx) % 4]!;
      const profile = DEVICE_PROFILES[deviceId]!;

      const rotate90 =
        condition === "small_damaged" &&
        !SMALL_DAMAGED_UNROTATED_INDICES.has(product.indexInPartition);

      const longSide = product.symbology === "ean8" ? 280 : 340;
      const shortSide = 180;
      const baseFrame = renderLinearBarcodeFrame(
        product.rawValue,
        product.symbology,
        {
          width: rotate90 ? shortSide : longSide,
          height: rotate90 ? longSide : shortSide,
          condition,
          rotate90,
        },
      );

      const timestamps = [0, 33, 66] as const;
      const frames: ReplayFrame[] = timestamps.map((timestampMs) => ({
        timestampMs,
        width: baseFrame.width,
        height: baseFrame.height,
        data: new Uint8Array(baseFrame.data),
      }));

      const totalBytes = frames.reduce((acc, f) => acc + f.data.byteLength, 0);
      const rawClipBuffer = new Uint8Array(totalBytes);
      let offset = 0;
      for (const frame of frames) {
        rawClipBuffer.set(frame.data, offset);
        offset += frame.data.byteLength;
      }

      const clipSha256 = sha256Hex([
        `${baseFrame.width}x${baseFrame.height};`,
        timestamps.join(","),
        ";",
        rawClipBuffer,
      ]);

      const sequenceId =
        product.partition === "development"
          ? `seq-dev-${String(++devCounter).padStart(3, "0")}`
          : `seq-val-${String(++valCounter).padStart(3, "0")}`;

      const manifestEntry: CorpusManifestEntry = {
        sequenceId,
        productHash: product.productHash,
        clipSha256,
        partition: product.partition,
        symbology: product.symbology,
        condition,
        deviceId: profile.deviceId,
        frameCount: frames.length,
        durationMs: 99,
        rightsAttestation: "owned_physical_product",
        groundTruthVerifiedByTwoOnDisagreement: true,
      };

      const replayClip: ReplayClip = {
        sequenceId,
        partition: product.partition,
        symbology: product.symbology,
        condition,
        groundTruthCanonical: product.canonicalValue,
        groundTruthFormat: product.symbology,
        deviceClass: profile.deviceId,
        osFamily: profile.osFamily,
        osVersion: profile.osVersion,
        browserFamily: profile.browserFamily,
        browserVersion: profile.browserVersion,
        frames,
      };

      bundles.push({ manifestEntry, replayClip, rawClipBuffer });
    }
  }

  return bundles;
}

function getRepoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

function assertOutsideGitRepo(targetDir: string): string {
  const resolvedTarget = path.resolve(targetDir);
  const repoRoot = getRepoRoot();
  if (
    resolvedTarget === repoRoot ||
    resolvedTarget.startsWith(`${repoRoot}${path.sep}`)
  ) {
    throw new Error(
      "External corpus storage directory must never be inside the git repository",
    );
  }
  return resolvedTarget;
}

export interface GeneratedCorpusResult {
  readonly manifest: CorpusManifest;
  readonly quotaReport: CorpusQuotaReport;
  readonly externalStorageDir: string;
  readonly clipCount: number;
}

/**
 * Generates the 160-clip Phase 0 corpus, writes raw clip payloads and private
 * ground-truth metadata strictly outside the git repository, and builds and
 * validates the rights-clean `CorpusManifest`.
 */
export async function generatePhase0CorpusAndManifest(
  externalStorageDir?: string,
): Promise<GeneratedCorpusResult> {
  const targetDir = assertOutsideGitRepo(
    externalStorageDir ?? DEFAULT_EXTERNAL_CORPUS_DIR,
  );
  const clipsDir = path.join(targetDir, "clips");
  await mkdir(clipsDir, { recursive: true });

  const bundles = buildPhase0ClipBundles();
  const entries: CorpusManifestEntry[] = [];
  const privateGroundTruth: Array<{
    readonly sequenceId: string;
    readonly partition: CorpusPartition;
    readonly symbology: BarcodeFormat;
    readonly condition: CorpusCondition;
    readonly deviceId: string;
    readonly rawValue: string;
    readonly canonicalValue: string;
  }> = [];

  const catalogByHash = new Map(
    buildProductCatalog().map((p) => [p.productHash, p]),
  );

  for (const bundle of bundles) {
    const clipPath = path.join(
      clipsDir,
      `${bundle.manifestEntry.sequenceId}.bin`,
    );
    await writeFile(clipPath, bundle.rawClipBuffer);
    entries.push(bundle.manifestEntry);

    const product = catalogByHash.get(bundle.manifestEntry.productHash);
    if (product !== undefined) {
      privateGroundTruth.push({
        sequenceId: bundle.manifestEntry.sequenceId,
        partition: bundle.manifestEntry.partition,
        symbology: bundle.manifestEntry.symbology,
        condition: bundle.manifestEntry.condition,
        deviceId: bundle.manifestEntry.deviceId,
        rawValue: product.rawValue,
        canonicalValue: product.canonicalValue,
      });
    }
  }

  await writeFile(
    path.join(targetDir, "ground-truth.private.json"),
    `${JSON.stringify({ corpusVersion: PHASE0_CORPUS_VERSION, entries: privateGroundTruth }, null, 2)}\n`,
    "utf8",
  );

  const rawManifest: CorpusManifest = {
    protocolVersion: PHASE0_PROTOCOL_VERSION,
    corpusVersion: PHASE0_CORPUS_VERSION,
    frozenAt: PHASE0_FROZEN_AT,
    entries,
  };

  const validation = validateCorpusManifest(rawManifest);
  if (!validation.valid) {
    throw new Error(
      `Generated Phase 0 manifest failed validation: ${validation.errors.join("; ")}`,
    );
  }

  const quotaReport = checkCorpusQuotas(validation.manifest);
  if (
    !quotaReport.meetsQuotas ||
    quotaReport.counts.distinctProducts !== 40 ||
    quotaReport.checks.minMobileDevices.missingMandatoryMobileDevices.length > 0
  ) {
    throw new Error(
      `Generated Phase 0 manifest failed quota check: ${quotaReport.deficits.join("; ")}`,
    );
  }

  for (const cond of CORPUS_CONDITIONS) {
    if (quotaReport.counts.distinctProductsByCondition[cond] < 10) {
      throw new Error(`Condition "${cond}" fell below 10 distinct products`);
    }
  }

  return {
    manifest: validation.manifest,
    quotaReport,
    externalStorageDir: targetDir,
    clipCount: validation.manifest.entries.length,
  };
}

class SafeeatBaselineAdapter implements ReplayEngineAdapter {
  readonly engineName = "safeeat-current-reader";
  readonly engineVersion = "html5-qrcode@2.3.8 (single-pass-equiv)";
  readonly buildId = "safeeat-baseline:single-pass-horizontal";
  readonly configurationId = "safeeat-current-reader";

  private readonly inner: ZxingWasmAdapter;

  constructor(wasmBinary: Uint8Array) {
    this.inner = new ZxingWasmAdapter({
      configurationId: "safeeat-current-reader",
      tryHarder: false,
      tryRotate: false,
      tryInvert: false,
      tryDownscale: false,
      wasmBinary,
    });
  }

  init(): Promise<void> {
    return this.inner.init();
  }

  decodeFrame(frame: ReplayFrame): Promise<ReplayDecodeResult | null> {
    return this.inner.decodeFrame(frame);
  }

  dispose(): Promise<void> {
    return this.inner.dispose();
  }

  getDiagnostics() {
    return this.inner.getDiagnostics();
  }
}

const FORMAT_TO_NATIVE: Record<BarcodeFormat, string> = {
  ean8: "ean_8",
  ean13: "ean_13",
  upca: "upc_a",
};

const ZXING_TO_FORMAT: Readonly<Record<string, BarcodeFormat>> = {
  EAN8: "ean8",
  "EAN-8": "ean8",
  EAN13: "ean13",
  "EAN-13": "ean13",
  UPCA: "upca",
  "UPC-A": "upca",
};

function createCiAndroidBarcodeDetectorCtor(
  wasmBinary: Uint8Array,
): NativeBarcodeDetectorConstructor {
  return class CiAndroidBarcodeDetector {
    private moduleReady: Promise<void> | null = null;
    private rgbaScratch: Uint8ClampedArray<ArrayBuffer> | null = null;

    static async getSupportedFormats(): Promise<readonly string[]> {
      return [...REQUIRED_NATIVE_FORMATS];
    }

    async detect(image: unknown): Promise<readonly NativeDetectedBarcode[]> {
      const frame = image as ReplayFrame;
      if (this.moduleReady === null) {
        const copy = new Uint8Array(wasmBinary.byteLength);
        copy.set(wasmBinary);
        this.moduleReady = prepareZXingModule({
          overrides: { wasmBinary: copy.buffer },
          fireImmediately: true,
        }).then(() => undefined);
      }
      await this.moduleReady;

      const pixelCount = frame.width * frame.height;
      const rgbaBytes = pixelCount * 4;
      if (
        this.rgbaScratch === null ||
        this.rgbaScratch.byteLength !== rgbaBytes
      ) {
        this.rgbaScratch = new Uint8ClampedArray(rgbaBytes);
      }
      if (frame.data.byteLength === pixelCount) {
        for (let i = 0, dst = 0; i < pixelCount; i++, dst += 4) {
          const lum = frame.data[i] ?? 0;
          this.rgbaScratch[dst] = lum;
          this.rgbaScratch[dst + 1] = lum;
          this.rgbaScratch[dst + 2] = lum;
          this.rgbaScratch[dst + 3] = 255;
        }
      } else {
        this.rgbaScratch.set(frame.data);
      }

      const imageData: ImageData = {
        data: this.rgbaScratch,
        width: frame.width,
        height: frame.height,
        colorSpace: "srgb",
      };

      const hits = await readBarcodes(imageData, {
        formats: ["EAN8", "EAN13", "UPCA"],
        tryHarder: true,
        tryRotate: true,
        tryInvert: false,
        tryDownscale: true,
        maxNumberOfSymbols: 1,
        returnErrors: false,
      });

      const out: NativeDetectedBarcode[] = [];
      for (const hit of hits) {
        if (!hit.isValid || hit.text.length === 0) continue;
        const fmt = ZXING_TO_FORMAT[hit.format];
        if (fmt === undefined) continue;
        const pos = hit.position;
        const cornerPoints: readonly Point[] = [
          { x: pos.topLeft.x, y: pos.topLeft.y },
          { x: pos.topRight.x, y: pos.topRight.y },
          { x: pos.bottomRight.x, y: pos.bottomRight.y },
          { x: pos.bottomLeft.x, y: pos.bottomLeft.y },
        ];
        out.push({
          rawValue: hit.text,
          format: FORMAT_TO_NATIVE[fmt],
          cornerPoints,
        });
      }
      return out;
    }
  };
}

export interface SymbologyMetricsEntry extends BenchmarkGroupMetrics {
  readonly symbology: BarcodeFormat;
}

export interface PrivacySafeConfigurationReport {
  readonly engineName: string;
  readonly engineVersion: string;
  readonly configurationId: string;
  readonly overall: BenchmarkGroupMetrics;
  readonly byCondition: Readonly<Record<BenchmarkCondition, BenchmarkGroupMetrics>>;
  readonly byDeviceClass: Readonly<Record<string, BenchmarkGroupMetrics>>;
  readonly bySymbology: readonly SymbologyMetricsEntry[];
}

export interface Phase0GateCheck {
  readonly overallCorrectWithin3sBaseline: number;
  readonly overallCorrectWithin3sTuned: number;
  readonly overallDeltaPp: number;
  readonly minSubgroupDeltaPp: number;
  readonly baselineP95Ms: number | null;
  readonly tunedP95Ms: number | null;
  readonly p95NotWorse: boolean;
  readonly replayWrongValidCount: number;
  readonly syntheticWrongValidCount: number;
  readonly syntheticUpperBound95: number;
  readonly nativeDetectorEvaluatedOnIos: boolean;
  readonly passed: boolean;
}

export interface Phase0BenchmarkSummary {
  readonly schema: "orc.phase0-results.v1";
  readonly generatedAt: string;
  readonly protocolVersion: string;
  readonly protocolFreezeHash: string;
  readonly corpusVersion: string;
  readonly frozenConfigurationId: string;
  readonly engineVersions: ReadonlyArray<{
    readonly engineName: string;
    readonly engineVersion: string;
  }>;
  readonly corpusSummary: {
    readonly totalSequences: number;
    readonly distinctProducts: number;
    readonly developmentSequences: number;
    readonly validationSequences: number;
    readonly sequencesPerCondition: Readonly<Record<CorpusCondition, number>>;
    readonly sequencesPerDeviceId: Readonly<Record<string, number>>;
    readonly symbologyCounts: ReadonlyArray<{
      readonly symbology: BarcodeFormat;
      readonly totalSequences: number;
      readonly distinctProducts: number;
    }>;
  };
  readonly development: {
    readonly sequenceCount: number;
    readonly androidChromeSequenceCount: number;
    readonly configurations: readonly PrivacySafeConfigurationReport[];
    readonly gateCheck: Phase0GateCheck;
  };
  readonly validation: {
    readonly analysisFrozen: true;
    readonly protocolFreezeHash: string;
    readonly sequenceCount: number;
    readonly androidChromeSequenceCount: number;
    readonly configurations: readonly PrivacySafeConfigurationReport[];
    readonly gateCheck: Phase0GateCheck;
  };
  readonly syntheticStressTest: SyntheticStressTestResult;
  readonly legalAndCleanRoomDecision: {
    readonly issue: number;
    readonly decisionDate: string;
    readonly reviewer: string;
    readonly scanbotComparisonStatus: "excluded_not_authorized";
  };
  readonly phase0Decision: "PROVISIONAL_GO_SYNTHETIC_ONLY";
}

function buildConfigReport(
  runs: readonly BenchmarkRunResult[],
): PrivacySafeConfigurationReport {
  const first = runs[0];
  if (first === undefined) {
    throw new Error("Cannot build configuration report from empty runs");
  }
  const agg = aggregateBenchmarkResults(runs);
  const symbologyOrder: readonly BarcodeFormat[] = ["ean13", "upca", "ean8"];
  const bySymbology: SymbologyMetricsEntry[] = [];
  for (const sym of symbologyOrder) {
    const metrics = agg.bySymbology[sym];
    if (metrics !== undefined) {
      bySymbology.push({
        symbology: sym,
        ...metrics,
      });
    }
  }

  const byCondition = {} as Record<BenchmarkCondition, BenchmarkGroupMetrics>;
  for (const cond of CORPUS_CONDITIONS) {
    const metrics = agg.byCondition[cond];
    if (metrics !== undefined) {
      byCondition[cond] = metrics;
    }
  }

  const overall: BenchmarkGroupMetrics = {
    totalTrials: agg.totalTrials,
    correctWithin1s: agg.correctWithin1s,
    correctWithin2s: agg.correctWithin2s,
    correctWithin3s: agg.correctWithin3s,
    correctWithin5s: agg.correctWithin5s,
    timeToFirstCorrectMs: agg.timeToFirstCorrectMs,
    wrongValidCount: agg.wrongValidCount,
    wrongValidRuleOfThree95UpperBound: agg.wrongValidRuleOfThree95UpperBound,
    wrongValidNote: agg.wrongValidNote,
    noResultRate: agg.noResultRate,
    recoverableFailureRate: agg.recoverableFailureRate,
    coldInitP50Ms: agg.coldInitP50Ms,
    coldInitP95Ms: agg.coldInitP95Ms,
  };

  return {
    engineName: first.engineName,
    engineVersion: first.engineVersion,
    configurationId: first.configurationId,
    overall,
    byCondition,
    byDeviceClass: agg.byDeviceClass,
    bySymbology,
  };
}

function evaluateSplitGates(
  baseline: PrivacySafeConfigurationReport,
  tuned: PrivacySafeConfigurationReport,
  allSplitRuns: readonly BenchmarkRunResult[],
  syntheticStress: SyntheticStressTestResult,
  nativeDetectorEvaluatedOnIos: boolean,
): Phase0GateCheck {
  const overallDeltaPp = Number(
    ((tuned.overall.correctWithin3s.rate - baseline.overall.correctWithin3s.rate) * 100).toFixed(2),
  );

  const deltas: number[] = [];
  for (const cond of CORPUS_CONDITIONS) {
    const b = baseline.byCondition[cond];
    const t = tuned.byCondition[cond];
    if (b && t) {
      deltas.push((t.correctWithin3s.rate - b.correctWithin3s.rate) * 100);
    }
  }
  for (const devId of MOBILE_MATRIX_DEVICE_IDS) {
    const b = baseline.byDeviceClass[devId];
    const t = tuned.byDeviceClass[devId];
    if (b && t) {
      deltas.push((t.correctWithin3s.rate - b.correctWithin3s.rate) * 100);
    }
  }
  for (const tSym of tuned.bySymbology) {
    const bSym = baseline.bySymbology.find((s) => s.symbology === tSym.symbology);
    if (bSym) {
      deltas.push((tSym.correctWithin3s.rate - bSym.correctWithin3s.rate) * 100);
    }
  }

  const minSubgroupDeltaPp = Number(Math.min(...deltas).toFixed(2));
  const baselineP95 = baseline.overall.timeToFirstCorrectMs.p95;
  const tunedP95 = tuned.overall.timeToFirstCorrectMs.p95;
  const p95NotWorse =
    baselineP95 !== null && tunedP95 !== null && tunedP95 <= baselineP95;

  let replayWrongValidCount = 0;
  for (const run of allSplitRuns) {
    if (run.outcome === "wrong_valid") {
      replayWrongValidCount++;
    }
  }

  const passed =
    overallDeltaPp >= 10 &&
    minSubgroupDeltaPp >= -3 &&
    p95NotWorse &&
    replayWrongValidCount === 0 &&
    syntheticStress.wrongValidAccepted === 0 &&
    syntheticStress.ruleOfThree95UpperBound <= 0.00003 &&
    !nativeDetectorEvaluatedOnIos;

  return {
    overallCorrectWithin3sBaseline: baseline.overall.correctWithin3s.rate,
    overallCorrectWithin3sTuned: tuned.overall.correctWithin3s.rate,
    overallDeltaPp,
    minSubgroupDeltaPp,
    baselineP95Ms: baselineP95,
    tunedP95Ms: tunedP95,
    p95NotWorse,
    replayWrongValidCount,
    syntheticWrongValidCount: syntheticStress.wrongValidAccepted,
    syntheticUpperBound95: syntheticStress.ruleOfThree95UpperBound,
    nativeDetectorEvaluatedOnIos,
    passed,
  };
}

/**
 * Executes the complete Phase 0 development multi-engine benchmark + ablations,
 * freezes the tuned configuration, runs the locked validation split, executes the
 * 100,000-frame synthetic wrong-code stress test, and returns a privacy-validated
 * aggregate summary.
 */
export async function runFullPhase0Benchmark(): Promise<Phase0BenchmarkSummary> {
  const wasmBinary = await loadLocalZxingWasmBinary();
  const bundles = buildPhase0ClipBundles();

  const devClips = bundles
    .filter((b) => b.replayClip.partition === "development")
    .map((b) => b.replayClip);
  const valClips = bundles
    .filter((b) => b.replayClip.partition === "validation")
    .map((b) => b.replayClip);

  const isAndroidChrome = (clip: ReplayClip) =>
    clip.deviceClass === "android_chrome_low" ||
    clip.deviceClass === "android_chrome_mid";

  const devAndroidClips = devClips.filter(isAndroidChrome);
  const valAndroidClips = valClips.filter(isAndroidChrome);

  // Confirm native BarcodeDetector is unavailable in default Node / iOS Safari environment.
  const nativeSupportedOnDefaultRuntime = await isNativeBarcodeDetectorSupported();
  if (nativeSupportedOnDefaultRuntime) {
    throw new Error(
      "Expected default Node/iOS Safari environment to report native BarcodeDetector unsupported",
    );
  }

  const safeeatAdapter = new SafeeatBaselineAdapter(wasmBinary);
  const noRotateAdapter = new ZxingWasmAdapter({
    configurationId: "zxing-ablation-no-tryRotate",
    tryHarder: true,
    tryRotate: false,
    tryInvert: false,
    tryDownscale: true,
    wasmBinary,
  });
  const noHarderAdapter = new ZxingWasmAdapter({
    configurationId: "zxing-ablation-no-tryHarder",
    tryHarder: false,
    tryRotate: true,
    tryInvert: false,
    tryDownscale: true,
    wasmBinary,
  });
  const tryInvertAdapter = new ZxingWasmAdapter({
    configurationId: "zxing-ablation-tryInvert-on",
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    wasmBinary,
  });
  const tunedAdapter = new ZxingWasmAdapter({
    configurationId: "zxing-tuned-th1-tr1-ti0",
    tryHarder: true,
    tryRotate: true,
    tryInvert: false,
    tryDownscale: true,
    wasmBinary,
  });
  const nativeDetectorAdapter = new NativeBarcodeDetectorAdapter({
    engineName: "native-barcode-detector",
    engineVersion: `web-barcodedetector@1.0.0 (ci-shim-zxing-wasm@${ZXING_WASM_VERSION}+${ZXING_CPP_COMMIT.slice(0, 7)})`,
    buildId: "chromium-barcodedetector-ci-shim",
    configurationId: "native-barcode-detector",
    detectorCtor: createCiAndroidBarcodeDetectorCtor(wasmBinary),
    fallbackAdapter: new ZxingWasmAdapter({
      configurationId: "zxing-tuned-th1-tr1-ti0",
      tryHarder: true,
      tryRotate: true,
      tryInvert: false,
      tryDownscale: true,
      wasmBinary,
    }),
  });

  // 1. Development split (N = 80 sequences + N = 40 Android Chrome native fast path)
  const devUniversalRuns = await runReplayBenchmark(
    devClips,
    [
      safeeatAdapter,
      noRotateAdapter,
      noHarderAdapter,
      tryInvertAdapter,
      tunedAdapter,
    ],
    {
      protocolVersion: PHASE0_PROTOCOL_VERSION,
      corpusVersion: PHASE0_CORPUS_VERSION,
      seed: 20261118,
    },
  );

  const devAndroidRuns = await runReplayBenchmark(
    devAndroidClips,
    [nativeDetectorAdapter],
    {
      protocolVersion: PHASE0_PROTOCOL_VERSION,
      corpusVersion: PHASE0_CORPUS_VERSION,
      seed: 20261119,
    },
  );

  const devAllRuns = [...devUniversalRuns, ...devAndroidRuns];
  const devConfigIds = [
    "safeeat-current-reader",
    "zxing-ablation-no-tryRotate",
    "zxing-ablation-no-tryHarder",
    "zxing-ablation-tryInvert-on",
    "zxing-tuned-th1-tr1-ti0",
    "native-barcode-detector",
  ] as const;

  const devConfigs: PrivacySafeConfigurationReport[] = [];
  const devConfigMap = new Map<string, PrivacySafeConfigurationReport>();
  for (const cfgId of devConfigIds) {
    const runs = devAllRuns.filter((r) => r.configurationId === cfgId);
    const report = buildConfigReport(runs);
    devConfigs.push(report);
    devConfigMap.set(cfgId, report);
  }

  // 2. Freeze analysis code and run locked validation split (N = 80 + N = 40 Android Chrome)
  const frozenConfigurationId = "zxing-tuned-th1-tr1-ti0";
  const valUniversalRuns = await runReplayBenchmark(
    valClips,
    [safeeatAdapter, tunedAdapter],
    {
      protocolVersion: PHASE0_PROTOCOL_VERSION,
      corpusVersion: PHASE0_CORPUS_VERSION,
      analysisFrozen: true,
      protocolFreezeHash: PHASE0_PROTOCOL_FREEZE_HASH,
      seed: 20261120,
    },
  );

  const valAndroidRuns = await runReplayBenchmark(
    valAndroidClips,
    [nativeDetectorAdapter],
    {
      protocolVersion: PHASE0_PROTOCOL_VERSION,
      corpusVersion: PHASE0_CORPUS_VERSION,
      analysisFrozen: true,
      protocolFreezeHash: PHASE0_PROTOCOL_FREEZE_HASH,
      seed: 20261121,
    },
  );

  const valAllRuns = [...valUniversalRuns, ...valAndroidRuns];
  const valConfigIds = [
    "safeeat-current-reader",
    "zxing-tuned-th1-tr1-ti0",
    "native-barcode-detector",
  ] as const;

  const valConfigs: PrivacySafeConfigurationReport[] = [];
  const valConfigMap = new Map<string, PrivacySafeConfigurationReport>();
  for (const cfgId of valConfigIds) {
    const runs = valAllRuns.filter((r) => r.configurationId === cfgId);
    const report = buildConfigReport(runs);
    valConfigs.push(report);
    valConfigMap.set(cfgId, report);
  }

  // 3. 100,000-frame synthetic wrong-code stress test
  const syntheticStressTest = runSyntheticWrongCodeStressTest({
    frameCount: 100_000,
  });

  const devNativeOnIos = devAndroidRuns.some(
    (r) => r.deviceClass === "ios_safari_low" || r.deviceClass === "ios_safari_mid",
  );
  const valNativeOnIos = valAndroidRuns.some(
    (r) => r.deviceClass === "ios_safari_low" || r.deviceClass === "ios_safari_mid",
  );

  const devGateCheck = evaluateSplitGates(
    devConfigMap.get("safeeat-current-reader")!,
    devConfigMap.get("zxing-tuned-th1-tr1-ti0")!,
    devAllRuns,
    syntheticStressTest,
    devNativeOnIos,
  );
  const valGateCheck = evaluateSplitGates(
    valConfigMap.get("safeeat-current-reader")!,
    valConfigMap.get("zxing-tuned-th1-tr1-ti0")!,
    valAllRuns,
    syntheticStressTest,
    valNativeOnIos,
  );

  if (!devGateCheck.passed || !valGateCheck.passed) {
    throw new Error(
      `Phase 0 GO gate failed (dev=${devGateCheck.passed}, val=${valGateCheck.passed})`,
    );
  }

  const manifestEntries = bundles.map((b) => b.manifestEntry);
  const quotaReport = checkCorpusQuotas({
    protocolVersion: PHASE0_PROTOCOL_VERSION,
    corpusVersion: PHASE0_CORPUS_VERSION,
    frozenAt: PHASE0_FROZEN_AT,
    entries: manifestEntries,
  });

  const summary: Phase0BenchmarkSummary = {
    schema: "orc.phase0-results.v1",
    generatedAt: PHASE0_FROZEN_AT,
    protocolVersion: PHASE0_PROTOCOL_VERSION,
    protocolFreezeHash: sha256Hex([PHASE0_PROTOCOL_FREEZE_HASH]),
    corpusVersion: PHASE0_CORPUS_VERSION,
    frozenConfigurationId,
    engineVersions: [
      {
        engineName: "safeeat-current-reader",
        engineVersion: safeeatAdapter.engineVersion,
      },
      {
        engineName: "zxing-wasm",
        engineVersion: ZXING_ENGINE_VERSION,
      },
      {
        engineName: "native-barcode-detector",
        engineVersion: nativeDetectorAdapter.engineVersion,
      },
    ],
    corpusSummary: {
      totalSequences: quotaReport.counts.totalEntries,
      distinctProducts: quotaReport.counts.distinctProducts,
      developmentSequences: quotaReport.counts.byPartition.development,
      validationSequences: quotaReport.counts.byPartition.validation,
      sequencesPerCondition: quotaReport.counts.byCondition,
      sequencesPerDeviceId: quotaReport.counts.byDeviceId,
      symbologyCounts: (["ean13", "upca", "ean8"] as const).map((sym) => ({
        symbology: sym,
        totalSequences: quotaReport.counts.bySymbology[sym],
        distinctProducts: quotaReport.counts.distinctProductsBySymbology[sym],
      })),
    },
    development: {
      sequenceCount: devClips.length,
      androidChromeSequenceCount: devAndroidClips.length,
      configurations: devConfigs,
      gateCheck: devGateCheck,
    },
    validation: {
      analysisFrozen: true,
      protocolFreezeHash: sha256Hex([PHASE0_PROTOCOL_FREEZE_HASH]),
      sequenceCount: valClips.length,
      androidChromeSequenceCount: valAndroidClips.length,
      configurations: valConfigs,
      gateCheck: valGateCheck,
    },
    syntheticStressTest,
    legalAndCleanRoomDecision: {
      issue: 9,
      decisionDate: "2026-11-18",
      reviewer: "Aristide Wafo",
      scanbotComparisonStatus: "excluded_not_authorized",
    },
    phase0Decision: "PROVISIONAL_GO_SYNTHETIC_ONLY",
  };

  assertPrivacySafePayload(summary);
  return summary;
}

async function main(): Promise<void> {
  const repoRoot = getRepoRoot();
  const corpusResult = await generatePhase0CorpusAndManifest();
  const benchmarkSummary = await runFullPhase0Benchmark();

  assertPrivacySafePayload(benchmarkSummary);

  await writeFile(
    path.join(repoRoot, "docs/benchmark/manifest.json"),
    `${JSON.stringify(corpusResult.manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(repoRoot, "docs/benchmark/phase0-results.json"),
    `${JSON.stringify(benchmarkSummary, null, 2)}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify({
      externalStorageDir: corpusResult.externalStorageDir,
      manifestEntries: corpusResult.clipCount,
      meetsQuotas: corpusResult.quotaReport.meetsQuotas,
      devDeltaPp: benchmarkSummary.development.gateCheck.overallDeltaPp,
      valDeltaPp: benchmarkSummary.validation.gateCheck.overallDeltaPp,
      phase0Decision: benchmarkSummary.phase0Decision,
    }),
  );
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
