import { test } from "node:test";
import assert from "node:assert/strict";
import { ConsensusTracker } from "./consensus.ts";

const ENGINE = "zxing-wasm@2.0.0";

test("emits after 2 valid confirming frames within window", () => {
  const tracker = new ConsensusTracker();

  const first = tracker.observe({
    rawValue: "4006381333931",
    format: "ean13",
    timestampMs: 100,
    engineVersion: ENGINE,
  });
  assert.equal(first, null);

  const bounds = [
    { x: 10, y: 20 },
    { x: 110, y: 20 },
  ] as const;
  const second = tracker.observe({
    rawValue: "4006381333931",
    format: "ean13",
    timestampMs: 250,
    engineVersion: ENGINE,
    bounds,
  });

  assert.deepEqual(second, {
    rawValue: "4006381333931",
    canonicalValue: "4006381333931",
    format: "ean13",
    bounds,
    timestampMs: 250,
    engineVersion: ENGINE,
    evidence: {
      checksumValid: true,
      confirmingFrames: 2,
    },
  });
});

test("omits bounds property when undefined", () => {
  const tracker = new ConsensusTracker();
  tracker.observe({
    rawValue: "96385074",
    format: "ean8",
    timestampMs: 10,
    engineVersion: ENGINE,
  });
  const result = tracker.observe({
    rawValue: "96385074",
    format: "ean8",
    timestampMs: 50,
    engineVersion: ENGINE,
  });

  assert.ok(result !== null);
  assert.equal("bounds" in result, false);
});

test("does not emit on single frame", () => {
  const tracker = new ConsensusTracker({ requiredConfirmingFrames: 2 });
  const result = tracker.observe({
    rawValue: "4006381333931",
    format: "ean13",
    timestampMs: 1000,
    engineVersion: ENGINE,
  });
  assert.equal(result, null);
});

test("expires confirming frame outside windowMs", () => {
  const tracker = new ConsensusTracker({ windowMs: 1500 });

  assert.equal(
    tracker.observe({
      rawValue: "4006381333931",
      format: "ean13",
      timestampMs: 100,
      engineVersion: ENGINE,
    }),
    null,
  );

  // 100 + 1501 = 1601 -> first observation is outside [101, 1601].
  assert.equal(
    tracker.observe({
      rawValue: "4006381333931",
      format: "ean13",
      timestampMs: 1601,
      engineVersion: ENGINE,
    }),
    null,
  );

  // Third observation within window of second observation emits.
  const emitted = tracker.observe({
    rawValue: "4006381333931",
    format: "ean13",
    timestampMs: 1700,
    engineVersion: ENGINE,
  });
  assert.ok(emitted !== null);
  assert.equal(emitted.evidence.confirmingFrames, 2);
});

test("resets streak on conflicting canonical frame", () => {
  const tracker = new ConsensusTracker();

  assert.equal(
    tracker.observe({
      rawValue: "4006381333931",
      format: "ean13",
      timestampMs: 100,
      engineVersion: ENGINE,
    }),
    null,
  );

  // Different valid code resets streak to the new candidate (count = 1).
  assert.equal(
    tracker.observe({
      rawValue: "96385074",
      format: "ean8",
      timestampMs: 150,
      engineVersion: ENGINE,
    }),
    null,
  );

  // Returning to first code starts a fresh streak (count = 1), does not emit.
  assert.equal(
    tracker.observe({
      rawValue: "4006381333931",
      format: "ean13",
      timestampMs: 200,
      engineVersion: ENGINE,
    }),
    null,
  );

  const emitted = tracker.observe({
    rawValue: "4006381333931",
    format: "ean13",
    timestampMs: 250,
    engineVersion: ENGINE,
  });
  assert.ok(emitted !== null);
  assert.equal(emitted.canonicalValue, "4006381333931");
});

