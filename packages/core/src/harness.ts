import { isValidCode } from "./checksum.ts";
import { ConsensusTracker, type ConsensusOptions } from "./consensus.ts";
import { wilsonScoreInterval, type WilsonInterval } from "./funnel.ts";
import type { BarcodeFormat, Point } from "./index.ts";
import { assertPrivacySafePayload, validateFrameBounds } from "./privacy.ts";

export type { WilsonInterval };

export type BenchmarkPartition = "development" | "validation";

export type BenchmarkCondition =
  | "normal"
  | "low_light"
  | "glare_curved"
  | "small_damaged";

export type BenchmarkOutcome =
  | "correct"
  | "wrong_valid"
  | "no_result"
  | "camera_error"
  | "engine_error";

export type PeakMemoryClass = "low" | "medium" | "high";

export interface BenchmarkRunResult {
  readonly protocolVersion: string;
  readonly corpusVersion: string;
  readonly partition: BenchmarkPartition;
  readonly engineName: string;
  readonly engineVersion: string;
  readonly buildId: string;
  readonly configurationId: string;
  readonly deviceClass: string;
  readonly osFamily: string;
  readonly osVersion: string;
  readonly browserFamily: string;
  readonly browserVersion: string;
  readonly symbology: BarcodeFormat;
  readonly condition: BenchmarkCondition;
  readonly sequenceId: string;
  readonly startedAtMonotonicMs: number;
  readonly outcome: BenchmarkOutcome;
  readonly timeToResultMs?: number;
  readonly initializationMs: number;
  readonly longTaskCount: number;
  readonly peakMemoryClass: PeakMemoryClass;
}

export interface ReplayFrame {
  readonly timestampMs: number;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export interface ReplayClip {
  readonly sequenceId: string;
  readonly partition: BenchmarkPartition;
  readonly symbology: BarcodeFormat;
  readonly condition: BenchmarkCondition;
  readonly groundTruthCanonical: string;
  readonly groundTruthFormat: BarcodeFormat;
  readonly deviceClass: string;
  readonly osFamily: string;
  readonly osVersion: string;
  readonly browserFamily: string;
  readonly browserVersion: string;
  readonly frames: readonly ReplayFrame[];
  readonly cameraError?: boolean;
  readonly startedAtMonotonicMs?: number;
  readonly longTaskCount?: number;
  readonly peakMemoryClass?: PeakMemoryClass;
}

export interface ReplayDecodeResult {
  readonly rawValue: string;
  readonly format: BarcodeFormat;
  readonly bounds?: readonly Point[];
}

export interface ReplayEngineAdapter {
  readonly engineName: string;
  readonly engineVersion: string;
  readonly buildId: string;
  readonly configurationId: string;
  init?(): Promise<void> | void;
  decodeFrame(
    frame: ReplayFrame,
  ): Promise<ReplayDecodeResult | null> | ReplayDecodeResult | null;
  dispose?(): Promise<void> | void;
  getDiagnostics?(): {
    readonly longTaskCount?: number;
    readonly peakMemoryClass?: PeakMemoryClass;
  };
}

export interface ReplayBenchmarkOptions {
  readonly protocolVersion: string;
  readonly corpusVersion: string;
  readonly analysisFrozen?: boolean;
  readonly protocolFreezeHash?: string;
  readonly seed?: number;
  readonly consensusOptions?: ConsensusOptions;
}

export interface RateMetric {
  readonly count: number;
  readonly rate: number;
  readonly ci95: WilsonInterval;
}

export interface QuantileMetrics {
  readonly p50: number | null;
  readonly p90: number | null;
  readonly p95: number | null;
}

export interface BenchmarkGroupMetrics {
  readonly totalTrials: number;
  readonly correctWithin1s: RateMetric;
  readonly correctWithin2s: RateMetric;
  readonly correctWithin3s: RateMetric;
  readonly correctWithin5s: RateMetric;
  readonly timeToFirstCorrectMs: QuantileMetrics;
  readonly wrongValidCount: number;
  readonly wrongValidRuleOfThree95UpperBound: number;
  readonly wrongValidNote: "one_sided_95_upper_bound_not_zero_risk";
  readonly noResultRate: number;
  readonly recoverableFailureRate: number;
  readonly coldInitP50Ms: number | null;
  readonly coldInitP95Ms: number | null;
}

export interface BenchmarkAggregateReport extends BenchmarkGroupMetrics {
  readonly byEngine: Readonly<Record<string, BenchmarkGroupMetrics>>;
  readonly byConfiguration: Readonly<Record<string, BenchmarkGroupMetrics>>;
  readonly bySymbology: Readonly<Record<string, BenchmarkGroupMetrics>>;
  readonly byCondition: Readonly<Record<string, BenchmarkGroupMetrics>>;
  readonly byDeviceClass: Readonly<Record<string, BenchmarkGroupMetrics>>;
}

export interface SyntheticStressTestOptions {
  readonly frameCount?: number;
  readonly seed?: number;
  readonly requiredConfirmingFrames?: number;
  readonly windowMs?: number;
}

export interface SyntheticStressTestResult {
  readonly totalFrames: number;
  readonly wrongValidAccepted: number;
  readonly ruleOfThree95UpperBound: number;
  readonly riskDisclaimer: "One-sided 95% upper bound; never claim zero real-world risk.";
}

const Z_95_ONE_SIDED = 1.6448536269514722;
const NEG_LN_0_05 = -Math.log(0.05);

/**
 * Deterministic 32-bit PRNG (Mulberry32) yielding floats in [0, 1).
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns a deterministically shuffled copy of `items` using `seededRandom(seed)`.
 */
export function shuffleWithSeed<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  const rand = seededRandom(seed);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const current = copy[i];
    const target = copy[j];
    if (current !== undefined && target !== undefined) {
      copy[i] = target;
      copy[j] = current;
    }
  }
  return copy;
}

