import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertPrivacySafePayload,
  validateDiagnosticEvent,
  type ReplayDecodeResult,
  type ReplayFrame,
  type ScanResult,
  type ScannerEvent,
} from "open-retail-scanner-core";
import {
  MANUAL_ENTRY_ENGINE_VERSION,
  WebBarcodeScanner,
  ZXING_ENGINE_VERSION,
  attachDecoderWorkerScope,
  renderLinearBarcodeFrame,
  type DocumentVisibilityLike,
  type MediaDevicesLike,
  type MediaStreamLike,
  type MediaStreamTrackLike,
  type MediaTrackConstraintsLike,
  type VideoFrameSourceLike,
  type WorkerGlobalScopeLike,
  type WorkerTransport,
} from "./index.ts";

interface MockTrackHandle {
  readonly track: MediaStreamTrackLike;
  getStopCalls(): number;
  getEndedListenerCount(): number;
  getAppliedConstraints(): readonly MediaTrackConstraintsLike[];
  triggerEnded(): void;
}

function createMockTrack(options?: {
  readonly torchSupported?: boolean;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}): MockTrackHandle {
  let stopCalls = 0;
  let readyState: "live" | "ended" = "live";
  const endedListeners = new Set<() => void>();
  const appliedConstraints: MediaTrackConstraintsLike[] = [];

  const track: MediaStreamTrackLike = {
    get readyState() {
      return readyState;
    },
    stop() {
      stopCalls += 1;
      readyState = "ended";
    },
    getCapabilities() {
      return {
        torch: options?.torchSupported ?? true,
        zoom: {
          min: options?.minZoom ?? 1,
          max: options?.maxZoom ?? 3,
          step: 0.1,
        },
        focusMode: ["continuous"],
        width: { min: 640, max: 1920 },
        height: { min: 480, max: 1080 },
      };
    },
    getSettings() {
      return { width: 1280, height: 720 };
    },
    async applyConstraints(constraints: MediaTrackConstraintsLike) {
      appliedConstraints.push(constraints);
    },
    addEventListener(type: "ended", listener: () => void) {
      if (type === "ended") {
        endedListeners.add(listener);
      }
    },
    removeEventListener(type: "ended", listener: () => void) {
      if (type === "ended") {
        endedListeners.delete(listener);
      }
    },
  };

  return {
    track,
    getStopCalls: () => stopCalls,
    getEndedListenerCount: () => endedListeners.size,
    getAppliedConstraints: () => appliedConstraints,
    triggerEnded() {
      readyState = "ended";
      for (const listener of endedListeners) {
        listener();
      }
    },
  };
}

function createMockMediaDevices(
  createTrack: () => MockTrackHandle = () => createMockTrack(),
): {
  readonly mediaDevices: MediaDevicesLike;
  readonly tracks: MockTrackHandle[];
  getDeviceChangeListenerCount(): number;
} {
  const tracks: MockTrackHandle[] = [];
  const deviceChangeListeners = new Set<() => void>();

  const mediaDevices: MediaDevicesLike = {
    async getUserMedia(): Promise<MediaStreamLike> {
      const handle = createTrack();
      tracks.push(handle);
      return {
        get active() {
          return handle.track.readyState !== "ended";
        },
        getVideoTracks: () => [handle.track],
        getTracks: () => [handle.track],
      };
    },
    addEventListener(type: "devicechange", listener: () => void) {
      if (type === "devicechange") {
        deviceChangeListeners.add(listener);
      }
    },
    removeEventListener(type: "devicechange", listener: () => void) {
      if (type === "devicechange") {
        deviceChangeListeners.delete(listener);
      }
    },
  };

  return {
    mediaDevices,
    tracks,
    getDeviceChangeListenerCount: () => deviceChangeListeners.size,
  };
}