test("rejects invalid checksum and partial codes and resets streak", () => {
  const tracker = new ConsensusTracker();

  assert.equal(
    tracker.observe({
      rawValue: "4006381333931",
      format: "ean13",
      timestampMs: 100,
      engineVersion: ENGINE,
    }),
    null,
  );

  // Invalid check digit
  assert.equal(
    tracker.observe({
      rawValue: "4006381333932",
      format: "ean13",
      timestampMs: 120,
      engineVersion: ENGINE,
    }),
    null,
  );

  // Partial code
  assert.equal(
    tracker.observe({
      rawValue: "4006381",
      format: "ean13",
      timestampMs: 140,
      engineVersion: ENGINE,
    }),
    null,
  );

  // Single valid observation after invalid ones does not emit immediately
  assert.equal(
    tracker.observe({
      rawValue: "4006381333931",
      format: "ean13",
      timestampMs: 160,
      engineVersion: ENGINE,
    }),
    null,
  );
});

test("preserves rawValue and format while canonicalizing UPC-A to EAN-13", () => {
  const tracker = new ConsensusTracker();

  assert.equal(
    tracker.observe({
      rawValue: "036000291452",
      format: "upca",
      timestampMs: 100,
      engineVersion: ENGINE,
    }),
    null,
  );

  const result = tracker.observe({
    rawValue: "036000291452",
    format: "upca",
    timestampMs: 200,
    engineVersion: ENGINE,
  });

  assert.ok(result !== null);
  assert.equal(result.rawValue, "036000291452");
  assert.equal(result.format, "upca");
  assert.equal(result.canonicalValue, "0036000291452");
});

test("suppresses duplicate emissions within duplicateCooldownMs and emits after cooldown", () => {
  const tracker = new ConsensusTracker({
    requiredConfirmingFrames: 2,
    windowMs: 1500,
    duplicateCooldownMs: 2000,
  });

  assert.equal(
    tracker.observe({
      rawValue: "036000291452",
      format: "upca",
      timestampMs: 100,
      engineVersion: ENGINE,
    }),
    null,
  );
  const firstEmit = tracker.observe({
    rawValue: "036000291452",
    format: "upca",
    timestampMs: 200,
    engineVersion: ENGINE,
  });
  assert.ok(firstEmit !== null);

  // Within cooldown (200 + 2000 = 2200)
  assert.equal(
    tracker.observe({
      rawValue: "036000291452",
      format: "upca",
      timestampMs: 1000,
      engineVersion: ENGINE,
    }),
    null,
  );
  assert.equal(
    tracker.observe({
      rawValue: "036000291452",
      format: "upca",
      timestampMs: 1500,
      engineVersion: ENGINE,
    }),
    null,
  );

  // Different code is NOT suppressed by cooldown of previous code
  assert.equal(
    tracker.observe({
      rawValue: "96385074",
      format: "ean8",
      timestampMs: 1600,
      engineVersion: ENGINE,
    }),
    null,
  );
  const otherEmit = tracker.observe({
    rawValue: "96385074",
    format: "ean8",
    timestampMs: 1700,
    engineVersion: ENGINE,
  });
  assert.ok(otherEmit !== null);
  assert.equal(otherEmit.canonicalValue, "96385074");

  // Reset clears cooldown and candidate state
  tracker.reset();
  assert.equal(
    tracker.observe({
      rawValue: "036000291452",
      format: "upca",
      timestampMs: 1800,
      engineVersion: ENGINE,
    }),
    null,
  );
  const afterReset = tracker.observe({
    rawValue: "036000291452",
    format: "upca",
    timestampMs: 1900,
    engineVersion: ENGINE,
  });
  assert.ok(afterReset !== null);
  assert.equal(afterReset.canonicalValue, "0036000291452");
});

test("allows re-emission of same code once duplicateCooldownMs elapses", () => {
  const tracker = new ConsensusTracker({
    requiredConfirmingFrames: 2,
    windowMs: 1500,
    duplicateCooldownMs: 2000,
  });

  tracker.observe({
    rawValue: "96385074",
    format: "ean8",
    timestampMs: 100,
    engineVersion: ENGINE,
  });
  const first = tracker.observe({
    rawValue: "96385074",
    format: "ean8",
    timestampMs: 200,
    engineVersion: ENGINE,
  });
  assert.ok(first !== null);

  tracker.observe({
    rawValue: "96385074",
    format: "ean8",
    timestampMs: 2150,
    engineVersion: ENGINE,
  });
  const second = tracker.observe({
    rawValue: "96385074",
    format: "ean8",
    timestampMs: 2250,
    engineVersion: ENGINE,
  });
  assert.ok(second !== null);
  assert.equal(second.timestampMs, 2250);
});