/**
 * Computes the Wilson score 95% confidence interval for a binomial proportion.
 */
export function wilsonInterval95(
  successes: number,
  trials: number,
): WilsonInterval {
  return wilsonScoreInterval(
    trials <= 0 ? 0 : successes,
    Math.max(0, trials),
  );
}

/**
 * One-sided 95% upper bound for rare events.
 * For 0 observed events in N independent trials, returns -ln(0.05) / N (~2.9957 / N).
 */
export function ruleOfThreeUpperBound(events: number, trials: number): number {
  if (trials <= 0 || events >= trials) {
    return 1;
  }
  if (events <= 0) {
    return NEG_LN_0_05 / trials;
  }
  const p = events / trials;
  const z2 = Z_95_ONE_SIDED * Z_95_ONE_SIDED;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const half =
    (Z_95_ONE_SIDED *
      Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) /
    denom;
  return Math.min(1, center + half);
}

function assertValidationPartitionUnlocked(
  clips: readonly ReplayClip[],
  options: ReplayBenchmarkOptions,
): void {
  const hasValidation = clips.some((clip) => clip.partition === "validation");
  if (!hasValidation) {
    return;
  }
  if (
    options.analysisFrozen !== true ||
    typeof options.protocolFreezeHash !== "string" ||
    options.protocolFreezeHash.trim().length === 0
  ) {
    throw new Error(
      "Validation partition is locked until analysis code is frozen",
    );
  }
}