function createMockVisibility(): {
  readonly visibilitySource: DocumentVisibilityLike;
  getListenerCount(): number;
  setVisibilityState(next: "visible" | "hidden" | "prerender" | string): void;
} {
  const listeners = new Set<() => void>();
  let visibilityState = "visible";
  const visibilitySource: DocumentVisibilityLike = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type: "visibilitychange", listener: () => void) {
      if (type === "visibilitychange") {
        listeners.add(listener);
      }
    },
    removeEventListener(type: "visibilitychange", listener: () => void) {
      if (type === "visibilitychange") {
        listeners.delete(listener);
      }
    },
  };

  return {
    visibilitySource,
    getListenerCount: () => listeners.size,
    setVisibilityState(next) {
      visibilityState = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

async function waitForProcessedFrames(
  scanner: WebBarcodeScanner,
  expectedCount: number,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (scanner.getMetrics().processedFrames < expectedCount) {
    if (performance.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${expectedCount} processed frames (got ${scanner.getMetrics().processedFrames})`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

test("end-to-end camera start and 2 confirming rendered frames emit ScanResult for EAN-13, UPC-A, and EAN-8", async () => {
  const cases = [
    {
      inputCode: "4006381333931",
      inputFormat: "ean13" as const,
      expectedCanonicalValue: "4006381333931",
    },
    {
      inputCode: "036000291452",
      inputFormat: "upca" as const,
      expectedCanonicalValue: "0036000291452",
    },
    {
      inputCode: "96385074",
      inputFormat: "ean8" as const,
      expectedCanonicalValue: "96385074",
    },
  ];

  for (const testCase of cases) {
    const mockCam = createMockMediaDevices();
    const mockVis = createMockVisibility();
    const events: ScannerEvent[] = [];
    let closedCount = 0;

    const scanner = new WebBarcodeScanner({
      formats: ["ean8", "ean13", "upca"],
      mediaDevices: mockCam.mediaDevices,
      visibilitySource: mockVis.visibilitySource,
      preferNativeDetector: false,
      onEvent: (event) => events.push(event),
    });

    await scanner.start();
    assert.equal(scanner.getState().state, "running");
    assert.equal(await scanner.setTorch(true), true);
    assert.equal(await scanner.setZoom(2), true);

    const frame1 = renderLinearBarcodeFrame(testCase.inputCode, testCase.inputFormat);
    const frame2 = renderLinearBarcodeFrame(testCase.inputCode, testCase.inputFormat);

    scanner.submitFrame({
      frame: { ...frame1, timestampMs: 1000 },
      close: () => {
        closedCount += 1;
      },
    });
    await waitForProcessedFrames(scanner, 1);

    scanner.submitFrame({
      frame: { ...frame2, timestampMs: 1120 },
      close: () => {
        closedCount += 1;
      },
    });
    await waitForProcessedFrames(scanner, 2);

    const results = events.filter(
      (event): event is { readonly type: "result"; readonly result: ScanResult } =>
        event.type === "result",
    );
    assert.equal(results.length, 1);
    const emitted = results[0]!.result;
    assert.equal(emitted.canonicalValue, testCase.expectedCanonicalValue);
    assert.equal(emitted.engineVersion, ZXING_ENGINE_VERSION);
    assert.equal(emitted.evidence.checksumValid, true);
    assert.equal(emitted.evidence.confirmingFrames, 2);
    assert.equal(closedCount, 2);

    await scanner.dispose();
    assert.equal(mockCam.tracks[0]?.getStopCalls(), 1);
  }
});

test("native BarcodeDetector fast path preserves rawValue and format when supported", async () => {
  class MockBarcodeDetector {
    static async getSupportedFormats(): Promise<readonly string[]> {
      return ["ean_8", "ean_13", "upc_a"];
    }
    async detect(): Promise<readonly { rawValue: string; format: string }[]> {
      return [{ rawValue: "036000291452", format: "upc_a" }];
    }
  }

  const mockCam = createMockMediaDevices();
  const events: ScannerEvent[] = [];
  const scanner = new WebBarcodeScanner({
    mediaDevices: mockCam.mediaDevices,
    visibilitySource: null,
    preferNativeDetector: true,
    detectorCtor: MockBarcodeDetector,
    onEvent: (event) => events.push(event),
  });

  await scanner.start();
  assert.equal(scanner.getDiagnostics().featureBarcodeDetector, true);

  const frame = renderLinearBarcodeFrame("036000291452", "upca");
  scanner.submitFrame({ frame: { ...frame, timestampMs: 500 } });
  scanner.submitFrame({ frame: { ...frame, timestampMs: 600 } });
  await waitForProcessedFrames(scanner, 2);

  const results = events.filter(
    (event): event is { readonly type: "result"; readonly result: ScanResult } =>
      event.type === "result",
  );
  assert.equal(results.length, 1);
  assert.equal(results[0]!.result.rawValue, "036000291452");
  assert.equal(results[0]!.result.canonicalValue, "0036000291452");
  assert.equal(results[0]!.result.format, "upca");
  assert.equal(results[0]!.result.evidence.checksumValid, true);
  assert.equal(results[0]!.result.evidence.confirmingFrames, 2);

  await scanner.dispose();
});

test("single frame or conflicting frames do not emit until 2 confirming frames match", async () => {
  const mockCam = createMockMediaDevices();
  const events: ScannerEvent[] = [];

  const scanner = new WebBarcodeScanner({
    mediaDevices: mockCam.mediaDevices,
    visibilitySource: null,
    preferNativeDetector: false,
  });
  const unsubscribe = scanner.subscribe((event) => events.push(event));

  await scanner.start();

  const ean13Frame = renderLinearBarcodeFrame("4006381333931", "ean13");
  scanner.submitFrame({ frame: { ...ean13Frame, timestampMs: 1000 } });
  await waitForProcessedFrames(scanner, 1);
  assert.equal(
    events.some((event) => event.type === "result"),
    false,
  );

  // Conflicting code resets the consensus candidate.
  const ean8Frame1 = renderLinearBarcodeFrame("96385074", "ean8");
  scanner.submitFrame({ frame: { ...ean8Frame1, timestampMs: 1100 } });
  await waitForProcessedFrames(scanner, 2);
  assert.equal(
    events.some((event) => event.type === "result"),
    false,
  );

  // Second confirming EAN-8 frame satisfies consensus.
  const ean8Frame2 = renderLinearBarcodeFrame("96385074", "ean8");
  scanner.submitFrame({ frame: { ...ean8Frame2, timestampMs: 1200 } });
  await waitForProcessedFrames(scanner, 3);

  const results = events.filter(
    (event): event is { readonly type: "result"; readonly result: ScanResult } =>
      event.type === "result",
  );
  assert.equal(results.length, 1);
  assert.equal(results[0]!.result.rawValue, "96385074");
  assert.equal(results[0]!.result.canonicalValue, "96385074");
  assert.equal(results[0]!.result.format, "ean8");

  unsubscribe();
  await scanner.dispose();
});

test("camera permission failure emits recoverable error and keeps manual entry working", async () => {
  const events: ScannerEvent[] = [];
  const deniedMediaDevices: MediaDevicesLike = {
    async getUserMedia() {
      const error = new Error("Permission denied by user");
      error.name = "NotAllowedError";
      throw error;
    },
  };

  const scanner = new WebBarcodeScanner({
    mediaDevices: deniedMediaDevices,
    visibilitySource: null,
    preferNativeDetector: false,
    onEvent: (event) => events.push(event),
  });

  await scanner.start();

  assert.equal(scanner.getState().state, "error");
  assert.equal(scanner.getState().errorCode, "camera_permission_denied");
  assert.equal(scanner.getState().manualEntryOpen, true);

  const errorEvents = events.filter((event) => event.type === "error");
  assert.equal(errorEvents.length, 1);
  assert.deepEqual(errorEvents[0], {
    type: "error",
    code: "camera_permission_denied",
    recoverable: true,
  });

  const invalid = scanner.submitManualCode("4006381333932", "ean13");
  assert.equal(invalid.ok, false);

  const manual = scanner.submitManualCode("4006381333931", "ean13");
  assert.equal(manual.ok, true);
  if (manual.ok) {
    assert.equal(manual.result.rawValue, "4006381333931");
    assert.equal(manual.result.canonicalValue, "4006381333931");
    assert.equal(manual.result.format, "ean13");
    assert.equal(manual.result.engineVersion, MANUAL_ENTRY_ENGINE_VERSION);
    assert.equal(manual.result.evidence.checksumValid, true);
    assert.equal(manual.result.evidence.confirmingFrames, 1);
  }

  const results = events.filter((event) => event.type === "result");
  assert.equal(results.length, 1);

  await scanner.dispose();
});

test("Issue #18 teardown: repeated start/stop/dispose leaks zero tracks, frame handles, listeners, or worker transports", async () => {
  const mockCam = createMockMediaDevices();
  const mockVis = createMockVisibility();
  const frame = renderLinearBarcodeFrame("4006381333931", "ean13");

  let submittedFrames = 0;
  let closedFrames = 0;

  // Cycle 1-4: repeated start/stop on the same scanner instance with real WASM decode & camera tracks.
  const scanner = new WebBarcodeScanner({
    mediaDevices: mockCam.mediaDevices,
    visibilitySource: mockVis.visibilitySource,
    preferNativeDetector: false,
  });

  for (let cycle = 0; cycle < 4; cycle++) {
    await scanner.start();
    assert.equal(scanner.getState().state, "running");

    submittedFrames += 1;
    scanner.submitFrame({
      frame: { ...frame, timestampMs: 1000 + cycle * 100 },
      close: () => {
        closedFrames += 1;
      },
    });
    await waitForProcessedFrames(scanner, cycle + 1);

    await scanner.stop();
    assert.equal(scanner.getState().state, "stopped");

    // Idempotent second stop() is a safe no-op.
    await scanner.stop();

    assert.equal(mockCam.getDeviceChangeListenerCount(), 0);
    assert.equal(mockVis.getListenerCount(), 0);
    assert.equal(scanner.getMetrics().inFlightCount, 0);
    assert.equal(scanner.getMetrics().queueDepth, 0);
  }

  // Submitting after stop immediately closes the frame handle without leaking.
  submittedFrames += 1;
  scanner.submitFrame({
    frame: { ...frame, timestampMs: 9999 },
    close: () => {
      closedFrames += 1;
    },
  });

  await scanner.dispose();
  await scanner.dispose(); // Idempotent dispose.

  assert.equal(mockCam.tracks.length, 4);
  for (const trackHandle of mockCam.tracks) {
    assert.equal(trackHandle.getStopCalls(), 1);
    assert.equal(trackHandle.getEndedListenerCount(), 0);
  }
  assert.equal(closedFrames, submittedFrames);

  // Separate worker transport teardown test: pending + in-flight frames are closed & worker terminated.
  let terminateCalls = 0;
  const pendingResolvers: Array<(value: ReplayDecodeResult | null) => void> = [];
  const workerTransport: WorkerTransport = {
    postFrame(_f: ReplayFrame): Promise<ReplayDecodeResult | null> {
      return new Promise((resolve) => {
        pendingResolvers.push(resolve);
      });
    },
    terminate() {
      terminateCalls += 1;
    },
  };

  const workerCam = createMockMediaDevices();
  const workerVis = createMockVisibility();
  const workerScanner = new WebBarcodeScanner({
    mediaDevices: workerCam.mediaDevices,
    visibilitySource: workerVis.visibilitySource,
    preferNativeDetector: false,
    workerTransport,
  });

  await workerScanner.start();
  let workerClosed = 0;
  workerScanner.submitFrame({
    frame: { ...frame, timestampMs: 2000 },
    close: () => {
      workerClosed += 1;
    },
  });
  workerScanner.submitFrame({
    frame: { ...frame, timestampMs: 2010 },
    close: () => {
      workerClosed += 1;
    },
  });
  workerScanner.submitFrame({
    frame: { ...frame, timestampMs: 2020 },
    close: () => {
      workerClosed += 1;
    },
  });

  await workerScanner.dispose();
  for (const resolve of pendingResolvers) {
    resolve(null);
  }

  assert.equal(terminateCalls, 1);
  assert.equal(workerClosed, 3);
  assert.equal(workerCam.tracks[0]?.getStopCalls(), 1);
  assert.equal(workerCam.tracks[0]?.getEndedListenerCount(), 0);
  assert.equal(workerCam.getDeviceChangeListenerCount(), 0);
  assert.equal(workerVis.getListenerCount(), 0);
  assert.equal(workerScanner.getMetrics().inFlightCount, 0);
  assert.equal(workerScanner.getMetrics().queueDepth, 0);
});

test("Issue #18 privacy & oversized input gate: diagnostics pass strict schema and 5000x5000 frame is rejected within budget", async () => {
  const events: ScannerEvent[] = [];
  const scanner = new WebBarcodeScanner({
    mediaDevices: null,
    visibilitySource: null,
    preferNativeDetector: false,
    onEvent: (event) => events.push(event),
  });

  // Idle diagnostics.
  const idleDiag = scanner.getDiagnostics();
  assertPrivacySafePayload(idleDiag);
  assert.deepEqual(validateDiagnosticEvent(idleDiag), idleDiag);

  await scanner.start();

  // Scan a real barcode and verify neither diagnostics nor state/metrics leak digits or frames.
  const frame1 = renderLinearBarcodeFrame("4006381333931", "ean13");
  const frame2 = renderLinearBarcodeFrame("4006381333931", "ean13");
  scanner.submitFrame({ frame: { ...frame1, timestampMs: 100 } });
  scanner.submitFrame({ frame: { ...frame2, timestampMs: 200 } });
  await waitForProcessedFrames(scanner, 2);

  const postDecodeDiag = scanner.getDiagnostics();
  assertPrivacySafePayload(postDecodeDiag);
  assert.deepEqual(validateDiagnosticEvent(postDecodeDiag), postDecodeDiag);
  assertPrivacySafePayload(scanner.getState());
  assertPrivacySafePayload(scanner.getMetrics());
  assert.equal(JSON.stringify(postDecodeDiag).includes("4006381333931"), false);
  assert.equal(JSON.stringify(scanner.getState()).includes("4006381333931"), false);

  // Oversized 5000x5000 frame must be rejected immediately within budget and close handle.
  const oversizedData = new Uint8Array(5000 * 5000);
  let oversizedClosed = false;
  const startMs = performance.now();
  assert.throws(
    () =>
      scanner.submitFrame({
        frame: {
          timestampMs: 300,
          width: 5000,
          height: 5000,
          data: oversizedData,
        },
        close: () => {
          oversizedClosed = true;
        },
      }),
    RangeError,
  );
  const elapsedMs = performance.now() - startMs;
  assert.equal(oversizedClosed, true);
  assert.ok(elapsedMs < 50, `Expected < 50ms oversized rejection, took ${elapsedMs}ms`);

  const errorDiag = scanner.getDiagnostics();
  assert.equal(errorDiag.failureCategory, "oversized_input");
  assertPrivacySafePayload(errorDiag);
  assert.deepEqual(validateDiagnosticEvent(errorDiag), errorDiag);

  await scanner.dispose();
  const teardownDiag = scanner.getDiagnostics();
  assert.equal(teardownDiag.stage, "teardown");
  assertPrivacySafePayload(teardownDiag);
  assert.deepEqual(validateDiagnosticEvent(teardownDiag), teardownDiag);
});

function isPermissiveSpdxLicense(license: unknown): boolean {
  if (typeof license !== "string" || license.trim().length === 0) {
    return false;
  }
  const stripped = license.replace(/[()]/g, "").trim();
  if (/\bAND\b/i.test(stripped)) {
    const conjuncts = stripped.split(/\s+AND\s+/i);
    return conjuncts.every((part) => isPermissiveSpdxLicense(part));
  }
  const disjuncts = stripped.split(/\s+OR\s+/i).map((part) => part.trim());
  return disjuncts.some((part) => part === "MIT" || part === "Apache-2.0");
}

test("Issue #18 dependency & license audit: zxing-wasm pinned, permissive prod licenses, NOTICE complete", async () => {
  const rootPkgUrl = new URL("../../../package.json", import.meta.url);
  const webPkgUrl = new URL("../package.json", import.meta.url);
  const lockfileUrl = new URL("../../../package-lock.json", import.meta.url);
  const noticeUrl = new URL("../../../NOTICE", import.meta.url);

  const [rootPkgRaw, webPkgRaw, lockfileRaw, noticeRaw] = await Promise.all([
    readFile(rootPkgUrl, "utf8"),
    readFile(webPkgUrl, "utf8"),
    readFile(lockfileUrl, "utf8"),
    readFile(noticeUrl, "utf8"),
  ]);

  const rootPkg = JSON.parse(rootPkgRaw) as {
    readonly license?: string;
    readonly dependencies?: Record<string, string>;
  };
  const webPkg = JSON.parse(webPkgRaw) as {
    readonly license?: string;
    readonly dependencies?: Record<string, string>;
  };
  const lockfile = JSON.parse(lockfileRaw) as {
    readonly packages?: Record<
      string,
      {
        readonly version?: string;
        readonly dev?: boolean;
        readonly link?: boolean;
        readonly license?: string;
        readonly dependencies?: Record<string, string>;
      }
    >;
  };

  assert.equal(rootPkg.license, "Apache-2.0");
  assert.equal(rootPkg.dependencies, undefined);
  assert.equal(webPkg.license, "Apache-2.0");

  const zxingSpec = webPkg.dependencies?.["zxing-wasm"];
  assert.equal(zxingSpec, "3.1.7");
  assert.equal(/^\d+\.\d+\.\d+$/.test(zxingSpec ?? ""), true);

  const packages = lockfile.packages ?? {};
  assert.equal(packages["packages/web"]?.dependencies?.["zxing-wasm"], "3.1.7");
  assert.equal(packages["node_modules/zxing-wasm"]?.version, "3.1.7");

  const prodPackages = Object.entries(packages).filter(
    ([name, entry]) =>
      name.startsWith("node_modules/") && entry.dev !== true && entry.link !== true,
  );
  assert.ok(prodPackages.length > 0);
  for (const [name, entry] of prodPackages) {
    assert.ok(
      isPermissiveSpdxLicense(entry.license),
      `Unexpected non-permissive production dependency license for ${name}: ${String(entry.license)}`,
    );
  }

  assert.ok(noticeRaw.includes("zxing-wasm@3.1.7"));
  assert.ok(noticeRaw.includes("MIT License"));
  assert.ok(noticeRaw.includes("ZXing-C++"));
  assert.ok(noticeRaw.includes("Apache License, Version 2.0"));
});

test("live frame pump with attached videoElement and mount(root) emits ScanResult without manual submitFrame()", async () => {
  const mockCam = createMockMediaDevices();
  const events: ScannerEvent[] = [];
  const baseFrame = renderLinearBarcodeFrame("4006381333931", "ean13");

  let nextCallbackId = 1;
  let cancelCalls = 0;
  let playCalls = 0;
  const activeCallbacks = new Map<number, (now: number) => void>();

  const videoElement: VideoFrameSourceLike = {
    videoWidth: baseFrame.width,
    videoHeight: baseFrame.height,
    srcObject: null,
    play(): Promise<void> {
      playCalls += 1;
      return Promise.resolve();
    },
    requestVideoFrameCallback(cb: (now: number) => void): number {
      const id = nextCallbackId++;
      activeCallbacks.set(id, cb);
      setTimeout(() => {
        const fn = activeCallbacks.get(id);
        if (fn !== undefined) {
          activeCallbacks.delete(id);
          fn(1000 + id * 100);
        }
      }, 5);
      return id;
    },
    cancelVideoFrameCallback(handle: number): void {
      if (activeCallbacks.delete(handle)) {
        cancelCalls += 1;
      }
    },
  };

  let extractCount = 0;
  const scanner = new WebBarcodeScanner({
    mediaDevices: mockCam.mediaDevices,
    visibilitySource: null,
    preferNativeDetector: false,
    videoElement,
    frameExtractor: (_video, timestampMs) => {
      extractCount += 1;
      return {
        ...baseFrame,
        timestampMs,
      };
    },
    onEvent: (event) => events.push(event),
  });

  await scanner.start();
  assert.equal(videoElement.srcObject, scanner.getStream());
  assert.ok(playCalls >= 1);

  await waitForProcessedFrames(scanner, 2);

  const results = events.filter(
    (event): event is { readonly type: "result"; readonly result: ScanResult } =>
      event.type === "result",
  );
  assert.equal(results.length, 1);
  assert.equal(results[0]!.result.canonicalValue, "4006381333931");
  assert.equal(results[0]!.result.evidence.confirmingFrames, 2);
  assert.ok(extractCount >= 2);

  await scanner.stop();
  assert.equal(videoElement.srcObject, null);
  assert.ok(cancelCalls >= 1);
  assert.equal(activeCallbacks.size, 0);

  // Also verify scanner.mount(root) attaches the DOM <video> and pumps frames automatically.
  class MockDomNode {
    readonly tagName: string;
    readonly children: MockDomNode[] = [];
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, Set<(event: unknown) => void>>();
    textContent = "";
    hidden = false;
    tabIndex = 0;
    type = "";
    value = "";
    inputMode = "";
    autocomplete = "";
    min = "";
    max = "";
    step = "";
    muted = false;
    autoplay = false;
    playsInline = false;
    videoWidth = baseFrame.width;
    videoHeight = baseFrame.height;
    srcObject: unknown = null;
    parentNode: MockDomNode | null = null;
    readonly ownerDocument: { createElement(tag: string): MockDomNode };

    constructor(
      tagName: string,
      ownerDocument: { createElement(tag: string): MockDomNode },
    ) {
      this.tagName = tagName;
      this.ownerDocument = ownerDocument;
    }

    play(): Promise<void> {
      return Promise.resolve();
    }

    appendChild(child: MockDomNode): MockDomNode {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    append(...nodes: MockDomNode[]): void {
      for (const node of nodes) {
        this.appendChild(node);
      }
    }

    remove(): void {
      if (this.parentNode) {
        const idx = this.parentNode.children.indexOf(this);
        if (idx >= 0) {
          this.parentNode.children.splice(idx, 1);
        }
        this.parentNode = null;
      }
    }

    setAttribute(name: string, val: string): void {
      this.attributes.set(name, val);
    }

    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    }

    addEventListener(type: string, fn: (event: unknown) => void): void {
      let set = this.listeners.get(type);
      if (!set) {
        set = new Set();
        this.listeners.set(type, set);
      }
      set.add(fn);
    }

    removeEventListener(type: string, fn: (event: unknown) => void): void {
      this.listeners.get(type)?.delete(fn);
    }

    focus(): void {}
  }

  const doc = {
    createElement(tag: string): MockDomNode {
      return new MockDomNode(tag, doc);
    },
  };
  const root = doc.createElement("div");

  const mountedEvents: ScannerEvent[] = [];
  const mountedScanner = new WebBarcodeScanner({
    mediaDevices: mockCam.mediaDevices,
    visibilitySource: null,
    preferNativeDetector: false,
    frameExtractor: (_video, timestampMs) => ({
      ...baseFrame,
      timestampMs,
    }),
    onEvent: (event) => mountedEvents.push(event),
  });

  const view = mountedScanner.mount(root as unknown as HTMLElement);
  assert.equal(
    mountedScanner.getUIController().getState().state,
    mountedScanner.getState().state,
  );
  await mountedScanner.start();
  assert.equal(
    (view.getVideoElement() as unknown as MockDomNode).srcObject,
    mountedScanner.getStream(),
  );

  await waitForProcessedFrames(mountedScanner, 2);
  const mountedResults = mountedEvents.filter(
    (event): event is { readonly type: "result"; readonly result: ScanResult } =>
      event.type === "result",
  );
  assert.equal(mountedResults.length, 1);
  assert.equal(mountedResults[0]!.result.canonicalValue, "4006381333931");

  view.destroy();
  assert.equal((view.getVideoElement() as unknown as MockDomNode).srcObject, null);
  assert.equal(root.children.length, 0);

  await mountedScanner.dispose();
  await scanner.dispose();
});

test("visibility paused/resumed stops and restarts frame pump and updates video stream binding", async () => {
  const mockCam = createMockMediaDevices();
  const mockVis = createMockVisibility();
  const baseFrame = renderLinearBarcodeFrame("96385074", "ean8");
  const events: ScannerEvent[] = [];

  let nextId = 1;
  const pendingTicks = new Map<number, (now: number) => void>();

  const videoElement: VideoFrameSourceLike = {
    videoWidth: baseFrame.width,
    videoHeight: baseFrame.height,
    srcObject: null,
    requestVideoFrameCallback(cb: (now: number) => void): number {
      const id = nextId++;
      pendingTicks.set(id, cb);
      setTimeout(() => {
        const fn = pendingTicks.get(id);
        if (fn !== undefined) {
          pendingTicks.delete(id);
          fn(2000 + id * 100);
        }
      }, 5);
      return id;
    },
    cancelVideoFrameCallback(handle: number): void {
      pendingTicks.delete(handle);
    },
  };

  let extractWhilePaused = 0;
  let paused = false;
  const scanner = new WebBarcodeScanner({
    mediaDevices: mockCam.mediaDevices,
    visibilitySource: mockVis.visibilitySource,
    preferNativeDetector: false,
    videoElement,
    frameExtractor: (_video, timestampMs) => {
      if (paused) {
        extractWhilePaused += 1;
      }
      return {
        ...baseFrame,
        timestampMs,
      };
    },
    onEvent: (event) => events.push(event),
  });

  await scanner.start();
  const firstStream = scanner.getStream();
  assert.ok(firstStream !== null);
  assert.equal(videoElement.srcObject, firstStream);

  paused = true;
  mockVis.setVisibilityState("hidden");
  assert.equal(videoElement.srcObject, null);
  assert.equal(pendingTicks.size, 0);

  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  assert.equal(extractWhilePaused, 0);

  const countBeforeResume = scanner.getMetrics().processedFrames;
  paused = false;
  mockVis.setVisibilityState("visible");

  // Wait for async resumeFromVisibility() to acquire stream and pump confirming frames.
  await waitForProcessedFrames(scanner, countBeforeResume + 2);
  const resumedStream = scanner.getStream();
  assert.ok(resumedStream !== null);
  assert.notEqual(resumedStream, firstStream);
  assert.equal(videoElement.srcObject, resumedStream);

  const results = events.filter(
    (event): event is { readonly type: "result"; readonly result: ScanResult } =>
      event.type === "result",
  );
  assert.equal(results.length, 1);
  assert.equal(results[0]!.result.canonicalValue, "96385074");

  await scanner.dispose();
});

test("runtime fallback from NativeBarcodeDetectorAdapter to ZxingWasmAdapter stamps ZXING_ENGINE_VERSION", async () => {
  class ThrowingNativeDetector {
    static async getSupportedFormats(): Promise<readonly string[]> {
      return ["ean_8", "ean_13", "upc_a"];
    }
    async detect(): Promise<never> {
      throw new Error("Native detector crashed at runtime");
    }
  }

  const events: ScannerEvent[] = [];
  const scanner = new WebBarcodeScanner({
    mediaDevices: null,
    visibilitySource: null,
    preferNativeDetector: true,
    detectorCtor: ThrowingNativeDetector,
    onEvent: (event) => events.push(event),
  });

  await scanner.start();

  const frame1 = renderLinearBarcodeFrame("4006381333931", "ean13");
  const frame2 = renderLinearBarcodeFrame("4006381333931", "ean13");
  scanner.submitFrame({ frame: { ...frame1, timestampMs: 100 } });
  scanner.submitFrame({ frame: { ...frame2, timestampMs: 200 } });
  await waitForProcessedFrames(scanner, 2);

  const results = events.filter(
    (event): event is { readonly type: "result"; readonly result: ScanResult } =>
      event.type === "result",
  );
  assert.equal(results.length, 1);
  assert.equal(results[0]!.result.canonicalValue, "4006381333931");
  assert.equal(results[0]!.result.engineVersion, ZXING_ENGINE_VERSION);

  await scanner.dispose();
});

test("restart (stop -> start) with createWorkerTransport creates fresh worker transport and re-exports worker scope helpers", async () => {
  assert.equal(typeof attachDecoderWorkerScope, "function");
  const dummyScopeCheck: WorkerGlobalScopeLike | null = null;
  assert.equal(dummyScopeCheck, null);

  let createdCount = 0;
  let terminateCount = 0;
  const mockCam = createMockMediaDevices();
  const events: ScannerEvent[] = [];
  const frame = renderLinearBarcodeFrame("4006381333931", "ean13");

  const scanner = new WebBarcodeScanner({
    mediaDevices: mockCam.mediaDevices,
    visibilitySource: null,
    preferNativeDetector: false,
    createWorkerTransport: () => {
      createdCount += 1;
      return {
        async postFrame(_f: ReplayFrame): Promise<ReplayDecodeResult | null> {
          return { rawValue: "4006381333931", format: "ean13" };
        },
        terminate(): void {
          terminateCount += 1;
        },
      };
    },
    onEvent: (event) => events.push(event),
  });

  // First start -> decode 2 frames -> stop
  await scanner.start();
  assert.equal(createdCount, 1);
  scanner.submitFrame({ frame: { ...frame, timestampMs: 100 } });
  scanner.submitFrame({ frame: { ...frame, timestampMs: 200 } });
  await waitForProcessedFrames(scanner, 2);
  await scanner.stop();
  assert.equal(terminateCount, 1);

  // Second start -> decode 2 frames -> dispose
  await scanner.start();
  assert.equal(createdCount, 2);
  scanner.submitFrame({ frame: { ...frame, timestampMs: 3000 } });
  scanner.submitFrame({ frame: { ...frame, timestampMs: 3100 } });
  await waitForProcessedFrames(scanner, 4);

  const results = events.filter(
    (event): event is { readonly type: "result"; readonly result: ScanResult } =>
      event.type === "result",
  );
  assert.equal(results.length, 2);

  await scanner.dispose();
  assert.equal(terminateCount, 2);

  // Also verify caller-provided workerTransport survives stop() -> start() and terminates on dispose().
  let fixedTerminateCalls = 0;
  const fixedTransport: WorkerTransport = {
    async postFrame(_f: ReplayFrame): Promise<ReplayDecodeResult | null> {
      return { rawValue: "4006381333931", format: "ean13" };
    },
    terminate(): void {
      fixedTerminateCalls += 1;
    },
  };
  const fixedEvents: ScannerEvent[] = [];
  const fixedScanner = new WebBarcodeScanner({
    mediaDevices: mockCam.mediaDevices,
    visibilitySource: null,
    preferNativeDetector: false,
    workerTransport: fixedTransport,
    onEvent: (event) => fixedEvents.push(event),
  });

  await fixedScanner.start();
  fixedScanner.submitFrame({ frame: { ...frame, timestampMs: 100 } });
  fixedScanner.submitFrame({ frame: { ...frame, timestampMs: 200 } });
  await waitForProcessedFrames(fixedScanner, 2);
  await fixedScanner.stop();
  assert.equal(fixedTerminateCalls, 0);

  await fixedScanner.start();
  fixedScanner.submitFrame({ frame: { ...frame, timestampMs: 3000 } });
  fixedScanner.submitFrame({ frame: { ...frame, timestampMs: 3100 } });
  await waitForProcessedFrames(fixedScanner, 4);
  assert.equal(
    fixedEvents.filter((event) => event.type === "result").length,
    2,
  );

  await fixedScanner.dispose();
  assert.equal(fixedTerminateCalls, 1);
});
