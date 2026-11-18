import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ReplayDecodeResult,
  ReplayFrame,
} from "open-retail-scanner-core";
import {
  LONG_TASK_THRESHOLD_MS,
  LatestFrameScheduler,
  assertNoBase64OrJpeg,
  attachDecoderWorkerScope,
  createWebWorkerTransport,
  type WebWorkerLike,
  type WorkerGlobalScopeLike,
  type WorkerTransport,
} from "./scheduler.ts";

function makeFrame(timestampMs: number, fill = 128): ReplayFrame {
  const data = new Uint8Array(16 * 16);
  data.fill(fill);
  return {
    timestampMs,
    width: 16,
    height: 16,
    data,
  };
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("queue depth never exceeds 1 under burst submission of 20 frames", async () => {
  const processedTimestamps: number[] = [];
  const closedFrames: number[] = [];
  const gates = new Map<number, ReturnType<typeof createDeferred<ReplayDecodeResult | null>>>();
  const frame20Started = createDeferred<void>();

  const scheduler = new LatestFrameScheduler({
    async decodeFrame(frame) {
      processedTimestamps.push(frame.timestampMs);
      const gate = createDeferred<ReplayDecodeResult | null>();
      gates.set(frame.timestampMs, gate);
      if (frame.timestampMs === 20) {
        frame20Started.resolve();
      }
      return gate.promise;
    },
  });

  scheduler.start();

  // Submit frame 1 -> starts decoding immediately.
  scheduler.submit({
    frame: makeFrame(1),
    close: () => closedFrames.push(1),
  });
  assert.equal(scheduler.inFlightCount, 1);
  assert.equal(scheduler.queueDepth, 0);
  assert.deepEqual(processedTimestamps, [1]);

  // Submit frames 2..20 while frame 1 is still decoding.
  for (let i = 2; i <= 20; i++) {
    const accepted = scheduler.submit({
      frame: makeFrame(i),
      close: () => closedFrames.push(i),
    });
    assert.equal(accepted, true);
    assert.equal(scheduler.inFlightCount, 1);
    assert.equal(scheduler.queueDepth, 1);
    assert.equal(scheduler.droppedFrames, Math.max(0, i - 2));
  }

  // Frames 2..19 must already be dropped and closed immediately; frame 20 waits in pendingSlot.
  assert.equal(scheduler.droppedFrames, 18);
  assert.deepEqual(
    closedFrames,
    [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
  );

  // Finish frame 1 -> frame 20 must run next.
  const gate1 = gates.get(1);
  assert.ok(gate1 !== undefined);
  gate1.resolve({ rawValue: "4006381333931", format: "ean13" });

  await frame20Started.promise;

  assert.deepEqual(processedTimestamps, [1, 20]);
  assert.equal(scheduler.inFlightCount, 1);
  assert.equal(scheduler.queueDepth, 0);
  assert.equal(scheduler.processedFrames, 1);
  assert.ok(closedFrames.includes(1));

  // Finish frame 20.
  const gate20 = gates.get(20);
  assert.ok(gate20 !== undefined);
  gate20.resolve({ rawValue: "96385074", format: "ean8" });

  await scheduler.waitForIdle();

  assert.deepEqual(scheduler.getMetrics(), {
    processedFrames: 2,
    droppedFrames: 18,
    inFlightCount: 0,
    queueDepth: 0,
    longTaskCount: 0,
    lastDecodeDurationMs: scheduler.lastDecodeDurationMs,
  });
  assert.equal(closedFrames.length, 20);
  assert.ok(closedFrames.includes(20));

  await scheduler.stop();
});

test("repeated start/stop leaks no worker, listener, or frame handle and ignores late completions", async () => {
  interface MockWorkerState {
    readonly worker: WebWorkerLike;
    readonly messageListeners: Set<(event: unknown) => void>;
    readonly errorListeners: Set<(event: unknown) => void>;
    terminatedCount: number;
    readonly postedIds: number[];
  }

  const createdWorkers: MockWorkerState[] = [];

  function createMockWorker(): MockWorkerState {
    const messageListeners = new Set<(event: unknown) => void>();
    const errorListeners = new Set<(event: unknown) => void>();
    const state: MockWorkerState = {
      messageListeners,
      errorListeners,
      terminatedCount: 0,
      postedIds: [],
      worker: {
        postMessage(message: unknown) {
          const msg = message as { readonly id: number };
          state.postedIds.push(msg.id);
        },
        addEventListener(type, listener) {
          if (type === "message") {
            messageListeners.add(listener);
          } else {
            errorListeners.add(listener);
          }
        },
        removeEventListener(type, listener) {
          if (type === "message") {
            messageListeners.delete(listener);
          } else {
            errorListeners.delete(listener);
          }
        },
        terminate() {
          state.terminatedCount++;
        },
      },
    };
    createdWorkers.push(state);
    return state;
  }

  const emittedResults: Array<ReplayDecodeResult | null> = [];
  const closedHandles = new Map<number, number>();
  const closeFn = (id: number) => () => {
    closedHandles.set(id, (closedHandles.get(id) ?? 0) + 1);
  };

  const inFlightGates: Array<ReturnType<typeof createDeferred<ReplayDecodeResult | null>>> =
    [];

  const scheduler = new LatestFrameScheduler({
    createWorkerTransport() {
      const mock = createMockWorker();
      const baseTransport = createWebWorkerTransport(mock.worker);
      return {
        postFrame(frame) {
          // Verify listeners were attached while active.
          assert.equal(mock.messageListeners.size, 1);
          assert.equal(mock.errorListeners.size, 1);
          const gate = createDeferred<ReplayDecodeResult | null>();
          inFlightGates.push(gate);
          // Also exercise baseTransport.postFrame for message wiring.
          const realPromise = baseTransport.postFrame(frame);
          void realPromise.catch(() => {
            // Expected rejection when terminated mid-flight.
          });
          return gate.promise;
        },
        terminate() {
          baseTransport.terminate();
        },
      } satisfies WorkerTransport;
    },
    onResult(result) {
      emittedResults.push(result);
    },
  });

  // Cycle 1: start, submit in-flight + pending, then stop before completion.
  scheduler.start();
  scheduler.start(); // Idempotent start does not create a second worker.
  assert.equal(createdWorkers.length, 1);

  scheduler.submit({ frame: makeFrame(101), close: closeFn(101) });
  scheduler.submit({ frame: makeFrame(102), close: closeFn(102) });
  assert.equal(scheduler.inFlightCount, 1);
  assert.equal(scheduler.queueDepth, 1);

  const lateGateFromCycle1 = inFlightGates[0];
  assert.ok(lateGateFromCycle1 !== undefined);

  await scheduler.stop();
  await scheduler.dispose(); // Idempotent stop/dispose.

  assert.equal(scheduler.isRunning, false);
  assert.equal(scheduler.inFlightCount, 0);
  assert.equal(scheduler.queueDepth, 0);
  assert.equal(closedHandles.get(101), 1);
  assert.equal(closedHandles.get(102), 1);

  const worker1 = createdWorkers[0];
  assert.ok(worker1 !== undefined);
  assert.equal(worker1.terminatedCount, 1);
  assert.equal(worker1.messageListeners.size, 0);
  assert.equal(worker1.errorListeners.size, 0);

  // Submitting while stopped must immediately drop and close the frame.
  const acceptedWhileStopped = scheduler.submit({
    frame: makeFrame(103),
    close: closeFn(103),
  });
  assert.equal(acceptedWhileStopped, false);
  assert.equal(closedHandles.get(103), 1);

  // Cycle 2: restart scheduler with a fresh worker; late completion from cycle 1 must be ignored.
  scheduler.start();
  assert.equal(createdWorkers.length, 2);

  lateGateFromCycle1.resolve({ rawValue: "4006381333931", format: "ean13" });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(emittedResults.length, 0);
  assert.equal(scheduler.processedFrames, 0);
  assert.equal(closedHandles.get(101), 1);

  await scheduler.stop();
  const worker2 = createdWorkers[1];
  assert.ok(worker2 !== undefined);
  assert.equal(worker2.terminatedCount, 1);
  assert.equal(worker2.messageListeners.size, 0);
  assert.equal(worker2.errorListeners.size, 0);
});

test("long-task counter (> 50ms) and monotonic latency tracking", async () => {
  let currentNowMs = 1000;
  const durations = [12, 50, 51, 85, -5]; // 50 is NOT > 50ms; 51 and 85 ARE > 50ms; -5 clamped to 0.
  let idx = 0;

  const scheduler = new LatestFrameScheduler({
    now: () => currentNowMs,
    async decodeFrame() {
      const delta = durations[idx++] ?? 0;
      currentNowMs += delta;
      return null;
    },
  });

  assert.equal(LONG_TASK_THRESHOLD_MS, 50);

  for (let i = 0; i < durations.length; i++) {
    scheduler.submit({ frame: makeFrame(i + 1) });
    await scheduler.waitForIdle();
  }

  assert.equal(scheduler.processedFrames, 5);
  assert.equal(scheduler.longTaskCount, 2);
  assert.equal(scheduler.lastDecodeDurationMs, 0);

  // Monotonic metrics remain non-decreasing across stop/start.
  await scheduler.stop();
  assert.equal(scheduler.processedFrames, 5);
  assert.equal(scheduler.longTaskCount, 2);

  scheduler.start();
  assert.equal(scheduler.processedFrames, 5);
  assert.equal(scheduler.longTaskCount, 2);
  await scheduler.stop();
});

test("worker transport handoff, error handling, and teardown", async () => {
  const messageListeners = new Set<(event: unknown) => void>();
  const errorListeners = new Set<(event: unknown) => void>();
  let terminated = 0;

  const worker: WebWorkerLike = {
    postMessage(message: unknown) {
      const msg = message as { readonly id: number; readonly frame: ReplayFrame };
      queueMicrotask(() => {
        if (msg.frame.timestampMs === 999) {
          for (const listener of messageListeners) {
            listener({ data: { id: msg.id, error: "decode crash" } });
          }
          return;
        }
        for (const listener of messageListeners) {
          listener({
            data: {
              id: msg.id,
              result: {
                rawValue: "036000291452",
                format: "upca",
              },
            },
          });
        }
      });
    },
    addEventListener(type, listener) {
      if (type === "message") messageListeners.add(listener);
      else errorListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") messageListeners.delete(listener);
      else errorListeners.delete(listener);
    },
    terminate() {
      terminated++;
    },
  };

  const results: Array<ReplayDecodeResult | null> = [];
  const errors: unknown[] = [];
  const transport = createWebWorkerTransport(worker);

  const scheduler = new LatestFrameScheduler({
    workerTransport: transport,
    onResult(result) {
      results.push(result);
    },
    onError(error) {
      errors.push(error);
    },
  });

  scheduler.start();
  scheduler.submit({ frame: makeFrame(1) });
  await scheduler.waitForIdle();

  assert.deepEqual(results, [{ rawValue: "036000291452", format: "upca" }]);
  assert.equal(errors.length, 0);

  // Worker error on one frame does not stall subsequent frames.
  scheduler.submit({ frame: makeFrame(999) });
  await scheduler.waitForIdle();
  assert.equal(errors.length, 1);

  scheduler.submit({ frame: makeFrame(2) });
  await scheduler.waitForIdle();
  assert.equal(results.length, 2);
  assert.equal(scheduler.processedFrames, 3);

  await scheduler.stop();
  // Caller-provided workerTransport stays alive across stop() -> start() until dispose().
  assert.equal(terminated, 0);

  scheduler.start();
  scheduler.submit({ frame: makeFrame(3) });
  await scheduler.waitForIdle();
  assert.equal(results.length, 3);
  assert.equal(scheduler.processedFrames, 4);

  await scheduler.dispose();
  assert.equal(terminated, 1);
  assert.equal(messageListeners.size, 0);
  assert.equal(errorListeners.size, 0);

  await assert.rejects(() => transport.postFrame(makeFrame(4)), /terminated/);
});

test("assertNoBase64OrJpeg rejects JPEG/base64 payloads and closes invalid submitted frames", () => {
  assert.throws(
    () => assertNoBase64OrJpeg("data:image/jpeg;base64,/9j/4AAQSkZJRg=="),
    /JPEG or base64/,
  );
  assert.throws(
    () => assertNoBase64OrJpeg({ mimeType: "image/jpeg" }),
    /JPEG or base64/,
  );
  assert.throws(
    () => assertNoBase64OrJpeg({ base64: "abc" }),
    /forbidden encoding key/,
  );
  assert.throws(
    () => assertNoBase64OrJpeg({ jpegFrame: new Uint8Array(4) }),
    /forbidden encoding key/,
  );

  // Valid raw pixel buffers (even starting with 0xff 0xd8 0xff) and numeric barcode strings are allowed.
  const rawFrame = makeFrame(1, 0xff);
  rawFrame.data[1] = 0xd8;
  assert.doesNotThrow(() => assertNoBase64OrJpeg(rawFrame));
  assert.doesNotThrow(() => assertNoBase64OrJpeg("4006381333931"));

  const scheduler = new LatestFrameScheduler({
    async decodeFrame() {
      return null;
    },
  });

  let closed = false;
  assert.throws(
    () =>
      scheduler.submit({
        frame: {
          timestampMs: 1,
          width: 16,
          height: 16,
          data: "data:image/jpeg;base64,/9j/4AAQ" as unknown as Uint8Array,
        },
        close: () => {
          closed = true;
        },
      }),
    /JPEG or base64/,
  );
  assert.equal(closed, true);
});

test("attachDecoderWorkerScope paired with createWebWorkerTransport decodes end-to-end and handles errors", async () => {
  const mainMessageListeners = new Set<(event: unknown) => void>();
  const mainErrorListeners = new Set<(event: unknown) => void>();
  const workerMessageListeners = new Set<(event: unknown) => void>();
  let terminatedCount = 0;

  const workerScope: WorkerGlobalScopeLike = {
    postMessage(message: unknown) {
      queueMicrotask(() => {
        for (const listener of mainMessageListeners) {
          listener({ data: message });
        }
      });
    },
    addEventListener(type, listener) {
      if (type === "message") {
        workerMessageListeners.add(listener);
      }
    },
    removeEventListener(type, listener) {
      if (type === "message") {
        workerMessageListeners.delete(listener);
      }
    },
  };

  const workerHandle: WebWorkerLike = {
    postMessage(message: unknown) {
      queueMicrotask(() => {
        for (const listener of workerMessageListeners) {
          listener({ data: message });
        }
      });
    },
    addEventListener(type, listener) {
      if (type === "message") mainMessageListeners.add(listener);
      else mainErrorListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") mainMessageListeners.delete(listener);
      else mainErrorListeners.delete(listener);
    },
    terminate() {
      terminatedCount++;
    },
  };

  const detachScope = attachDecoderWorkerScope(workerScope, async (frame) => {
    if (frame.timestampMs === 500) {
      throw new Error("worker decoder threw");
    }
    if (frame.timestampMs === 600) {
      return null;
    }
    return {
      rawValue: "4006381333931",
      format: "ean13",
    };
  });

  assert.equal(workerMessageListeners.size, 1);

  const transport = createWebWorkerTransport(workerHandle);
  const results: Array<ReplayDecodeResult | null> = [];
  const errors: unknown[] = [];

  const scheduler = new LatestFrameScheduler({
    workerTransport: transport,
    onResult(result) {
      results.push(result);
    },
    onError(error) {
      errors.push(error);
    },
  });

  scheduler.start();

  // Valid decode
  scheduler.submit({ frame: makeFrame(100) });
  await scheduler.waitForIdle();
  assert.deepEqual(results, [{ rawValue: "4006381333931", format: "ean13" }]);

  // Decoder error propagates cleanly back to scheduler.onError
  scheduler.submit({ frame: makeFrame(500) });
  await scheduler.waitForIdle();
  assert.equal(errors.length, 1);
  assert.match((errors[0] as Error).message, /worker decoder threw/);

  // Null decode and stop/start reuse of fixed workerTransport
  await scheduler.stop();
  assert.equal(terminatedCount, 0);

  scheduler.start();
  scheduler.submit({ frame: makeFrame(600) });
  await scheduler.waitForIdle();
  assert.deepEqual(results, [
    { rawValue: "4006381333931", format: "ean13" },
    null,
  ]);

  // Direct malformed message to workerScope (bypassing transport) returns error response without crashing
  const directResponses: unknown[] = [];
  const captureDirect = (rawEvent: unknown): void => {
    directResponses.push((rawEvent as { readonly data?: unknown }).data);
  };
  mainMessageListeners.add(captureDirect);
  for (const listener of workerMessageListeners) {
    listener({
      data: {
        id: 9001,
        frame: {
          timestampMs: 1,
          width: 16,
          height: 16,
          data: "data:image/jpeg;base64,/9j/4AAQ",
        },
      },
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(directResponses.length, 1);
  assert.equal((directResponses[0] as { id: number }).id, 9001);
  assert.match(
    (directResponses[0] as { error: string }).error,
    /JPEG or base64/,
  );
  mainMessageListeners.delete(captureDirect);

  // Stop then dispose still terminates fixed workerTransport exactly once
  await scheduler.stop();
  assert.equal(terminatedCount, 0);
  await scheduler.dispose();
  await scheduler.dispose();
  assert.equal(terminatedCount, 1);

  detachScope();
  assert.equal(workerMessageListeners.size, 0);
});

test("stop() followed by start() works with createWorkerTransport and dispose() terminates", async () => {
  const terminatedIds: number[] = [];
  let nextWorkerId = 1;

  const scheduler = new LatestFrameScheduler({
    createWorkerTransport(): WorkerTransport {
      const id = nextWorkerId++;
      return {
        async postFrame(frame) {
          return {
            rawValue: frame.timestampMs === 1 ? "96385074" : "4006381333931",
            format: frame.timestampMs === 1 ? "ean8" : "ean13",
          };
        },
        terminate() {
          terminatedIds.push(id);
        },
      };
    },
  });

  scheduler.start();
  scheduler.submit({ frame: makeFrame(1) });
  await scheduler.waitForIdle();
  await scheduler.stop();
  assert.deepEqual(terminatedIds, [1]);

  scheduler.start();
  scheduler.submit({ frame: makeFrame(2) });
  await scheduler.waitForIdle();
  await scheduler.dispose();
  assert.deepEqual(terminatedIds, [1, 2]);
  assert.equal(scheduler.processedFrames, 2);
});
