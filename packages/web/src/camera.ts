/**
 * Minimal, dependency-injectable Web MediaStream interfaces and camera adapter
 * for rear-camera capture, capability inspection, and lifecycle management.
 *
 * Privacy invariant: track labels (`track.label`) and device IDs (`deviceId`)
 * are never read, stored, logged, or included in error/capability payloads.
 */

export type CameraErrorCode =
  | "camera_permission_denied"
  | "camera_not_found"
  | "camera_in_use"
  | "camera_constraints_unsupported"
  | "camera_track_ended"
  | "camera_unavailable";

export interface CameraCapabilitiesReport {
  readonly torchSupported: boolean;
  readonly zoomSupported: boolean;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly continuousFocusSupported: boolean;
  readonly width: number;
  readonly height: number;
}

export interface TrackCapabilitiesLike {
  readonly torch?: boolean;
  readonly zoom?: {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
  };
  readonly focusMode?: readonly string[];
  readonly width?: {
    readonly min?: number;
    readonly max?: number;
  };
  readonly height?: {
    readonly min?: number;
    readonly max?: number;
  };
}

export interface TrackSettingsLike {
  readonly width?: number;
  readonly height?: number;
}

export interface MediaStreamTrackLike {
  readonly readyState?: "live" | "ended";
  stop(): void;
  getCapabilities?(): TrackCapabilitiesLike;
  getSettings?(): TrackSettingsLike;
  applyConstraints?(constraints: MediaTrackConstraintsLike): Promise<void>;
  addEventListener?(type: "ended", listener: () => void): void;
  removeEventListener?(type: "ended", listener: () => void): void;
}

export interface MediaStreamLike {
  readonly active?: boolean;
  getVideoTracks(): readonly MediaStreamTrackLike[];
  getTracks?(): readonly MediaStreamTrackLike[];
}

export interface MediaTrackConstraintSetLike {
  facingMode?: string;
  torch?: boolean;
  zoom?: number;
  focusMode?: string;
}

export interface MediaTrackConstraintsLike {
  advanced?: MediaTrackConstraintSetLike[];
}

export interface CameraStreamConstraintsLike {
  readonly audio: false;
  readonly video: {
    readonly facingMode: string | { readonly ideal: string };
    readonly width?: { readonly ideal: number; readonly min?: number };
    readonly height?: { readonly ideal: number; readonly min?: number };
  };
}

export interface MediaDevicesLike {
  getUserMedia(constraints?: CameraStreamConstraintsLike): Promise<MediaStreamLike>;
  addEventListener?(type: "devicechange", listener: () => void): void;
  removeEventListener?(type: "devicechange", listener: () => void): void;
}

export interface DocumentVisibilityLike {
  readonly visibilityState: "visible" | "hidden" | "prerender" | string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export type CameraEvent =
  | { readonly type: "started"; readonly capabilities: CameraCapabilitiesReport }
  | { readonly type: "paused" }
  | { readonly type: "resumed"; readonly capabilities: CameraCapabilitiesReport }
  | { readonly type: "stopped" }
  | { readonly type: "error"; readonly error: CameraAdapterError };

export interface CameraAdapterOptions {
  readonly mediaDevices?: MediaDevicesLike | null;
  readonly visibilitySource?: DocumentVisibilityLike | null;
}

export const PRIMARY_CAMERA_CONSTRAINTS: CameraStreamConstraintsLike = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920, min: 1280 },
    height: { ideal: 1080, min: 720 },
  },
};

export const FALLBACK_CAMERA_CONSTRAINTS: CameraStreamConstraintsLike = {
  audio: false,
  video: {
    facingMode: "environment",
  },
};

const CAMERA_ERROR_MESSAGES: Record<CameraErrorCode, string> = {
  camera_permission_denied: "Camera permission was denied.",
  camera_not_found: "No compatible camera was found.",
  camera_in_use: "Camera is currently in use by another application.",
  camera_constraints_unsupported: "Camera does not support the required video constraints.",
  camera_track_ended: "Camera stream was interrupted or ended.",
  camera_unavailable: "Camera API is unavailable in this environment.",
};

/** Recoverable error emitted by {@link CameraAdapter}; manual entry remains available. */
export class CameraAdapterError extends Error {
  readonly code: CameraErrorCode;
  readonly recoverable: true = true;