async function runSingleTrial(
  clip: ReplayClip,
  adapter: ReplayEngineAdapter,
  options: ReplayBenchmarkOptions,
): Promise<BenchmarkRunResult> {
  const startedAtMonotonicMs =
    clip.startedAtMonotonicMs ?? performance.now();
  const consensus = new ConsensusTracker(options.consensusOptions);

  let initializationMs = 0;
  let outcome: BenchmarkOutcome = "no_result";
  let timeToResultMs: number | undefined;
  let initialized = false;

  if (clip.cameraError === true) {
    outcome = "camera_error";
  } else {
    try {
      const initStart = performance.now();
      if (adapter.init !== undefined) {
        await adapter.init();
      }
      initialized = true;
      initializationMs = Math.max(0, performance.now() - initStart);

      const firstFrameTs = clip.frames[0]?.timestampMs ?? 0;

      for (const frame of clip.frames) {
        validateFrameBounds(frame.width, frame.height, frame.data.byteLength);
        const decoded = await adapter.decodeFrame(frame);
        if (decoded === null) {
          continue;
        }

        const observation =
          decoded.bounds !== undefined
            ? {
                rawValue: decoded.rawValue,
                format: decoded.format,
                timestampMs: frame.timestampMs,
                engineVersion: adapter.engineVersion,
                bounds: decoded.bounds,
              }
            : {
                rawValue: decoded.rawValue,
                format: decoded.format,
                timestampMs: frame.timestampMs,
                engineVersion: adapter.engineVersion,
              };

        const accepted = consensus.observe(observation);
        if (accepted !== null) {
          timeToResultMs = Math.max(0, accepted.timestampMs - firstFrameTs);
          outcome =
            accepted.canonicalValue === clip.groundTruthCanonical
              ? "correct"
              : "wrong_valid";
          break;
        }
      }
    } catch {
      outcome = "engine_error";
      timeToResultMs = undefined;
    } finally {
      if (initialized && adapter.dispose !== undefined) {
        try {
          await adapter.dispose();
        } catch {
          // Ignore teardown errors during benchmark cleanup.
        }
      }
    }
  }

  const adapterDiagnostics = adapter.getDiagnostics?.();
  const longTaskCount =
    adapterDiagnostics?.longTaskCount ?? clip.longTaskCount ?? 0;
  const peakMemoryClass =
    adapterDiagnostics?.peakMemoryClass ?? clip.peakMemoryClass ?? "low";

  const baseResult = {
    protocolVersion: options.protocolVersion,
    corpusVersion: options.corpusVersion,
    partition: clip.partition,
    engineName: adapter.engineName,
    engineVersion: adapter.engineVersion,
    buildId: adapter.buildId,
    configurationId: adapter.configurationId,
    deviceClass: clip.deviceClass,
    osFamily: clip.osFamily,
    osVersion: clip.osVersion,
    browserFamily: clip.browserFamily,
    browserVersion: clip.browserVersion,
    symbology: clip.symbology,
    condition: clip.condition,
    sequenceId: clip.sequenceId,
    startedAtMonotonicMs,
    outcome,
    initializationMs,
    longTaskCount,
    peakMemoryClass,
  };

  const result: BenchmarkRunResult =
    timeToResultMs !== undefined
      ? { ...baseResult, timeToResultMs }
      : baseResult;

  assertPrivacySafePayload(result);
  return result;
}

/**
 * Replays recorded clips across one or more engine adapters in a deterministic
 * seeded order and emits privacy-validated BenchmarkRunResult records.
 */
export async function runReplayBenchmark(
  clips: readonly ReplayClip[],
  adapters: ReplayEngineAdapter | readonly ReplayEngineAdapter[],
  options: ReplayBenchmarkOptions,
): Promise<BenchmarkRunResult[]> {
  assertValidationPartitionUnlocked(clips, options);

  const adapterList = Array.isArray(adapters)
    ? adapters
    : [adapters as ReplayEngineAdapter];
  const pairs: Array<{
    readonly clip: ReplayClip;
    readonly adapter: ReplayEngineAdapter;
  }> = [];

  for (const clip of clips) {
    for (const adapter of adapterList) {
      pairs.push({ clip, adapter });
    }
  }

  const ordered =
    options.seed !== undefined ? shuffleWithSeed(pairs, options.seed) : pairs;

  const results: BenchmarkRunResult[] = [];
  for (const pair of ordered) {
    const runResult = await runSingleTrial(pair.clip, pair.adapter, options);
    results.push(runResult);
  }
  return results;
}

function computeQuantile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  if (sorted.length === 1) {
    return sorted[0] ?? null;
  }
  const index = p * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const loVal = sorted[lo];
  const hiVal = sorted[hi];
  if (loVal === undefined || hiVal === undefined) {
    return null;
  }
  const frac = index - lo;
  return loVal + frac * (hiVal - loVal);
}

function buildRateMetric(count: number, total: number): RateMetric {
  return {
    count,
    rate: total > 0 ? count / total : 0,
    ci95: wilsonInterval95(count, total),
  };
}

