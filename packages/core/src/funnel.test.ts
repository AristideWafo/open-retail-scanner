import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_DECODE_CATEGORIES,
  FUNNEL_CATEGORIES,
  evaluateFunnel,
  validateFunnelCounts,
  wilsonScoreInterval,
  type FunnelCounts,
} from "./funnel.ts";

const BASELINE_SEGMENTS: Record<"iosSafari" | "androidChrome" | "other" | "total", FunnelCounts> = {
  iosSafari: {
    sessionsStarted: 120,
    completed_task: 68,
    camera_permission: 4,
    camera_lifecycle: 5,
    no_decode: 18,
    wrong_decode: 2,
    network: 5,
    product_not_found: 9,
    data_insufficient: 5,
    user_cancellation: 4,
  },
  androidChrome: {
    sessionsStarted: 140,
    completed_task: 86,
    camera_permission: 3,
    camera_lifecycle: 4,
    no_decode: 16,
    wrong_decode: 2,
    network: 6,
    product_not_found: 11,
    data_insufficient: 7,
    user_cancellation: 5,
  },
  other: {
    sessionsStarted: 40,
    completed_task: 26,
    camera_permission: 1,
    camera_lifecycle: 1,
    no_decode: 4,
    wrong_decode: 0,
    network: 2,
    product_not_found: 3,
    data_insufficient: 2,
    user_cancellation: 1,
  },
  total: {
    sessionsStarted: 300,
    completed_task: 180,
    camera_permission: 8,
    camera_lifecycle: 10,
    no_decode: 38,
    wrong_decode: 4,
    network: 13,
    product_not_found: 23,
    data_insufficient: 14,
    user_cancellation: 10,
  },
};

