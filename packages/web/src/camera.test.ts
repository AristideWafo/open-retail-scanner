import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CameraAdapter,
  CameraAdapterError,
  FALLBACK_CAMERA_CONSTRAINTS,
  PRIMARY_CAMERA_CONSTRAINTS,
  type CameraCapabilitiesReport,
  type CameraEvent,
  type CameraStreamConstraintsLike,
  type DocumentVisibilityLike,
  type MediaDevicesLike,
  type MediaStreamLike,
  type MediaStreamTrackLike,
  type MediaTrackConstraintsLike,
  type TrackCapabilitiesLike,
  type TrackSettingsLike,
} from "./camera.ts";

// Compile-time check ensuring standard browser DOM types satisfy our injectable interfaces.
export function _assertBrowserDomCompatibility(
  mediaDevices: MediaDevices,
  document: Document,
): CameraAdapter {
  return new CameraAdapter({
    mediaDevices,
    visibilitySource: document,
  });
}

class FakeTrack implements MediaStreamTrackLike {
  readyState: "live" | "ended" = "live";
  stopCalls = 0;
  readonly appliedConstraints: MediaTrackConstraintsLike[] = [];
  readonly endedListeners = new Set<() => void>();
  labelAccessCount = 0;
  deviceIdAccessCount = 0;

  private readonly caps: TrackCapabilitiesLike;
  private readonly settings: TrackSettingsLike;

  constructor(
    caps: TrackCapabilitiesLike = {},
    settings: TrackSettingsLike = { width: 1920, height: 1080 },
  ) {
    this.caps = caps;
    this.settings = settings;
  }

  get label(): string {
    this.labelAccessCount += 1;
    return "Back Dual Wide Camera (046d:0825)";
  }

  get deviceId(): string {
    this.deviceIdAccessCount += 1;
    return "secret-hardware-device-id-123";
  }

  stop(): void {
    this.stopCalls += 1;
    this.readyState = "ended";
  }

  getCapabilities(): TrackCapabilitiesLike {
    return this.caps;
  }

  getSettings(): TrackSettingsLike {
    return this.settings;
  }

  async applyConstraints(constraints: MediaTrackConstraintsLike): Promise<void> {
    this.appliedConstraints.push(constraints);
  }

  addEventListener(type: "ended", listener: () => void): void {
    if (type === "ended") {
      this.endedListeners.add(listener);
    }
  }

  removeEventListener(type: "ended", listener: () => void): void {
    if (type === "ended") {
      this.endedListeners.delete(listener);
    }
  }

  dispatchEnded(): void {
    this.readyState = "ended";
    for (const listener of [...this.endedListeners]) {
      listener();
    }
  }
}

class FakeStream implements MediaStreamLike {
  active = true;
  private readonly tracks: readonly FakeTrack[];

  constructor(tracks: readonly FakeTrack[]) {
    this.tracks = tracks;
  }

  getVideoTracks(): readonly MediaStreamTrackLike[] {
    return this.tracks;
  }

  getTracks(): readonly MediaStreamTrackLike[] {
    return this.tracks;
  }
}

class FakeMediaDevices implements MediaDevicesLike {
  readonly requestedConstraints: Array<CameraStreamConstraintsLike | undefined> = [];
  readonly deviceChangeListeners = new Set<() => void>();
  private readonly handler: (
    constraints?: CameraStreamConstraintsLike,
  ) => Promise<MediaStreamLike>;

  constructor(
    handler: (constraints?: CameraStreamConstraintsLike) => Promise<MediaStreamLike>,
  ) {
    this.handler = handler;
  }

  async getUserMedia(
    constraints?: CameraStreamConstraintsLike,
  ): Promise<MediaStreamLike> {
    this.requestedConstraints.push(constraints);
    return this.handler(constraints);
  }

  addEventListener(type: "devicechange", listener: () => void): void {
    if (type === "devicechange") {
      this.deviceChangeListeners.add(listener);
    }
  }

  removeEventListener(type: "devicechange", listener: () => void): void {
    if (type === "devicechange") {
      this.deviceChangeListeners.delete(listener);
    }
  }

  dispatchDeviceChange(): void {
    for (const listener of [...this.deviceChangeListeners]) {
      listener();
    }
  }
}

