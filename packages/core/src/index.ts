export type BarcodeFormat = "ean8" | "ean13" | "upca";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ScanResult {
  readonly rawValue: string;
  readonly canonicalValue: string;
  readonly format: BarcodeFormat;
  readonly bounds?: readonly Point[];
  readonly timestampMs: number;
  readonly engineVersion: string;
  readonly evidence: {
    readonly checksumValid: true;
    readonly confirmingFrames: number;
  };
}

export type GuidanceReason =
  | "too_dark"
  | "too_blurry"
  | "too_far"
  | "glare"
  | "code_not_found";

export type ScannerEvent =
  | { readonly type: "result"; readonly result: ScanResult }
  | { readonly type: "guidance"; readonly reason: GuidanceReason }
  | { readonly type: "state"; readonly state: "starting" | "running" | "stopped" }
  | { readonly type: "error"; readonly code: string; readonly recoverable: boolean };

export { canonicalValue, computeCheckDigit, isValidCode } from "./checksum.ts";
export {
  CAPTURE_DECODE_CATEGORIES,
  FUNNEL_CATEGORIES,
  evaluateFunnel,
  validateFunnelCounts,
  wilsonScoreInterval,
  type FunnelCategory,
  type FunnelCounts,
  type FunnelDecision,
  type FunnelEvaluation,
  type WilsonInterval,
} from "./funnel.ts";
export {
  CI_REPLAY_DEVICE_ID,
  CORPUS_CONDITIONS,
  CORPUS_PARTITIONS,
  CORPUS_SYMBOLOGIES,
  FROZEN_PROTOCOL_VERSION,
  MOBILE_MATRIX_DEVICE_IDS,
  V1_LITE_QUOTAS,
  checkCorpusQuotas,
  validateCorpusManifest,
  type CorpusCondition,
  type CorpusManifest,
  type CorpusManifestEntry,
  type CorpusPartition,
  type CorpusQuotaReport,
  type CorpusSubgroupCounts,
  type CorpusValidationResult,
  type RightsAttestation,
} from "./corpus.ts";
export {
  ConsensusTracker,
  type ConsensusOptions,
  type FrameObservation,
} from "./consensus.ts";
export {
  MAX_FRAME_BYTES,
  MAX_FRAME_HEIGHT,
  MAX_FRAME_WIDTH,
  assertPrivacySafePayload,
  validateDiagnosticEvent,
  validateFrameBounds,
  type DiagnosticEvent,
  type DiagnosticStage,
  type DurationMsBand,
  type FailureCategory,
  type PlatformClass,
} from "./privacy.ts";
export {
  aggregateBenchmarkResults,
  renderBenchmarkMarkdown,
  ruleOfThreeUpperBound,
  runReplayBenchmark,
  runSyntheticWrongCodeStressTest,
  seededRandom,
  shuffleWithSeed,
  validateBenchmarkRunResult,
  wilsonInterval95,
  type AggregateBenchmarkOptions,
  type BenchmarkAggregateReport,
  type BenchmarkCondition,
  type BenchmarkGroupMetrics,
  type BenchmarkOutcome,
  type BenchmarkPartition,
  type BenchmarkRunResult,
  type PeakMemoryClass,
  type QuantileMetrics,
  type RateMetric,
  type RenderBenchmarkMarkdownOptions,
  type ReplayBenchmarkOptions,
  type ReplayClip,
  type ReplayDecodeResult,
  type ReplayEngineAdapter,
  type ReplayFrame,
  type SyntheticStressTestOptions,
  type SyntheticStressTestResult,
} from "./harness.ts";
