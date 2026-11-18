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
  renderLinearBarcodeFrame,
  type DocumentVisibilityLike,
  type MediaDevicesLike,
  type MediaStreamLike,
  type MediaStreamTrackLike,
  type MediaTrackConstraintsLike,
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
} {
  const listeners = new Set<() => void>();
  const visibilitySource: DocumentVisibilityLike = {
    visibilityState: "visible",
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