  constructor(code: CameraErrorCode, message: string = CAMERA_ERROR_MESSAGES[code]) {
    super(message);
    this.name = "CameraAdapterError";
    this.code = code;
  }
}

/** Maps a browser `getUserMedia` error to a stable, privacy-safe {@link CameraAdapterError}. */
export function mapCameraError(error: unknown): CameraAdapterError {
  if (error instanceof CameraAdapterError) {
    return error;
  }

  const name =
    typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
      ? error.name
      : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return new CameraAdapterError("camera_permission_denied");
    case "NotFoundError":
    case "DevicesNotFoundError":
      return new CameraAdapterError("camera_not_found");
    case "NotReadableError":
    case "TrackStartError":
      return new CameraAdapterError("camera_in_use");
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return new CameraAdapterError("camera_constraints_unsupported");
    default:
      return new CameraAdapterError("camera_unavailable");
  }
}

function isOverconstrainedError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }
  return error.name === "OverconstrainedError" || error.name === "ConstraintNotSatisfiedError";
}

function positiveFiniteOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function buildCapabilitiesReport(track: MediaStreamTrackLike): CameraCapabilitiesReport {
  const rawCapabilities = track.getCapabilities?.();
  const rawSettings = track.getSettings?.();

  const torchSupported = rawCapabilities?.torch === true;
  const zoomRange = rawCapabilities?.zoom;
  const minZoomRaw = zoomRange?.min;
  const maxZoomRaw = zoomRange?.max;
  const zoomSupported =
    typeof minZoomRaw === "number" &&
    typeof maxZoomRaw === "number" &&
    Number.isFinite(minZoomRaw) &&
    Number.isFinite(maxZoomRaw) &&
    maxZoomRaw > minZoomRaw;

  const continuousFocusSupported =
    Array.isArray(rawCapabilities?.focusMode) &&
    rawCapabilities.focusMode.includes("continuous");

  const width =
    positiveFiniteOrZero(rawSettings?.width) ||
    positiveFiniteOrZero(rawCapabilities?.width?.max);
  const height =
    positiveFiniteOrZero(rawSettings?.height) ||
    positiveFiniteOrZero(rawCapabilities?.height?.max);

  return {
    torchSupported,
    zoomSupported,
    minZoom: zoomSupported ? minZoomRaw : 1,
    maxZoom: zoomSupported ? maxZoomRaw : 1,
    continuousFocusSupported,
    width,
    height,
  };
}

function stopAllStreamTracks(stream: MediaStreamLike): void {
  const seen = new Set<MediaStreamTrackLike>();
  const tracks = stream.getTracks?.() ?? [];
  for (const track of tracks) {
    if (!seen.has(track)) {
      seen.add(track);
      track.stop();
    }
  }
  for (const track of stream.getVideoTracks()) {
    if (!seen.has(track)) {
      seen.add(track);
      track.stop();
    }
  }
}

function resolveDefaultMediaDevices(): MediaDevicesLike | null {
  if (typeof navigator === "undefined") {
    return null;
  }
  return navigator.mediaDevices ?? null;
}

function resolveDefaultVisibilitySource(): DocumentVisibilityLike | null {
  if (typeof document === "undefined") {
    return null;
  }
  if (
    typeof document.visibilityState === "string" &&
    typeof document.addEventListener === "function" &&
    typeof document.removeEventListener === "function"
  ) {
    return document;
  }
  return null;
}

/**
 * Manages rear camera acquisition, capability-gated focus/torch/zoom controls,
 * and clean lifecycle handling across track termination, device changes, and page visibility.
 */
export class CameraAdapter {
  private readonly mediaDevices: MediaDevicesLike | null;
  private readonly visibilitySource: DocumentVisibilityLike | null;
  private readonly listeners = new Set<(event: CameraEvent) => void>();

  private activeStream: MediaStreamLike | null = null;
  private activeTrack: MediaStreamTrackLike | null = null;
  private capabilities: CameraCapabilitiesReport | null = null;
  private running = false;
  private pausedForVisibility = false;
  private visibilityListenerAttached = false;
  private deviceChangeListenerAttached = false;
  private lifecycleEpoch = 0;

  private readonly handleTrackEnded = (): void => {
    this.handleStreamInterruption();
  };