class FakeVisibility implements DocumentVisibilityLike {
  visibilityState: "visible" | "hidden" = "visible";
  readonly listeners = new Set<() => void>();

  addEventListener(type: "visibilitychange", listener: () => void): void {
    if (type === "visibilitychange") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: "visibilitychange", listener: () => void): void {
    if (type === "visibilitychange") {
      this.listeners.delete(listener);
    }
  }

  setState(next: "visible" | "hidden"): void {
    this.visibilityState = next;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

test("1. permission denied maps to camera_permission_denied and is recoverable", async () => {
  const mediaDevices = new FakeMediaDevices(async () => {
    const err = new Error("User denied permission");
    err.name = "NotAllowedError";
    throw err;
  });
  const adapter = new CameraAdapter({ mediaDevices, visibilitySource: null });
  const events: CameraEvent[] = [];
  adapter.subscribe((event) => events.push(event));

  await assert.rejects(
    () => adapter.start(),
    (error: unknown) => {
      assert.ok(error instanceof CameraAdapterError);
      assert.equal(error.code, "camera_permission_denied");
      assert.equal(error.recoverable, true);
      return true;
    },
  );

  assert.equal(adapter.isRunning(), false);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "error");
  if (events[0]?.type === "error") {
    assert.equal(events[0].error.code, "camera_permission_denied");
    assert.equal(events[0].error.recoverable, true);
  }

  // Missing mediaDevices maps cleanly to camera_unavailable.
  const unavailable = new CameraAdapter({ mediaDevices: null, visibilitySource: null });
  await assert.rejects(
    () => unavailable.start(),
    (error: unknown) =>
      error instanceof CameraAdapterError &&
      error.code === "camera_unavailable" &&
      error.recoverable === true,
  );
});

test("2. missing camera maps NotFoundError to camera_not_found", async () => {
  const mediaDevices = new FakeMediaDevices(async () => {
    const err = new Error("Requested device not found");
    err.name = "NotFoundError";
    throw err;
  });
  const adapter = new CameraAdapter({ mediaDevices, visibilitySource: null });

  await assert.rejects(
    () => adapter.start(),
    (error: unknown) =>
      error instanceof CameraAdapterError &&
      error.code === "camera_not_found" &&
      error.recoverable === true,
  );
  assert.equal(adapter.isRunning(), false);

  const inUseDevices = new FakeMediaDevices(async () => {
    const err = new Error("Track start error");
    err.name = "NotReadableError";
    throw err;
  });
  const inUseAdapter = new CameraAdapter({
    mediaDevices: inUseDevices,
    visibilitySource: null,
  });
  await assert.rejects(
    () => inUseAdapter.start(),
    (error: unknown) =>
      error instanceof CameraAdapterError &&
      error.code === "camera_in_use" &&
      error.recoverable === true,
  );
});

test("3. OverconstrainedError falls back to basic environment constraints", async () => {
  const track = new FakeTrack({}, { width: 1280, height: 720 });
  const stream = new FakeStream([track]);
  let callIndex = 0;

  const mediaDevices = new FakeMediaDevices(async () => {
    callIndex += 1;
    if (callIndex === 1) {
      const err = new Error("Constraints cannot be satisfied");
      err.name = "OverconstrainedError";
      throw err;
    }
    return stream;
  });

  const adapter = new CameraAdapter({ mediaDevices, visibilitySource: null });
  const capabilities = await adapter.start();

  assert.equal(mediaDevices.requestedConstraints.length, 2);
  assert.deepEqual(mediaDevices.requestedConstraints[0], PRIMARY_CAMERA_CONSTRAINTS);
  assert.deepEqual(mediaDevices.requestedConstraints[1], FALLBACK_CAMERA_CONSTRAINTS);
  assert.equal(capabilities.width, 1280);
  assert.equal(capabilities.height, 720);
  assert.equal(adapter.isRunning(), true);
  adapter.stop();

  // When even fallback fails with OverconstrainedError, report camera_constraints_unsupported.
  const alwaysOverconstrained = new FakeMediaDevices(async () => {
    const err = new Error("Still overconstrained");
    err.name = "OverconstrainedError";
    throw err;
  });
  const failingAdapter = new CameraAdapter({
    mediaDevices: alwaysOverconstrained,
    visibilitySource: null,
  });
  await assert.rejects(
    () => failingAdapter.start(),
    (error: unknown) =>
      error instanceof CameraAdapterError &&
      error.code === "camera_constraints_unsupported" &&
      error.recoverable === true,
  );
});

test("4. track ended and devicechange interruptions clean up and emit camera_track_ended", async () => {
  const track1 = new FakeTrack();
  const stream1 = new FakeStream([track1]);
  const mediaDevices = new FakeMediaDevices(async () => stream1);
  const visibility = new FakeVisibility();
  const adapter = new CameraAdapter({ mediaDevices, visibilitySource: visibility });

  const events: CameraEvent[] = [];
  adapter.subscribe((event) => events.push(event));

  await adapter.start();
  assert.equal(adapter.isRunning(), true);

  track1.dispatchEnded();

  assert.equal(adapter.isRunning(), false);
  assert.equal(adapter.getStream(), null);
  assert.equal(track1.stopCalls, 1);
  assert.equal(track1.endedListeners.size, 0);
  assert.equal(mediaDevices.deviceChangeListeners.size, 0);
  assert.equal(visibility.listeners.size, 0);

  const errorEvent = events.find((e) => e.type === "error");
  assert.ok(errorEvent && errorEvent.type === "error");
  assert.equal(errorEvent.error.code, "camera_track_ended");
  assert.equal(errorEvent.error.recoverable, true);

  // Also test devicechange when active track has transitioned to ended.
  const track2 = new FakeTrack();
  const stream2 = new FakeStream([track2]);
  const mediaDevices2 = new FakeMediaDevices(async () => stream2);
  const adapter2 = new CameraAdapter({ mediaDevices: mediaDevices2, visibilitySource: null });
  const events2: CameraEvent[] = [];
  adapter2.subscribe((event) => events2.push(event));

  await adapter2.start();
  // Unrelated devicechange while track is still live should keep stream running.
  mediaDevices2.dispatchDeviceChange();
  assert.equal(adapter2.isRunning(), true);

  // Devicechange after track ended cleans up and emits camera_track_ended.
  track2.readyState = "ended";
  mediaDevices2.dispatchDeviceChange();
  assert.equal(adapter2.isRunning(), false);
  assert.equal(track2.stopCalls, 1);
  const errorEvent2 = events2.find((e) => e.type === "error");
  assert.ok(errorEvent2 && errorEvent2.type === "error");
  assert.equal(errorEvent2.error.code, "camera_track_ended");
});

test("5. visibility hidden pauses and stops tracks; visible resumes stream", async () => {
  const createdTracks: FakeTrack[] = [];
  const mediaDevices = new FakeMediaDevices(async () => {
    const track = new FakeTrack(
      { focusMode: ["continuous"] },
      { width: 1920, height: 1080 },
    );
    createdTracks.push(track);
    return new FakeStream([track]);
  });
  const visibility = new FakeVisibility();
  const adapter = new CameraAdapter({ mediaDevices, visibilitySource: visibility });

  const events: CameraEvent[] = [];
  adapter.subscribe((event) => events.push(event));

  await adapter.start();
  assert.equal(createdTracks.length, 1);
  assert.equal(adapter.isRunning(), true);

  // Backgrounding stops the active track cleanly while preserving visibility listener.
  visibility.setState("hidden");
  assert.equal(adapter.isRunning(), false);
  assert.equal(adapter.isPausedForVisibility(), true);
  assert.equal(adapter.getStream(), null);
  assert.equal(createdTracks[0]?.stopCalls, 1);
  assert.equal(visibility.listeners.size, 1);

  // Returning to foreground restarts the stream.
  visibility.setState("visible");
  // Wait a microtask for async resumeFromVisibility to finish.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(createdTracks.length, 2);
  assert.equal(adapter.isRunning(), true);
  assert.equal(adapter.isPausedForVisibility(), false);
  assert.deepEqual(
    events.map((e) => e.type),
    ["started", "paused", "resumed"],
  );

  // Explicit stop while hidden cancels pause state and removes visibility listener.
  visibility.setState("hidden");
  assert.equal(adapter.isPausedForVisibility(), true);
  adapter.stop();
  assert.equal(adapter.isPausedForVisibility(), false);
  assert.equal(visibility.listeners.size, 0);

  visibility.setState("visible");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(createdTracks.length, 2);
});

test("6. unsupported torch/zoom safely return false; supported apply constraints", async () => {
  // iOS Safari-like track: no torch, no zoom, no continuous focus exposed.
  const iosTrack = new FakeTrack({}, { width: 1920, height: 1080 });
  const iosDevices = new FakeMediaDevices(async () => new FakeStream([iosTrack]));
  const iosAdapter = new CameraAdapter({
    mediaDevices: iosDevices,
    visibilitySource: null,
  });

  const iosCaps: CameraCapabilitiesReport = await iosAdapter.start();
  assert.equal(iosCaps.torchSupported, false);
  assert.equal(iosCaps.zoomSupported, false);
  assert.equal(iosCaps.continuousFocusSupported, false);
  assert.equal(iosTrack.appliedConstraints.length, 0);
  assert.equal(await iosAdapter.setTorch(true), false);
  assert.equal(await iosAdapter.setZoom(2), false);
  assert.equal(iosTrack.appliedConstraints.length, 0);
  iosAdapter.stop();

  // Android Chrome-like track: supports continuous focus, torch, and zoom [1, 4].
  const androidTrack = new FakeTrack(
    {
      torch: true,
      zoom: { min: 1, max: 4, step: 0.1 },
      focusMode: ["manual", "continuous"],
    },
    { width: 1920, height: 1080 },
  );
  const androidDevices = new FakeMediaDevices(
    async () => new FakeStream([androidTrack]),
  );
  const androidAdapter = new CameraAdapter({
    mediaDevices: androidDevices,
    visibilitySource: null,
  });

  const androidCaps = await androidAdapter.start();
  assert.equal(androidCaps.torchSupported, true);
  assert.equal(androidCaps.zoomSupported, true);
  assert.equal(androidCaps.minZoom, 1);
  assert.equal(androidCaps.maxZoom, 4);
  assert.equal(androidCaps.continuousFocusSupported, true);

  assert.equal(await androidAdapter.setTorch(true), true);
  assert.equal(await androidAdapter.setZoom(10), true); // Clamped to maxZoom (4)
  assert.equal(await androidAdapter.setZoom(Number.NaN), false);

  assert.deepEqual(androidTrack.appliedConstraints, [
    { advanced: [{ focusMode: "continuous" }] },
    { advanced: [{ torch: true }] },
    { advanced: [{ zoom: 4 }] },
  ]);
  androidAdapter.stop();
});

test("7. repeated start/stop cycles leak zero tracks/listeners and never read/retain device labels", async () => {
  const tracks: FakeTrack[] = [];
  const mediaDevices = new FakeMediaDevices(async () => {
    const track = new FakeTrack(
      { torch: true, zoom: { min: 1, max: 3 }, focusMode: ["continuous"] },
      { width: 1920, height: 1080 },
    );
    tracks.push(track);
    return new FakeStream([track]);
  });
  const visibility = new FakeVisibility();
  const adapter = new CameraAdapter({ mediaDevices, visibilitySource: visibility });

  const capturedPayloads: string[] = [];
  adapter.subscribe((event) => {
    capturedPayloads.push(JSON.stringify(event));
  });

  for (let i = 0; i < 5; i += 1) {
    const report = await adapter.start();
    capturedPayloads.push(JSON.stringify(report));
    assert.equal(adapter.isRunning(), true);
    adapter.stop();
    // Idempotent second stop should be a safe no-op.
    adapter.stop();
    assert.equal(adapter.isRunning(), false);
  }

  assert.equal(tracks.length, 5);
  for (const track of tracks) {
    assert.equal(track.stopCalls, 1);
    assert.equal(track.endedListeners.size, 0);
    assert.equal(track.labelAccessCount, 0);
    assert.equal(track.deviceIdAccessCount, 0);
  }

  assert.equal(mediaDevices.deviceChangeListeners.size, 0);
  assert.equal(visibility.listeners.size, 0);

  const joined = capturedPayloads.join("\n");
  assert.equal(joined.includes("Back Dual Wide Camera"), false);
  assert.equal(joined.includes("secret-hardware-device-id-123"), false);
});
