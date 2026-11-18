import {
  validateFrameBounds,
  type ReplayDecodeResult,
  type ReplayFrame,
} from "open-retail-scanner-core";

/** Frames taking strictly longer than 50 ms are counted as long tasks. */
export const LONG_TASK_THRESHOLD_MS = 50;

const DATA_URL_RE = /^\s*data:|data:[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+/i;
const BASE64_MARKER_RE = /;base64,/i;
const JPEG_MIME_RE = /\bimage\/jpe?g\b/i;
const ENCODING_KEYWORD_RE = /\b(?:base64|jpe?g)\b/i;
const RAW_BASE64_BLOB_RE = /^[A-Za-z0-9+/]{64,}={0,2}$/;

const FORBIDDEN_ENCODING_KEYS = new Set([
  "base64",
  "dataurl",
  "jpeg",
  "jpg",
]);

function hasForbiddenEncodingKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (FORBIDDEN_ENCODING_KEYS.has(normalized)) {
    return true;
  }
  const tokens = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
  return tokens.some((token) => FORBIDDEN_ENCODING_KEYS.has(token));
}

function scanForBase64OrJpeg(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): void {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === "string") {
    if (
      DATA_URL_RE.test(value) ||
      BASE64_MARKER_RE.test(value) ||
      JPEG_MIME_RE.test(value) ||
      ENCODING_KEYWORD_RE.test(value) ||
      (RAW_BASE64_BLOB_RE.test(value) && !/^\d+$/.test(value))
    ) {
      throw new Error(
        `ADR 0002 violation: JPEG or base64 payload disallowed at ${path}`,
      );
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  // Raw pixel/luminance byte views and ArrayBuffers are valid non-JPEG binary frames.
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return;
  }

  if (typeof Blob !== "undefined" && value instanceof Blob) {
    if (JPEG_MIME_RE.test(value.type)) {
      throw new Error(
        `ADR 0002 violation: JPEG Blob disallowed at ${path}`,
      );
    }
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanForBase64OrJpeg(value[i], `${path}[${i}]`, seen);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (hasForbiddenEncodingKey(key)) {
      throw new Error(
        `ADR 0002 violation: forbidden encoding key "${key}" at ${path}`,
      );
    }
    scanForBase64OrJpeg(record[key], `${path}.${key}`, seen);
  }
}

/**
 * Enforces ADR 0002 by rejecting JPEG, data URL, or base64-encoded frame payloads
 * in the real-time decode loop.
 */
export function assertNoBase64OrJpeg(value: unknown): void {
  scanForBase64OrJpeg(value, "$", new WeakSet<object>());
}

/** Input frame submitted to {@link LatestFrameScheduler} with an optional handle releaser. */
export interface FrameInput {
  readonly frame: ReplayFrame;
  readonly close?: (() => void) | undefined;
}

/** Off-main-thread worker transport contract for decoding frames without JPEG/base64. */
export interface WorkerTransport {
  postFrame(frame: ReplayFrame): Promise<ReplayDecodeResult | null>;
  terminate(): void | Promise<void>;
}

/** Minimal structural Web Worker interface for {@link createWebWorkerTransport}. */
export interface WebWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message" | "error", listener: (event: unknown) => void): void;
  removeEventListener(type: "message" | "error", listener: (event: unknown) => void): void;
  terminate(): void;
}

/** Options for {@link createWebWorkerTransport}. */
export interface WebWorkerTransportOptions {
  readonly transferBuffer?: boolean | undefined;
}

interface WorkerDecodeResponse {
  readonly id?: number;
  readonly result?: ReplayDecodeResult | null;
  readonly error?: string;
}

/**
 * Wraps a Web Worker-compatible object into a {@link WorkerTransport} that
 * passes raw {@link ReplayFrame} buffers (never JPEG/base64) and detaches all
 * event listeners on {@link WorkerTransport.terminate}.
 */