function toPercentTenths(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

test("category allow-lists match protocol taxonomy", () => {
  assert.deepEqual(FUNNEL_CATEGORIES, [
    "camera_permission",
    "camera_lifecycle",
    "no_decode",
    "wrong_decode",
    "network",
    "product_not_found",
    "data_insufficient",
    "user_cancellation",
    "completed_task",
  ]);
  assert.deepEqual(CAPTURE_DECODE_CATEGORIES, [
    "camera_permission",
    "camera_lifecycle",
    "no_decode",
    "wrong_decode",
  ]);
});

test("wilsonScoreInterval handles zero total, clamping, custom z, and invalid inputs", () => {
  assert.deepEqual(wilsonScoreInterval(0, 0), { lower: 0, upper: 0, center: 0 });

  const half = wilsonScoreInterval(60, 120);
  assert.equal(half.center, 0.5);
  assert.equal(toPercentTenths(half.lower), "41.2%");
  assert.equal(toPercentTenths(half.upper), "58.8%");

  const zeroSuccess = wilsonScoreInterval(0, 100);
  assert.equal(zeroSuccess.lower, 0);
  assert.ok(zeroSuccess.upper > 0 && zeroSuccess.upper < 1);

  const allSuccess = wilsonScoreInterval(100, 100);
  assert.equal(allSuccess.upper, 1);
  assert.ok(allSuccess.lower > 0 && allSuccess.lower < 1);

  const point = wilsonScoreInterval(30, 100, 0);
  assert.equal(point.lower, 0.3);
  assert.equal(point.center, 0.3);
  assert.equal(point.upper, 0.3);

  assert.throws(() => wilsonScoreInterval(0, -1), RangeError);
  assert.throws(() => wilsonScoreInterval(-1, 10), RangeError);
  assert.throws(() => wilsonScoreInterval(11, 10), RangeError);
  assert.throws(() => wilsonScoreInterval(1, 10, -1), RangeError);
  assert.throws(() => wilsonScoreInterval(Number.NaN, 10), RangeError);
});

test("validateFunnelCounts accepts valid counts and rejects extra, sensitive, or invalid inputs", () => {
  const validated = validateFunnelCounts(BASELINE_SEGMENTS.total);
  assert.deepEqual(validated, BASELINE_SEGMENTS.total);
  assert.notEqual(validated, BASELINE_SEGMENTS.total);

  assert.throws(() => validateFunnelCounts(null), TypeError);
  assert.throws(() => validateFunnelCounts([]), TypeError);
  assert.throws(() => validateFunnelCounts("4006381333931"), TypeError);

  assert.throws(
    () =>
      validateFunnelCounts({
        ...BASELINE_SEGMENTS.total,
        rawValue: "4006381333931",
      }),
    (err: unknown) => {
      assert.ok(err instanceof TypeError);
      assert.equal(err.message.includes("4006381333931"), false);
      assert.equal(err.message.includes("rawValue"), false);
      return true;
    },
  );

  assert.throws(
    () =>
      validateFunnelCounts({
        ...BASELINE_SEGMENTS.total,
        productId: "food-123",
      }),
    TypeError,
  );

  const { network: _omitted, ...missingField } = BASELINE_SEGMENTS.total;
  assert.throws(() => validateFunnelCounts(missingField), TypeError);

  assert.throws(
    () =>
      validateFunnelCounts({
        ...BASELINE_SEGMENTS.total,
        no_decode: "4006381333931",
      }),
    (err: unknown) => {
      assert.ok(err instanceof RangeError);
      assert.equal(err.message.includes("4006381333931"), false);
      return true;
    },
  );

  assert.throws(
    () => validateFunnelCounts({ ...BASELINE_SEGMENTS.total, no_decode: 38.5 }),
    RangeError,
  );
  assert.throws(
    () => validateFunnelCounts({ ...BASELINE_SEGMENTS.total, no_decode: -1 }),
    RangeError,
  );
  assert.throws(
    () => validateFunnelCounts({ ...BASELINE_SEGMENTS.total, sessionsStarted: 301 }),
    RangeError,
  );
});

test("evaluateFunnel evaluates SafeEat baseline total and per-platform segments", () => {
  const totalEval = evaluateFunnel(BASELINE_SEGMENTS.total);
  assert.equal(totalEval.failuresAndAbandons, 120);
  assert.equal(totalEval.captureDecodeFailures, 60);
  assert.equal(totalEval.captureDecodeShare, 0.5);
  assert.equal(toPercentTenths(totalEval.captureDecodeShareCi.lower), "41.2%");
  assert.equal(toPercentTenths(totalEval.captureDecodeShareCi.upper), "58.8%");
  assert.equal(totalEval.sensitivityExcludingPermissionShare, 52 / 112);
  assert.equal(toPercentTenths(totalEval.sensitivityExcludingPermissionShare), "46.4%");
  assert.equal(toPercentTenths(totalEval.sensitivityExcludingPermissionCi.lower), "37.5%");
  assert.equal(toPercentTenths(totalEval.sensitivityExcludingPermissionCi.upper), "55.6%");
  assert.equal(totalEval.projectedCompletionGainPp, 20);
  assert.equal(totalEval.decision, "CONTINUE");

  const iosEval = evaluateFunnel(BASELINE_SEGMENTS.iosSafari);
  assert.equal(iosEval.failuresAndAbandons, 52);
  assert.equal(iosEval.captureDecodeFailures, 29);
  assert.equal(toPercentTenths(iosEval.captureDecodeShare), "55.8%");
  assert.equal(toPercentTenths(iosEval.captureDecodeShareCi.lower), "42.3%");
  assert.equal(toPercentTenths(iosEval.captureDecodeShareCi.upper), "68.4%");
  assert.equal(iosEval.decision, "CONTINUE");

  const androidEval = evaluateFunnel(BASELINE_SEGMENTS.androidChrome);
  assert.equal(androidEval.failuresAndAbandons, 54);
  assert.equal(androidEval.captureDecodeFailures, 25);
  assert.equal(toPercentTenths(androidEval.captureDecodeShare), "46.3%");
  assert.equal(toPercentTenths(androidEval.captureDecodeShareCi.lower), "33.7%");
  assert.equal(toPercentTenths(androidEval.captureDecodeShareCi.upper), "59.4%");
  assert.equal(androidEval.decision, "CONTINUE");

  const otherEval = evaluateFunnel(BASELINE_SEGMENTS.other);
  assert.equal(otherEval.failuresAndAbandons, 14);
  assert.equal(otherEval.captureDecodeFailures, 6);
  assert.equal(toPercentTenths(otherEval.captureDecodeShare), "42.9%");
  assert.equal(toPercentTenths(otherEval.captureDecodeShareCi.lower), "21.4%");
  assert.equal(toPercentTenths(otherEval.captureDecodeShareCi.upper), "67.4%");
  assert.equal(otherEval.decision, "CONTINUE");
});

test("evaluateFunnel enforces CONTINUE and NO-GO gate thresholds and zero-denominator guards", () => {
  // Exact threshold boundary: 20.0% share and 5.0 pp projected gain => CONTINUE.
  const exactBoundary = evaluateFunnel({
    sessionsStarted: 100,
    completed_task: 75,
    camera_permission: 1,
    camera_lifecycle: 1,
    no_decode: 3,
    wrong_decode: 0,
    network: 5,
    product_not_found: 5,
    data_insufficient: 5,
    user_cancellation: 5,
  });
  assert.equal(exactBoundary.captureDecodeShare, 0.2);
  assert.equal(exactBoundary.projectedCompletionGainPp, 5);
  assert.equal(exactBoundary.decision, "CONTINUE");

  // Share below 20% even though projected gain >= 5 pp => NO-GO.
  const lowShare = evaluateFunnel({
    sessionsStarted: 100,
    completed_task: 0,
    camera_permission: 5,
    camera_lifecycle: 4,
    no_decode: 10,
    wrong_decode: 0,
    network: 20,
    product_not_found: 25,
    data_insufficient: 20,
    user_cancellation: 16,
  });
  assert.equal(lowShare.captureDecodeShare, 0.19);
  assert.equal(lowShare.projectedCompletionGainPp, 19);
  assert.equal(lowShare.decision, "NO-GO");

  // Share >= 20% but projected gain below 5 pp => NO-GO.
  const lowGain = evaluateFunnel({
    sessionsStarted: 1000,
    completed_task: 900,
    camera_permission: 10,
    camera_lifecycle: 10,
    no_decode: 18,
    wrong_decode: 2,
    network: 15,
    product_not_found: 20,
    data_insufficient: 15,
    user_cancellation: 10,
  });
  assert.equal(lowGain.captureDecodeShare, 0.4);
  assert.equal(lowGain.projectedCompletionGainPp, 4);
  assert.equal(lowGain.decision, "NO-GO");

  // Zero sessions => safe zeros, NO-GO.
  const zeroSessions = evaluateFunnel({
    sessionsStarted: 0,
    completed_task: 0,
    camera_permission: 0,
    camera_lifecycle: 0,
    no_decode: 0,
    wrong_decode: 0,
    network: 0,
    product_not_found: 0,
    data_insufficient: 0,
    user_cancellation: 0,
  });
  assert.equal(zeroSessions.failuresAndAbandons, 0);
  assert.equal(zeroSessions.captureDecodeShare, 0);
  assert.deepEqual(zeroSessions.captureDecodeShareCi, { lower: 0, upper: 0, center: 0 });
  assert.equal(zeroSessions.sensitivityExcludingPermissionShare, 0);
  assert.deepEqual(zeroSessions.sensitivityExcludingPermissionCi, {
    lower: 0,
    upper: 0,
    center: 0,
  });
  assert.equal(zeroSessions.projectedCompletionGainPp, 0);
  assert.equal(zeroSessions.decision, "NO-GO");

  // All failures are camera_permission => excluding permission denominator is 0.
  const onlyPermission = evaluateFunnel({
    sessionsStarted: 10,
    completed_task: 8,
    camera_permission: 2,
    camera_lifecycle: 0,
    no_decode: 0,
    wrong_decode: 0,
    network: 0,
    product_not_found: 0,
    data_insufficient: 0,
    user_cancellation: 0,
  });
  assert.equal(onlyPermission.captureDecodeShare, 1);
  assert.equal(onlyPermission.sensitivityExcludingPermissionShare, 0);
  assert.deepEqual(onlyPermission.sensitivityExcludingPermissionCi, {
    lower: 0,
    upper: 0,
    center: 0,
  });
  assert.equal(onlyPermission.decision, "CONTINUE");
});