function computeGroupMetrics(
  results: readonly BenchmarkRunResult[],
): BenchmarkGroupMetrics {
  const totalTrials = results.length;
  let within1s = 0;
  let within2s = 0;
  let within3s = 0;
  let within5s = 0;
  let wrongValidCount = 0;
  let noResultCount = 0;
  let cameraErrorCount = 0;
  let engineErrorCount = 0;

  const correctTimes: number[] = [];
  const initTimes: number[] = [];

  for (const r of results) {
    initTimes.push(r.initializationMs);
    if (r.outcome === "correct" && r.timeToResultMs !== undefined) {
      correctTimes.push(r.timeToResultMs);
      if (r.timeToResultMs <= 1000) within1s++;
      if (r.timeToResultMs <= 2000) within2s++;
      if (r.timeToResultMs <= 3000) within3s++;
      if (r.timeToResultMs <= 5000) within5s++;
    } else if (r.outcome === "wrong_valid") {
      wrongValidCount++;
    } else if (r.outcome === "no_result") {
      noResultCount++;
    } else if (r.outcome === "camera_error") {
      cameraErrorCount++;
    } else if (r.outcome === "engine_error") {
      engineErrorCount++;
    }
  }

  correctTimes.sort((a, b) => a - b);
  initTimes.sort((a, b) => a - b);

  return {
    totalTrials,
    correctWithin1s: buildRateMetric(within1s, totalTrials),
    correctWithin2s: buildRateMetric(within2s, totalTrials),
    correctWithin3s: buildRateMetric(within3s, totalTrials),
    correctWithin5s: buildRateMetric(within5s, totalTrials),
    timeToFirstCorrectMs: {
      p50: computeQuantile(correctTimes, 0.5),
      p90: computeQuantile(correctTimes, 0.9),
      p95: computeQuantile(correctTimes, 0.95),
    },
    wrongValidCount,
    wrongValidRuleOfThree95UpperBound: ruleOfThreeUpperBound(
      wrongValidCount,
      totalTrials,
    ),
    wrongValidNote: "one_sided_95_upper_bound_not_zero_risk",
    noResultRate: totalTrials > 0 ? noResultCount / totalTrials : 0,
    recoverableFailureRate:
      totalTrials > 0
        ? (cameraErrorCount + engineErrorCount) / totalTrials
        : 0,
    coldInitP50Ms: computeQuantile(initTimes, 0.5),
    coldInitP95Ms: computeQuantile(initTimes, 0.95),
  };
}

function groupAndAggregate(
  results: readonly BenchmarkRunResult[],
  keyFn: (r: BenchmarkRunResult) => string,
): Record<string, BenchmarkGroupMetrics> {
  const buckets = new Map<string, BenchmarkRunResult[]>();
  for (const r of results) {
    const key = keyFn(r);
    const existing = buckets.get(key);
    if (existing !== undefined) {
      existing.push(r);
    } else {
      buckets.set(key, [r]);
    }
  }
  const output: Record<string, BenchmarkGroupMetrics> = {};
  for (const [key, group] of buckets) {
    output[key] = computeGroupMetrics(group);
  }
  return output;
}

/**
 * Aggregates BenchmarkRunResult records into overall protocol metrics and
 * subgroup breakdowns after asserting every record is privacy-safe.
 */
export function aggregateBenchmarkResults(
  results: readonly BenchmarkRunResult[],
): BenchmarkAggregateReport {
  for (const result of results) {
    assertPrivacySafePayload(result);
  }

  const overall = computeGroupMetrics(results);
  return {
    ...overall,
    byEngine: groupAndAggregate(results, (r) => r.engineName),
    byConfiguration: groupAndAggregate(
      results,
      (r) => `${r.engineName}@${r.configurationId}`,
    ),
    bySymbology: groupAndAggregate(results, (r) => r.symbology),
    byCondition: groupAndAggregate(results, (r) => r.condition),
    byDeviceClass: groupAndAggregate(results, (r) => r.deviceClass),
  };
}

interface GroundTruthSeed {
  readonly code: string;
  readonly format: BarcodeFormat;
}