export function createWebWorkerTransport(
  worker: WebWorkerLike,
  options: WebWorkerTransportOptions = {},
): WorkerTransport {
  const transferBuffer = options.transferBuffer === true;
  let nextId = 1;
  let terminated = false;

  const pending = new Map<
    number,
    {
      readonly resolve: (value: ReplayDecodeResult | null) => void;
      readonly reject: (reason: unknown) => void;
    }
  >();

  const onMessage = (rawEvent: unknown): void => {
    const event = rawEvent as { readonly data?: unknown };
    const payload = event?.data as WorkerDecodeResponse | undefined;
    if (payload === null || typeof payload !== "object") {
      return;
    }
    const id = payload.id;
    if (typeof id !== "number") {
      return;
    }
    const entry = pending.get(id);
    if (entry === undefined) {
      return;
    }
    pending.delete(id);
    if (typeof payload.error === "string") {
      entry.reject(new Error(payload.error));
      return;
    }
    entry.resolve(payload.result ?? null);
  };

  const onError = (rawEvent: unknown): void => {
    const event = rawEvent as { readonly message?: unknown };
    const err = new Error(
      typeof event?.message === "string"
        ? event.message
        : "Worker decode error",
    );
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.reject(err);
    }
  };

  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);

  return {
    postFrame(frame: ReplayFrame): Promise<ReplayDecodeResult | null> {
      if (terminated) {
        return Promise.reject(new Error("WorkerTransport has been terminated"));
      }
      assertNoBase64OrJpeg(frame);
      validateFrameBounds(frame.width, frame.height, frame.data.byteLength);

      const id = nextId++;
      return new Promise<ReplayDecodeResult | null>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          if (
            transferBuffer &&
            frame.data.buffer instanceof ArrayBuffer &&
            frame.data.byteOffset === 0 &&
            frame.data.byteLength === frame.data.buffer.byteLength
          ) {
            worker.postMessage({ id, frame }, [frame.data.buffer]);
          } else {
            worker.postMessage({ id, frame });
          }
        } catch (err) {
          pending.delete(id);
          reject(err);
        }
      });
    },

    terminate(): void {
      if (terminated) {
        return;
      }
      terminated = true;
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(new Error("WorkerTransport terminated"));
      }
      worker.terminate();
    },
  };
}

/** Minimal structural DedicatedWorkerGlobalScope interface for {@link attachDecoderWorkerScope}. */
export interface WorkerGlobalScopeLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: unknown) => void): void;
  removeEventListener(type: "message", listener: (event: unknown) => void): void;
}

interface WorkerDecodeRequest {
  readonly id?: unknown;
  readonly frame?: unknown;
}

/**
 * Attaches a worker-side `"message"` handler for `{ id, frame }` requests sent
 * by {@link createWebWorkerTransport}, enforcing ADR 0002 and frame bounds
 * before invoking `decodeFrame` and posting `{ id, result }` or `{ id, error }`.
 */