  private readonly handleDeviceChange = (): void => {
    if (!this.running || this.activeTrack === null || this.activeStream === null) {
      return;
    }
    const videoTracks = this.activeStream.getVideoTracks();
    const trackEnded =
      this.activeTrack.readyState === "ended" ||
      this.activeStream.active === false ||
      videoTracks.length === 0;
    if (trackEnded) {
      this.handleStreamInterruption();
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (!this.visibilitySource) {
      return;
    }
    if (this.visibilitySource.visibilityState === "hidden") {
      if (this.running) {
        this.pauseForVisibility();
      }
      return;
    }
    if (this.visibilitySource.visibilityState === "visible" && this.pausedForVisibility) {
      void this.resumeFromVisibility();
    }
  };

  constructor(options: CameraAdapterOptions = {}) {
    this.mediaDevices =
      options.mediaDevices !== undefined ? options.mediaDevices : resolveDefaultMediaDevices();
    this.visibilitySource =
      options.visibilitySource !== undefined
        ? options.visibilitySource
        : resolveDefaultVisibilitySource();
  }

  subscribe(listener: (event: CameraEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStream(): MediaStreamLike | null {
    return this.activeStream;
  }

  getCapabilities(): CameraCapabilitiesReport | null {
    return this.capabilities;
  }

  isRunning(): boolean {
    return this.running;
  }

  isPausedForVisibility(): boolean {
    return this.pausedForVisibility;
  }

  /**
   * Acquires the rear camera stream, configures continuous focus when supported,
   * and attaches lifecycle listeners. Falls back to basic environment constraints
   * when `OverconstrainedError` occurs on low-tier devices.
   */
  async start(): Promise<CameraCapabilitiesReport> {
    this.releaseActiveStream(true);
    this.pausedForVisibility = false;
    const epoch = ++this.lifecycleEpoch;

    const capabilities = await this.acquireStream(epoch);
    this.attachVisibilityListener();
    this.emit({ type: "started", capabilities });
    return capabilities;
  }

  /**
   * Idempotently stops all active tracks, removes all event listeners,
   * and resets internal state so repeated cycles do not leak resources.
   */
  stop(): void {
    const hadActivity =
      this.running ||
      this.pausedForVisibility ||
      this.activeStream !== null ||
      this.visibilityListenerAttached ||
      this.deviceChangeListenerAttached;

    this.lifecycleEpoch += 1;
    this.pausedForVisibility = false;
    this.detachVisibilityListener();
    this.releaseActiveStream(true);

    if (hadActivity) {
      this.emit({ type: "stopped" });
    }
  }

  /** Enables or disables the camera torch only when supported by track capabilities. */
  async setTorch(enabled: boolean): Promise<boolean> {
    if (
      !this.running ||
      !this.activeTrack ||
      !this.capabilities?.torchSupported ||
      typeof this.activeTrack.applyConstraints !== "function"
    ) {
      return false;
    }

    try {
      await this.activeTrack.applyConstraints({
        advanced: [{ torch: enabled }],
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Sets digital/optical zoom clamped to reported `[minZoom, maxZoom]` when supported. */
  async setZoom(factor: number): Promise<boolean> {
    if (
      !this.running ||
      !this.activeTrack ||
      !this.capabilities?.zoomSupported ||
      !Number.isFinite(factor) ||
      typeof this.activeTrack.applyConstraints !== "function"
    ) {
      return false;
    }

    const clamped = Math.min(
      this.capabilities.maxZoom,
      Math.max(this.capabilities.minZoom, factor),
    );

    try {
      await this.activeTrack.applyConstraints({
        advanced: [{ zoom: clamped }],
      });
      return true;
    } catch {
      return false;
    }
  }

  private async acquireStream(epoch: number): Promise<CameraCapabilitiesReport> {
    if (!this.mediaDevices || typeof this.mediaDevices.getUserMedia !== "function") {
      const error = new CameraAdapterError("camera_unavailable");
      this.emit({ type: "error", error });
      throw error;
    }

    let stream: MediaStreamLike;
    try {
      stream = await this.negotiateStream(this.mediaDevices);
    } catch (rawError) {
      const mapped = mapCameraError(rawError);
      if (epoch === this.lifecycleEpoch) {
        this.emit({ type: "error", error: mapped });
      }
      throw mapped;
    }

    if (epoch !== this.lifecycleEpoch) {
      stopAllStreamTracks(stream);
      throw new CameraAdapterError("camera_track_ended", "Camera start was cancelled.");
    }

    const videoTracks = stream.getVideoTracks();
    const primaryTrack = videoTracks[0];
    if (!primaryTrack) {
      stopAllStreamTracks(stream);
      const error = new CameraAdapterError("camera_not_found");
      this.emit({ type: "error", error });
      throw error;
    }

    const report = buildCapabilitiesReport(primaryTrack);

    if (
      report.continuousFocusSupported &&
      typeof primaryTrack.applyConstraints === "function"
    ) {
      try {
        await primaryTrack.applyConstraints({
          advanced: [{ focusMode: "continuous" }],
        });
      } catch {
        // Ignore continuous focus rejection on platforms with partial capability support.
      }
    }

    if (epoch !== this.lifecycleEpoch) {
      stopAllStreamTracks(stream);
      throw new CameraAdapterError("camera_track_ended", "Camera start was cancelled.");
    }

    this.activeStream = stream;
    this.activeTrack = primaryTrack;
    this.capabilities = report;
    this.running = true;

    primaryTrack.addEventListener?.("ended", this.handleTrackEnded);
    this.attachDeviceChangeListener();

    return report;
  }

  private async negotiateStream(mediaDevices: MediaDevicesLike): Promise<MediaStreamLike> {
    try {
      return await mediaDevices.getUserMedia(PRIMARY_CAMERA_CONSTRAINTS);
    } catch (primaryError) {
      if (!isOverconstrainedError(primaryError)) {
        throw primaryError;
      }
      return await mediaDevices.getUserMedia(FALLBACK_CAMERA_CONSTRAINTS);
    }
  }

  private pauseForVisibility(): void {
    this.lifecycleEpoch += 1;
    this.pausedForVisibility = true;
    this.releaseActiveStream(true);
    this.emit({ type: "paused" });
  }

  private async resumeFromVisibility(): Promise<void> {
    const epoch = ++this.lifecycleEpoch;
    this.pausedForVisibility = false;

    try {
      const capabilities = await this.acquireStream(epoch);
      if (epoch === this.lifecycleEpoch) {
        this.emit({ type: "resumed", capabilities });
      }
    } catch {
      if (epoch === this.lifecycleEpoch) {
        this.detachVisibilityListener();
      }
    }
  }

  private handleStreamInterruption(): void {
    if (!this.running && this.activeStream === null) {
      return;
    }
    this.lifecycleEpoch += 1;
    this.pausedForVisibility = false;
    this.detachVisibilityListener();
    this.releaseActiveStream(true);
    this.emit({
      type: "error",
      error: new CameraAdapterError("camera_track_ended"),
    });
  }

  private releaseActiveStream(stopTracks: boolean): void {
    const track = this.activeTrack;
    const stream = this.activeStream;

    this.activeTrack = null;
    this.activeStream = null;
    this.capabilities = null;
    this.running = false;

    if (track) {
      track.removeEventListener?.("ended", this.handleTrackEnded);
    }
    this.detachDeviceChangeListener();

    if (stopTracks && stream) {
      stopAllStreamTracks(stream);
    }
  }

  private attachVisibilityListener(): void {
    if (this.visibilitySource && !this.visibilityListenerAttached) {
      this.visibilitySource.addEventListener("visibilitychange", this.handleVisibilityChange);
      this.visibilityListenerAttached = true;
    }
  }

  private detachVisibilityListener(): void {
    if (this.visibilitySource && this.visibilityListenerAttached) {
      this.visibilitySource.removeEventListener("visibilitychange", this.handleVisibilityChange);
      this.visibilityListenerAttached = false;
    }
  }

  private attachDeviceChangeListener(): void {
    if (this.mediaDevices?.addEventListener && !this.deviceChangeListenerAttached) {
      this.mediaDevices.addEventListener("devicechange", this.handleDeviceChange);
      this.deviceChangeListenerAttached = true;
    }
  }

  private detachDeviceChangeListener(): void {
    if (this.mediaDevices?.removeEventListener && this.deviceChangeListenerAttached) {
      this.mediaDevices.removeEventListener("devicechange", this.handleDeviceChange);
      this.deviceChangeListenerAttached = false;
    }
  }

  private emit(event: CameraEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
