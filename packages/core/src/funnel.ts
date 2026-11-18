/** Allow-listed SafeEat funnel event categories (aggregate counts only, never payloads). */
export const FUNNEL_CATEGORIES = [
  "camera_permission",
  "camera_lifecycle",
  "no_decode",
  "wrong_decode",
  "network",
  "product_not_found",
  "data_insufficient",
  "user_cancellation",
  "completed_task",
] as const;

export type FunnelCategory = (typeof FUNNEL_CATEGORIES)[number];

/** Subset of funnel categories attributable to barcode capture or decoding. */
export const CAPTURE_DECODE_CATEGORIES = [
  "camera_permission",
  "camera_lifecycle",
  "no_decode",
  "wrong_decode",
] as const;

export interface FunnelCounts {
  readonly sessionsStarted: number;
  readonly camera_permission: number;
  readonly camera_lifecycle: number;
  readonly no_decode: number;
  readonly wrong_decode: number;
  readonly network: number;
  readonly product_not_found: number;
  readonly data_insufficient: number;
  readonly user_cancellation: number;
  readonly completed_task: number;
}

export interface WilsonInterval {
  readonly lower: number;
  readonly upper: number;
  readonly center: number;
}

export type FunnelDecision = "CONTINUE" | "NO-GO";

export interface FunnelEvaluation {
  readonly failuresAndAbandons: number;
  readonly captureDecodeFailures: number;
  readonly captureDecodeShare: number;
  readonly captureDecodeShareCi: WilsonInterval;
  readonly sensitivityExcludingPermissionShare: number;
  readonly sensitivityExcludingPermissionCi: WilsonInterval;
  readonly projectedCompletionGainPp: number;
  readonly decision: FunnelDecision;
}

const DEFAULT_WILSON_Z = 1.959963984540054;
const MIN_CAPTURE_DECODE_SHARE = 0.20;
const MIN_PROJECTED_GAIN_PP = 5;

const ALLOWED_FUNNEL_KEYS: ReadonlySet<string> = new Set([
  "sessionsStarted",
  ...FUNNEL_CATEGORIES,
]);

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function readNonNegativeInteger(record: Record<string, unknown>, key: string): number {
  if (!Object.hasOwn(record, key)) {
    throw new TypeError(`Missing funnel count: ${key}`);
  }
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Invalid funnel count for ${key}`);
  }
  return value;
}

/**
 * Computes the Wilson score confidence interval for a binomial proportion.
 * Returns zeros when `total === 0` and clamps bounds to `[0, 1]`.
 */
export function wilsonScoreInterval(
  successes: number,
  total: number,
  z: number = DEFAULT_WILSON_Z,
): WilsonInterval {
  if (!Number.isFinite(z) || z < 0) {
    throw new RangeError("z must be a non-negative finite number");
  }
  if (!Number.isFinite(total) || total < 0) {
    throw new RangeError("total must be a non-negative finite number");
  }
  if (!Number.isFinite(successes) || successes < 0 || successes > total) {
    throw new RangeError("successes must be between 0 and total");
  }
  if (total === 0) {
    return { lower: 0, upper: 0, center: 0 };
  }

  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;

  return {
    lower: successes === 0 ? 0 : clampUnit(center - margin),
    upper: successes === total ? 1 : clampUnit(center + margin),
    center: clampUnit(center),
  };
}

/**
 * Validates that an unknown input contains only allow-listed non-negative integer
 * funnel counts whose category totals equal `sessionsStarted`.
 */
export function validateFunnelCounts(input: unknown): FunnelCounts {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Funnel counts must be a plain object");
  }

  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_FUNNEL_KEYS.has(key)) {
      throw new TypeError("Unexpected funnel field");
    }
  }

  const sessionsStarted = readNonNegativeInteger(record, "sessionsStarted");
  const camera_permission = readNonNegativeInteger(record, "camera_permission");
  const camera_lifecycle = readNonNegativeInteger(record, "camera_lifecycle");
  const no_decode = readNonNegativeInteger(record, "no_decode");
  const wrong_decode = readNonNegativeInteger(record, "wrong_decode");
  const network = readNonNegativeInteger(record, "network");
  const product_not_found = readNonNegativeInteger(record, "product_not_found");
  const data_insufficient = readNonNegativeInteger(record, "data_insufficient");
  const user_cancellation = readNonNegativeInteger(record, "user_cancellation");
  const completed_task = readNonNegativeInteger(record, "completed_task");

  const categorySum =
    camera_permission +
    camera_lifecycle +
    no_decode +
    wrong_decode +
    network +
    product_not_found +
    data_insufficient +
    user_cancellation +
    completed_task;

  if (categorySum !== sessionsStarted) {
    throw new RangeError("Funnel category counts must sum to sessionsStarted");
  }

  return {
    sessionsStarted,
    camera_permission,
    camera_lifecycle,
    no_decode,
    wrong_decode,
    network,
    product_not_found,
    data_insufficient,
    user_cancellation,
    completed_task,
  };
}

/**
 * Evaluates SafeEat funnel counts against the Phase 0 NO-GO thresholds
 * (`captureDecodeShare >= 0.20` and `projectedCompletionGainPp >= 5`).
 */
export function evaluateFunnel(counts: FunnelCounts): FunnelEvaluation {
  const valid = validateFunnelCounts(counts);

  const failuresAndAbandons = valid.sessionsStarted - valid.completed_task;
  const captureDecodeFailures =
    valid.camera_permission +
    valid.camera_lifecycle +
    valid.no_decode +
    valid.wrong_decode;

  const captureDecodeShare =
    failuresAndAbandons === 0 ? 0 : captureDecodeFailures / failuresAndAbandons;
  const captureDecodeShareCi = wilsonScoreInterval(
    captureDecodeFailures,
    failuresAndAbandons,
  );

  const captureDecodeExcludingPermission =
    valid.camera_lifecycle + valid.no_decode + valid.wrong_decode;
  const failuresExcludingPermission = failuresAndAbandons - valid.camera_permission;
  const sensitivityExcludingPermissionShare =
    captureDecodeExcludingPermission / Math.max(1, failuresExcludingPermission);
  const sensitivityExcludingPermissionCi = wilsonScoreInterval(
    captureDecodeExcludingPermission,
    failuresExcludingPermission,
  );

  const projectedCompletionGainPp =
    valid.sessionsStarted === 0
      ? 0
      : (captureDecodeFailures / valid.sessionsStarted) * 100;

  const decision: FunnelDecision =
    captureDecodeShare >= MIN_CAPTURE_DECODE_SHARE &&
    projectedCompletionGainPp >= MIN_PROJECTED_GAIN_PP
      ? "CONTINUE"
      : "NO-GO";

  return {
    failuresAndAbandons,
    captureDecodeFailures,
    captureDecodeShare,
    captureDecodeShareCi,
    sensitivityExcludingPermissionShare,
    sensitivityExcludingPermissionCi,
    projectedCompletionGainPp,
    decision,
  };
}