export function attachDecoderWorkerScope(
  scope: WorkerGlobalScopeLike,
  decodeFrame: (
    frame: ReplayFrame,
  ) => Promise<ReplayDecodeResult | null> | ReplayDecodeResult | null,
): () => void {
  let detached = false;

  const handleMessage = async (rawEvent: unknown): Promise<void> => {
    if (detached) {
      return;
    }
    const event = rawEvent as { readonly data?: unknown };
    const payload = event?.data as WorkerDecodeRequest | undefined;
    if (payload === null || typeof payload !== "object") {
      return;
    }

    const id = payload.id;
    const rawFrame = payload.frame;
    if (
      typeof id !== "number" ||
      !Number.isFinite(id) ||
      rawFrame === null ||
      typeof rawFrame !== "object"
    ) {
      return;
    }

    try {
      assertNoBase64OrJpeg(rawFrame);
      const frame = rawFrame as ReplayFrame;
      if (
        frame.data === null ||
        typeof frame.data !== "object" ||
        typeof frame.data.byteLength !== "number"
      ) {
        throw new TypeError("Invalid ReplayFrame data buffer");
      }
      validateFrameBounds(frame.width, frame.height, frame.data.byteLength);
      const result = await decodeFrame(frame);
      if (!detached) {
        scope.postMessage({ id, result: result ?? null });
      }
    } catch (err) {
      if (!detached) {
        scope.postMessage({
          id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  const onMessage = (rawEvent: unknown): void => {
    void handleMessage(rawEvent);
  };

  scope.addEventListener("message", onMessage);

  return () => {
    if (detached) {
      return;
    }
    detached = true;
    scope.removeEventListener("message", onMessage);
  };
}

/** Monotonic and current occupancy metrics reported by {@link LatestFrameScheduler}. */
export interface SchedulerMetrics {
  readonly processedFrames: number;
  readonly droppedFrames: number;
  readonly inFlightCount: 0 | 1;
  readonly queueDepth: 0 | 1;
  readonly longTaskCount: number;
  readonly lastDecodeDurationMs: number;
}

/** Configuration for {@link LatestFrameScheduler}. */
export interface LatestFrameSchedulerOptions {
  readonly decodeFrame?:
    | ((
        frame: ReplayFrame,
      ) => Promise<ReplayDecodeResult | null> | ReplayDecodeResult | null)
    | undefined;
  readonly workerTransport?: WorkerTransport | undefined;
  readonly createWorkerTransport?: (() => WorkerTransport) | undefined;
  readonly onResult?:
    | ((result: ReplayDecodeResult | null, timestampMs: number) => void)
    | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly now?: (() => number) | undefined;
}

interface TrackedFrame {
  readonly frame: ReplayFrame;
  close(): void;
}

function trackFrame(input: FrameInput): TrackedFrame {
  let closed = false;
  return {
    frame: input.frame,
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      input.close?.();
    },
  };
}

/**
 * Latest-frame worker scheduler (ADR 0002) enforcing queue depth <= 1.
 * At most one frame is in flight and at most one waiting frame sits in the
 * pending slot; older pending frames are immediately dropped and closed.
 */
export class LatestFrameScheduler {
  private readonly decodeFrameFn:
    | ((
        frame: ReplayFrame,
      ) => Promise<ReplayDecodeResult | null> | ReplayDecodeResult | null)
    | undefined;
  private readonly fixedWorker: WorkerTransport | undefined;
  private readonly workerFactory: (() => WorkerTransport) | undefined;
  private readonly onResult:
    | ((result: ReplayDecodeResult | null, timestampMs: number) => void)
    | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly now: () => number;

  private activeWorker: WorkerTransport | null = null;
  private fixedWorkerTerminated = false;
  private running = false;
  private stoppedExplicitly = false;
  private generation = 0;

  private inFlight: TrackedFrame | null = null;
  private pendingSlot: TrackedFrame | null = null;
  private idleWaiters: Array<() => void> = [];

  private _processedFrames = 0;
  private _droppedFrames = 0;
  private _longTaskCount = 0;
  private _lastDecodeDurationMs = 0;

  constructor(options: LatestFrameSchedulerOptions) {
    if (
      options.decodeFrame === undefined &&
      options.workerTransport === undefined &&
      options.createWorkerTransport === undefined
    ) {
      throw new Error(
        "LatestFrameScheduler requires decodeFrame, workerTransport, or createWorkerTransport",
      );
    }

    this.decodeFrameFn = options.decodeFrame;
    this.fixedWorker = options.workerTransport;
    this.workerFactory = options.createWorkerTransport;
    this.onResult = options.onResult;
    this.onError = options.onError;
    this.now = options.now ?? (() => performance.now());
  }

  get processedFrames(): number {
    return this._processedFrames;
  }

  get droppedFrames(): number {
    return this._droppedFrames;
  }

  get inFlightCount(): 0 | 1 {
    return this.inFlight !== null ? 1 : 0;
  }

  get queueDepth(): 0 | 1 {
    return this.pendingSlot !== null ? 1 : 0;
  }

  get longTaskCount(): number {
    return this._longTaskCount;
  }

  get lastDecodeDurationMs(): number {
    return this._lastDecodeDurationMs;
  }

  get isRunning(): boolean {
    return this.running;
  }

  getMetrics(): SchedulerMetrics {
    return {
      processedFrames: this._processedFrames,
      droppedFrames: this._droppedFrames,
      inFlightCount: this.inFlightCount,
      queueDepth: this.queueDepth,
      longTaskCount: this._longTaskCount,
      lastDecodeDurationMs: this._lastDecodeDurationMs,
    };
  }

  /** Starts (or restarts) the scheduler and attaches a worker transport if configured. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.stoppedExplicitly = false;
    this.generation++;

    if (this.workerFactory !== undefined) {
      this.activeWorker = this.workerFactory();
    } else if (this.fixedWorker !== undefined) {
      this.activeWorker = this.fixedWorker;
    }
  }

  /**
   * Submits a frame for decoding. If a frame is already decoding and another
   * frame occupies the waiting slot, the older waiting frame is immediately
   * dropped and closed so queue depth never exceeds 1.
   */
  submit(input: FrameInput): boolean {
    const tracked = trackFrame(input);

    try {
      assertNoBase64OrJpeg(input.frame);
      validateFrameBounds(
        input.frame.width,
        input.frame.height,
        input.frame.data.byteLength,
      );
    } catch (err) {
      tracked.close();
      throw err;
    }

    if (this.stoppedExplicitly) {
      tracked.close();
      this._droppedFrames++;
      return false;
    }

    if (!this.running) {
      this.start();
    }

    if (this.inFlight === null) {
      void this.runLoop(tracked, this.generation);
      return true;
    }

    if (this.pendingSlot !== null) {
      const displaced = this.pendingSlot;
      this.pendingSlot = null;
      displaced.close();
      this._droppedFrames++;
    }

    this.pendingSlot = tracked;
    return true;
  }

  /** Resolves once the in-flight and pending frames (if any) have finished or stopped. */
  waitForIdle(): Promise<void> {
    if (this.inFlight === null && this.pendingSlot === null) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  /**
   * Idempotently stops the scheduler: cancels/ignores late completions,
   * drops and closes any pending or in-flight frames, and terminates any
   * scheduler-owned factory worker transport. A caller-provided `workerTransport`
   * stays reusable across `stop()` / `start()` until {@link dispose}.
   */
  stop(): Promise<void> {
    return this.stopInternal(false);
  }

  /**
   * Stops the scheduler and terminates both any active factory worker and any
   * caller-provided `workerTransport`.
   */
  dispose(): Promise<void> {
    return this.stopInternal(true);
  }

  private async stopInternal(terminateFixed: boolean): Promise<void> {
    this.stoppedExplicitly = true;

    const currentActive = this.activeWorker;
    this.activeWorker = null;

    const ownedWorkerToTerminate =
      currentActive !== null && currentActive !== this.fixedWorker
        ? currentActive
        : null;

    const fixedWorkerToTerminate =
      terminateFixed &&
      this.fixedWorker !== undefined &&
      !this.fixedWorkerTerminated
        ? this.fixedWorker
        : null;

    if (fixedWorkerToTerminate !== null) {
      this.fixedWorkerTerminated = true;
    }

    if (
      !this.running &&
      this.inFlight === null &&
      this.pendingSlot === null &&
      ownedWorkerToTerminate === null &&
      fixedWorkerToTerminate === null
    ) {
      return;
    }

    this.running = false;
    this.generation++;

    const pending = this.pendingSlot;
    this.pendingSlot = null;

    const active = this.inFlight;
    this.inFlight = null;

    const terminatePromises: Array<Promise<void>> = [];
    if (ownedWorkerToTerminate !== null) {
      const res = ownedWorkerToTerminate.terminate();
      if (res !== undefined) {
        terminatePromises.push(Promise.resolve(res));
      }
    }
    if (fixedWorkerToTerminate !== null) {
      const res = fixedWorkerToTerminate.terminate();
      if (res !== undefined) {
        terminatePromises.push(Promise.resolve(res));
      }
    }

    if (pending !== null) {
      pending.close();
      this._droppedFrames++;
    }

    if (active !== null) {
      active.close();
    }

    this.resolveIdleWaiters();

    if (terminatePromises.length > 0) {
      await Promise.all(terminatePromises);
    }
  }

  private async runLoop(
    initialFrame: TrackedFrame,
    generation: number,
  ): Promise<void> {
    let current: TrackedFrame | null = initialFrame;

    while (current !== null) {
      if (generation !== this.generation || !this.running) {
        current.close();
        break;
      }

      this.inFlight = current;
      const startedAtMs = this.now();
      let result: ReplayDecodeResult | null = null;
      let failed = false;
      let caughtError: unknown;

      try {
        if (this.activeWorker !== null) {
          result = await this.activeWorker.postFrame(current.frame);
        } else if (this.decodeFrameFn !== undefined) {
          result = await this.decodeFrameFn(current.frame);
        }
      } catch (err) {
        failed = true;
        caughtError = err;
      } finally {
        current.close();
      }

      if (generation !== this.generation || !this.running) {
        break;
      }

      const durationMs = Math.max(0, this.now() - startedAtMs);
      this._lastDecodeDurationMs = durationMs;
      if (durationMs > LONG_TASK_THRESHOLD_MS) {
        this._longTaskCount++;
      }
      this._processedFrames++;

      if (failed) {
        this.onError?.(caughtError);
      } else {
        this.onResult?.(result, current.frame.timestampMs);
      }

      if (generation !== this.generation || !this.running) {
        break;
      }

      this.inFlight = null;
      const next = this.pendingSlot;
      this.pendingSlot = null;
      current = next;
    }

    if (generation === this.generation) {
      this.inFlight = null;
      if (this.pendingSlot === null) {
        this.resolveIdleWaiters();
      }
    }
  }

  private resolveIdleWaiters(): void {
    if (this.idleWaiters.length === 0) {
      return;
    }
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }
}