const STRESS_SEEDS: readonly GroundTruthSeed[] = [
  { code: "4006381333931", format: "ean13" },
  { code: "5000112637922", format: "ean13" },
  { code: "036000291452", format: "upca" },
  { code: "042100005264", format: "upca" },
  { code: "96385074", format: "ean8" },
  { code: "40170725", format: "ean8" },
];

const NON_DIGIT_GLYPHS = ["?", "X", "-", "*"] as const;

/**
 * Generates >= 100,000 deterministic perturbed frame observations (noise, blur,
 * occlusion, partial bars, and multi-digit corruptions) around valid ground-truth
 * codes and verifies checksum + ConsensusTracker acceptance rate.
 */
export function runSyntheticWrongCodeStressTest(
  options: SyntheticStressTestOptions = {},
): SyntheticStressTestResult {
  const frameCount = options.frameCount ?? 100_000;
  const seed = options.seed ?? 0x517cc1b7;
  const requiredConfirmingFrames = options.requiredConfirmingFrames ?? 2;
  const windowMs = options.windowMs ?? 1500;

  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new RangeError("frameCount must be a positive integer");
  }

  let state = seed >>> 0;
  const nextInt = (max: number): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const u = (t ^ (t >>> 14)) >>> 0;
    return u % max;
  };

  const tracker = new ConsensusTracker({
    requiredConfirmingFrames,
    windowMs,
    duplicateCooldownMs: 2000,
  });

  let wrongValidAccepted = 0;
  const seedCount = STRESS_SEEDS.length;

  for (let i = 0; i < frameCount; i++) {
    const gt = STRESS_SEEDS[i % seedCount];
    if (gt === undefined) {
      continue;
    }
    const base = gt.code;
    const len = base.length;
    const mode = nextInt(5);

    let perturbed: string;
    let format: BarcodeFormat = gt.format;

    if (mode === 0) {
      // Partial / occluded barcode: truncated bar read
      const cutLen = 3 + nextInt(len - 3);
      perturbed = base.slice(0, cutLen);
    } else if (mode === 1) {
      // Blur / glare: non-digit symbol injected
      const pos = nextInt(len);
      const glyph = NON_DIGIT_GLYPHS[nextInt(NON_DIGIT_GLYPHS.length)] ?? "?";
      perturbed = `${base.slice(0, pos)}${glyph}${base.slice(pos + 1)}`;
    } else if (mode === 2) {
      // Single-digit read noise (always invalid mod-10 check digit)
      const pos = nextInt(len);
      const origDigit = base.charCodeAt(pos) - 48;
      const newDigit = (origDigit + 1 + nextInt(9)) % 10;
      perturbed = `${base.slice(0, pos)}${newDigit}${base.slice(pos + 1)}`;
    } else if (mode === 3) {
      // Multi-digit severe noise perturbation across 5+ distinct positions
      const chars = base.split("");
      const startPos = nextInt(len);
      const mutations = Math.min(len, 5);
      for (let m = 0; m < mutations; m++) {
        const pos = (startPos + m) % len;
        const ch = chars[pos];
        if (ch !== undefined) {
          const orig = ch.charCodeAt(0) - 48;
          chars[pos] = String((orig + 1 + nextInt(9)) % 10);
        }
      }
      perturbed = chars.join("");
    } else {
      // Symbology mismatch / boundary shift
      format = gt.format === "ean13" ? "upca" : "ean13";
      perturbed = base;
    }

    if (!isValidCode(perturbed, format)) {
      tracker.observe({
        rawValue: perturbed,
        format,
        timestampMs: i * 33,
        engineVersion: "synthetic-stress@1.0.0",
      });
      continue;
    }

    const result = tracker.observe({
      rawValue: perturbed,
      format,
      timestampMs: i * 33,
      engineVersion: "synthetic-stress@1.0.0",
    });

    if (result !== null) {
      wrongValidAccepted++;
    }
  }

  return {
    totalFrames: frameCount,
    wrongValidAccepted,
    ruleOfThree95UpperBound: ruleOfThreeUpperBound(
      wrongValidAccepted,
      frameCount,
    ),
    riskDisclaimer:
      "One-sided 95% upper bound; never claim zero real-world risk.",
  };
}
