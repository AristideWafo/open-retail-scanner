import {
  ConsensusTracker,
  assertPrivacySafePayload,
  validateDiagnosticEvent,
  validateFrameBounds,
  type BarcodeFormat,
  type ConsensusOptions,
  type DiagnosticEvent,
  type DiagnosticStage,
  type DurationMsBand,
  type FailureCategory,
  type PlatformClass,
  type ReplayEngineAdapter,
  type ReplayFrame,
  type ScanResult,
  type ScannerEvent,
} from "open-retail-scanner-core";
import {
  CameraAdapter,
  mapCameraError,
  type CameraAdapterOptions,
  type CameraEvent,
  type DocumentVisibilityLike,
  type MediaDevicesLike,
  type MediaStreamLike,
} from "./camera.ts";
import {
  NativeBarcodeDetectorAdapter,
  isNativeBarcodeDetectorSupported,
  type NativeBarcodeDetectorConstructor,
} from "./native-detector.ts";
import {
  LatestFrameScheduler,
  assertNoBase64OrJpeg,
  type FrameInput,
  type SchedulerMetrics,
  type WorkerTransport,
} from "./scheduler.ts";
import {
  ScannerUIController,
  mountScannerUI,
  type ManualSubmitResult,
  type ScannerDomView,
  type ScannerUIState,
} from "./ui.ts";
import {
  ZXING_ENGINE_VERSION,
  ZxingWasmAdapter,
  type ZxingAdapterOptions,
} from "./zxing-adapter.ts";

export {
  ZXING_ENGINE_VERSION,
  ZxingWasmAdapter,
  loadLocalZxingWasmBinary,
  renderLinearBarcodeFrame,
  type ZxingAdapterOptions,
} from "./zxing-adapter.ts";

export {
  REQUIRED_NATIVE_FORMATS,
  NativeBarcodeDetectorAdapter,
  isNativeBarcodeDetectorSupported,
  type NativeBarcodeDetectorAdapterOptions,
  type NativeBarcodeDetectorConstructor,
  type NativeBarcodeDetectorInstance,
  type NativeBarcodeDetectorOptions,
  type NativeDetectedBarcode,
  type NativeBarcodeFormat,
} from "./native-detector.ts";

export {
  LONG_TASK_THRESHOLD_MS,
  LatestFrameScheduler,
  assertNoBase64OrJpeg,
  attachDecoderWorkerScope,
  createWebWorkerTransport,
  type FrameInput,
  type LatestFrameSchedulerOptions,
  type SchedulerMetrics,
  type WebWorkerLike,
  type WebWorkerTransportOptions,
  type WorkerGlobalScopeLike,
  type WorkerTransport,
} from "./scheduler.ts";

export {
  CameraAdapter,
  CameraAdapterError,
  FALLBACK_CAMERA_CONSTRAINTS,
  PRIMARY_CAMERA_CONSTRAINTS,
  mapCameraError,
  type CameraAdapterOptions,
  type CameraCapabilitiesReport,
  type CameraErrorCode,
  type CameraEvent,
  type CameraStreamConstraintsLike,
  type DocumentVisibilityLike,
  type MediaDevicesLike,
  type MediaStreamLike,
  type MediaStreamTrackLike,
  type MediaTrackConstraintSetLike,
  type MediaTrackConstraintsLike,
  type TrackCapabilitiesLike,
  type TrackSettingsLike,
} from "./camera.ts";

export {
  GUIDANCE_MESSAGES,
  MANUAL_ENTRY_ENGINE_VERSION,
  ScannerUIController,
  getAccessibleErrorMessage,
  getGuidanceMessage,
  mountScannerUI,
  type ManualSubmitResult,
  type ScannerDomView,
  type ScannerFocusTarget,
  type ScannerUIControllerOptions,
  type ScannerUILifecycleState,
  type ScannerUIState,
} from "./ui.ts";

export {
  TARGET_DEVICE_PROFILES,
  buildRecordedClipManifestEntry,
  hashProductIdentity,
  sha256HexFromBytes,
  verifyGroundTruth,
  type BuildRecordedClipParams,
  type DeviceRuntimeProfile,
  type GroundTruthObservation,
  type RecordedClipResult,
  type TargetDeviceId,
  type VerifiedGroundTruth,
} from "./clip-recorder.ts";

const WEB_SDK_VERSION = "0.0.0";
const DEFAULT_FORMATS: readonly BarcodeFormat[] = ["ean8", "ean13", "upca"];
const DEFAULT_REQUIRED_CONFIRMING_FRAMES = 2;
const DEFAULT_CONSENSUS_WINDOW_MS = 1500;
const DEFAULT_DUPLICATE_COOLDOWN_MS = 2000;

export interface VideoFrameSourceLike {
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly readyState?: number;
  srcObject?: unknown;
  play?(): Promise<void>;
  requestVideoFrameCallback?(callback: (now: number) => void): number;
  cancelVideoFrameCallback?(handle: number): void;
}

export type FrameExtractorFn = (
  video: VideoFrameSourceLike,
  timestampMs: number,
) => ReplayFrame | null;

export interface ScannerOptions {
  readonly formats?: readonly BarcodeFormat[];
  readonly requiredConfirmingFrames?: number;
  readonly consensusWindowMs?: number;
  readonly duplicateCooldownMs?: number;
  readonly preferNativeDetector?: boolean;
  readonly detectorCtor?: NativeBarcodeDetectorConstructor;
  readonly zxingOptions?: ZxingAdapterOptions;
  readonly mediaDevices?: MediaDevicesLike | null;
  readonly visibilitySource?: DocumentVisibilityLike | null;
  readonly workerTransport?: WorkerTransport;
  readonly createWorkerTransport?: () => WorkerTransport;
  readonly videoElement?: VideoFrameSourceLike | null;
  readonly frameExtractor?: FrameExtractorFn;
  readonly onEvent?: (event: ScannerEvent) => void;
}

function detectPlatformClass(): PlatformClass {
  if (typeof globalThis.process?.versions?.node === "string") {
    return "ci_node";
  }
  if (typeof navigator !== "undefined" && typeof navigator.userAgent === "string") {
    const ua = navigator.userAgent;
    if (/iphone|ipad|ipod/i.test(ua)) {
      return "ios_safari";
    }
    if (/android/i.test(ua)) {
      return "android_chrome";
    }
    return "desktop_web";
  }
  return "desktop_web";
}

function toDurationMsBand(durationMs: number): DurationMsBand {
  if (durationMs < 10) return "0_10";
  if (durationMs < 50) return "10_50";
  if (durationMs < 200) return "50_200";
  return "200_plus";
}

function hasUsableMediaDevices(option: MediaDevicesLike | null | undefined): boolean {
  if (option !== undefined) {
    return option !== null;
  }
  if (typeof navigator === "undefined") {
    return false;
  }
  return navigator.mediaDevices !== undefined && navigator.mediaDevices !== null;
}

/**
 * High-level web barcode scanner orchestrating camera acquisition, off-thread/latest-frame
 * scheduling, native-first + WASM fallback decoding, multi-frame consensus, UI state,
 * and privacy-safe diagnostics.
 */
export class WebBarcodeScanner {
  private readonly allowedFormats: ReadonlySet<BarcodeFormat>;
  private readonly preferNativeDetector: boolean;
  private readonly detectorCtor: NativeBarcodeDetectorConstructor | undefined;
  private readonly hasMediaDevices: boolean;
  private readonly zxingAdapter: ZxingWasmAdapter;
  private readonly decoder: ReplayEngineAdapter;
  private readonly camera: CameraAdapter;
  private readonly consensus: ConsensusTracker;
  private readonly scheduler: LatestFrameScheduler;
  private readonly ui: ScannerUIController;
  private readonly frameExtractor: FrameExtractorFn | undefined;
  private readonly listeners = new Set<(event: ScannerEvent) => void>();
  private readonly unsubscribeCamera: () => void;

  private videoElement: VideoFrameSourceLike | null;
  private activeEngineVersion: string = ZXING_ENGINE_VERSION;
  private featureBarcodeDetector = false;
  private lastStage: DiagnosticStage = "init";
  private lastFailureCategory: FailureCategory | undefined = undefined;
  private lifecycleEpoch = 0;
  private pumpGeneration = 0;
  private pumpCancel: (() => void) | null = null;
  private captureCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private captureCtx:
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null = null;
  private hasStartedOnce = false;
  private acceptingFrames = false;
  private acquiringCamera = false;
  private suppressUiOnResult = false;
  private disposed = false;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;

  constructor(options: ScannerOptions = {}) {
    const formats =
      options.formats && options.formats.length > 0
        ? [...options.formats]
        : options.zxingOptions?.formats && options.zxingOptions.formats.length > 0
          ? [...options.zxingOptions.formats]
          : [...DEFAULT_FORMATS];

    this.allowedFormats = new Set(formats);
    this.preferNativeDetector = options.preferNativeDetector !== false;
    this.detectorCtor = options.detectorCtor;
    this.hasMediaDevices = hasUsableMediaDevices(options.mediaDevices);
    this.frameExtractor = options.frameExtractor;
    this.videoElement = options.videoElement ?? null;

    const zxingOptions: ZxingAdapterOptions = {
      ...(options.zxingOptions ?? {}),
      formats,
    };
    this.zxingAdapter = new ZxingWasmAdapter(zxingOptions);

    if (this.preferNativeDetector) {
      this.decoder = new NativeBarcodeDetectorAdapter({
        detectorCtor: this.detectorCtor,
        fallbackAdapter: this.zxingAdapter,
      });
    } else {
      this.decoder = this.zxingAdapter;
    }

    const consensusOptions: ConsensusOptions = {
      requiredConfirmingFrames:
        options.requiredConfirmingFrames ?? DEFAULT_REQUIRED_CONFIRMING_FRAMES,
      windowMs: options.consensusWindowMs ?? DEFAULT_CONSENSUS_WINDOW_MS,
      duplicateCooldownMs:
        options.duplicateCooldownMs ?? DEFAULT_DUPLICATE_COOLDOWN_MS,
    };
    this.consensus = new ConsensusTracker(consensusOptions);

    const cameraOptions: CameraAdapterOptions = {
      ...(options.mediaDevices !== undefined ? { mediaDevices: options.mediaDevices } : {}),
      ...(options.visibilitySource !== undefined
        ? { visibilitySource: options.visibilitySource }
        : {}),
    };
    this.camera = new CameraAdapter(cameraOptions);

    this.ui = new ScannerUIController({
      initialFormat: formats[0] ?? "ean13",
      onResult: (result) => {
        if (!this.suppressUiOnResult) {
          this.notifyListeners({ type: "result", result });
        }
      },
      onStop: () => {
        void this.stop();
      },
      onRetry: () => {
        void this.start();
      },
      onTorchChange: (enabled) => this.camera.setTorch(enabled),
      onZoomChange: (factor) => this.camera.setZoom(factor),
    });

    this.scheduler = new LatestFrameScheduler({
      decodeFrame: (frame) => this.decoder.decodeFrame(frame),
      workerTransport: options.workerTransport,
      createWorkerTransport: options.createWorkerTransport,
      onResult: (decoded, timestampMs) => {
        this.handleDecodedFrame(decoded, timestampMs);
      },
      onError: (error) => {
        this.handleDecodeError(error);
      },
    });

    this.unsubscribeCamera = this.camera.subscribe((cameraEvent) => {
      this.handleCameraEvent(cameraEvent);
    });

    if (options.onEvent !== undefined) {
      this.listeners.add(options.onEvent);
    }
  }

  subscribe(listener: (event: ScannerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStream(): MediaStreamLike | null {
    return this.camera.getStream();
  }

  getUIController(): ScannerUIController {
    return this.ui;
  }

  attachVideoElement(video: VideoFrameSourceLike | null): void {
    if (this.videoElement !== null && this.videoElement !== video) {
      this.videoElement.srcObject = null;
    }
    this.stopFramePump();
    this.videoElement = video;
    if (video === null) {
      return;
    }
    const stream = this.camera.getStream();
    if (stream !== null) {
      video.srcObject = stream;
      video.play?.()?.catch?.(() => {});
    }
    if (this.acceptingFrames && !this.disposed) {
      this.startFramePump();
    }
  }

  mount(root: HTMLElement): ScannerDomView {
    const view = mountScannerUI(this.ui, root);
    const videoEl = view.getVideoElement() as unknown as VideoFrameSourceLike;
    this.attachVideoElement(videoEl);
    return {
      getVideoElement(): HTMLVideoElement {
        return view.getVideoElement();
      },
      setStream: (stream: unknown | null): void => {
        view.setStream(stream);
      },
      destroy: (): void => {
        if (this.videoElement === videoEl) {
          this.attachVideoElement(null);
        }
        view.destroy();
      },
    };
  }

  async start(): Promise<void> {
    if (this.disposed) {
      throw new Error("WebBarcodeScanner has been disposed");
    }
    if (this.stopPromise !== null) {
      await this.stopPromise;
    }
    if (this.startPromise !== null) {
      return this.startPromise;
    }
    if (this.ui.getState().state === "running") {
      return;
    }

    const epoch = ++this.lifecycleEpoch;
    this.hasStartedOnce = true;

    const runStart = async (): Promise<void> => {
      this.lastStage = "init";
      this.lastFailureCategory = undefined;
      this.consensus.reset();
      this.emitEvent({ type: "state", state: "starting" });

      try {
        if (this.preferNativeDetector) {
          this.featureBarcodeDetector = await isNativeBarcodeDetectorSupported(
            this.detectorCtor,
          );
        } else {
          this.featureBarcodeDetector = false;
        }
        await this.decoder.init?.();
      } catch {
        if (epoch !== this.lifecycleEpoch) {
          return;
        }
        this.lastFailureCategory = "engine";
        this.emitEvent({
          type: "error",
          code: "engine_load_failed",
          recoverable: true,
        });
        this.ui.openManualEntry();
        return;
      }

      if (epoch !== this.lifecycleEpoch) {
        return;
      }

      this.activeEngineVersion = this.featureBarcodeDetector
        ? `${this.decoder.engineName}@${this.decoder.engineVersion}`
        : ZXING_ENGINE_VERSION;

      if (this.hasMediaDevices) {
        this.lastStage = "camera";
        this.acquiringCamera = true;
        try {
          const capabilities = await this.camera.start();
          if (epoch !== this.lifecycleEpoch) {
            this.camera.stop();
            return;
          }
          this.ui.setCapabilities(capabilities);
          if (this.videoElement !== null) {
            const stream = this.camera.getStream();
            if (stream !== null) {
              this.videoElement.srcObject = stream;
              this.videoElement.play?.()?.catch?.(() => {});
            }
          }
        } catch (error) {
          await this.decoder.dispose?.();
          if (this.decoder !== this.zxingAdapter) {
            await this.zxingAdapter.dispose();
          }
          if (epoch !== this.lifecycleEpoch) {
            return;
          }
          const mapped = mapCameraError(error);
          this.lastFailureCategory =
            mapped.code === "camera_permission_denied"
              ? "permission"
              : "camera_lifecycle";
          this.emitEvent({
            type: "error",
            code: mapped.code,
            recoverable: true,
          });
          this.ui.openManualEntry();
          return;
        } finally {
          this.acquiringCamera = false;
        }
      }

      if (epoch !== this.lifecycleEpoch) {
        this.camera.stop();
        return;
      }

      this.scheduler.start();
      this.acceptingFrames = true;
      this.startFramePump();
      this.emitEvent({ type: "state", state: "running" });
    };

    this.startPromise = runStart().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  submitFrame(input: FrameInput): void {
    let closed = false;
    const closeOnce = (): void => {
      if (!closed) {
        closed = true;
        input.close?.();
      }
    };

    try {
      assertNoBase64OrJpeg(input.frame);
      validateFrameBounds(
        input.frame.width,
        input.frame.height,
        input.frame.data.byteLength,
      );
    } catch (error) {
      closeOnce();
      this.lastStage = "decode";
      this.lastFailureCategory =
        error instanceof RangeError ? "oversized_input" : "engine";
      throw error;
    }

    if (!this.acceptingFrames || this.disposed) {
      closeOnce();
      return;
    }

    this.lastStage = "decode";
    this.scheduler.submit({
      frame: input.frame,
      close: closeOnce,
    });
  }

  submitManualCode(rawValue: string, format?: BarcodeFormat): ManualSubmitResult {
    return this.ui.submitManualEntry(rawValue, format);
  }

  setTorch(enabled: boolean): Promise<boolean> {
    return this.ui.setTorchEnabled(enabled);
  }

  setZoom(factor: number): Promise<boolean> {
    return this.ui.setZoomFactor(factor);
  }

  getState(): ScannerUIState {
    return this.ui.getState();
  }

  getMetrics(): SchedulerMetrics {
    return this.scheduler.getMetrics();
  }

  getDiagnostics(): DiagnosticEvent {
    const candidate = {
      sdkVersion: WEB_SDK_VERSION,
      engineVersion: this.activeEngineVersion,
      platformClass: detectPlatformClass(),
      stage: this.lastStage,
      durationMsBand: toDurationMsBand(this.scheduler.lastDecodeDurationMs),
      featureBarcodeDetector: this.featureBarcodeDetector,
      ...(this.lastFailureCategory !== undefined
        ? { failureCategory: this.lastFailureCategory }
        : {}),
    };

    assertPrivacySafePayload(candidate);
    return validateDiagnosticEvent(candidate);
  }

  async stop(): Promise<void> {
    if (this.stopPromise !== null) {
      return this.stopPromise;
    }

    const runStop = async (): Promise<void> => {
      this.lifecycleEpoch += 1;
      this.acceptingFrames = false;
      this.stopFramePump();
      if (this.videoElement !== null) {
        this.videoElement.srcObject = null;
      }
      this.captureCanvas = null;
      this.captureCtx = null;
      const currentState = this.ui.getState().state;
      const shouldEmitStopped =
        this.hasStartedOnce &&
        currentState !== "stopped" &&
        currentState !== "idle";

      this.lastStage = "teardown";
      this.camera.stop();
      await this.scheduler.stop();
      await this.decoder.dispose?.();
      if (this.decoder !== this.zxingAdapter) {
        await this.zxingAdapter.dispose();
      }
      this.consensus.reset();

      if (shouldEmitStopped) {
        this.emitEvent({ type: "state", state: "stopped" });
      }
    };

    this.stopPromise = runStop().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stop();
    await this.scheduler.dispose();
    this.videoElement = null;
    this.unsubscribeCamera();
    this.listeners.clear();
  }

  private handleCameraEvent(event: CameraEvent): void {
    if (event.type === "started") {
      this.ui.setCapabilities(event.capabilities);
      return;
    }

    if (event.type === "paused") {
      this.acceptingFrames = false;
      this.stopFramePump();
      void this.scheduler.stop();
      if (this.videoElement !== null) {
        this.videoElement.srcObject = null;
      }
      return;
    }

    if (event.type === "resumed") {
      this.ui.setCapabilities(event.capabilities);
      if (this.videoElement !== null) {
        const stream = this.camera.getStream();
        this.videoElement.srcObject = stream;
        if (stream !== null) {
          this.videoElement.play?.()?.catch?.(() => {});
        }
      }
      this.scheduler.start();
      this.acceptingFrames = true;
      this.startFramePump();
      return;
    }

    if (event.type === "error" && !this.acquiringCamera) {
      this.acceptingFrames = false;
      this.stopFramePump();
      if (this.videoElement !== null) {
        this.videoElement.srcObject = null;
      }
      this.lastStage = "camera";
      this.lastFailureCategory =
        event.error.code === "camera_permission_denied"
          ? "permission"
          : "camera_lifecycle";
      void this.scheduler.stop();
      this.emitEvent({
        type: "error",
        code: event.error.code,
        recoverable: event.error.recoverable,
      });
      this.ui.openManualEntry();
    }
  }

  private handleDecodedFrame(
    decoded: {
      readonly rawValue: string;
      readonly format: BarcodeFormat;
      readonly bounds?: readonly { readonly x: number; readonly y: number }[];
    } | null,
    timestampMs: number,
  ): void {
    this.lastStage = "decode";
    this.lastFailureCategory = undefined;

    if (decoded === null || !this.allowedFormats.has(decoded.format)) {
      return;
    }

    const engineVersion =
      "getActiveEngineVersion" in this.decoder &&
      typeof (this.decoder as { getActiveEngineVersion?: () => string })
        .getActiveEngineVersion === "function"
        ? (
            this.decoder as { getActiveEngineVersion: () => string }
          ).getActiveEngineVersion()
        : this.activeEngineVersion;

    const result: ScanResult | null = this.consensus.observe({
      rawValue: decoded.rawValue,
      format: decoded.format,
      timestampMs,
      engineVersion,
      ...(decoded.bounds !== undefined ? { bounds: decoded.bounds } : {}),
    });

    if (result !== null) {
      this.lastStage = "consensus";
      this.emitEvent({ type: "result", result });
    }
  }

  private startFramePump(): void {
    if (!this.acceptingFrames || this.disposed || this.videoElement === null) {
      return;
    }
    if (this.pumpCancel !== null) {
      return;
    }
    this.scheduleNextFrameTick(this.pumpGeneration);
  }

  private stopFramePump(): void {
    this.pumpGeneration += 1;
    const cancel = this.pumpCancel;
    this.pumpCancel = null;
    cancel?.();
  }

  private scheduleNextFrameTick(generation: number): void {
    if (
      generation !== this.pumpGeneration ||
      !this.acceptingFrames ||
      this.disposed ||
      this.videoElement === null
    ) {
      this.pumpCancel = null;
      return;
    }

    const video = this.videoElement;
    const onTick = (nowMs: number): void => {
      this.pumpCancel = null;
      if (
        generation !== this.pumpGeneration ||
        !this.acceptingFrames ||
        this.disposed ||
        this.videoElement !== video
      ) {
        return;
      }

      if (
        this.scheduler.queueDepth === 0 &&
        this.scheduler.inFlightCount === 0 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        const timestampMs =
          Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now();
        const frame = this.extractVideoFrame(video, timestampMs);
        if (frame !== null) {
          try {
            this.submitFrame({ frame });
          } catch {
            // Invalid or oversized frames update diagnostics via submitFrame().
          }
        }
      }

      this.scheduleNextFrameTick(generation);
    };

    if (typeof video.requestVideoFrameCallback === "function") {
      let fired = false;
      const handle = video.requestVideoFrameCallback((now) => {
        fired = true;
        onTick(now);
      });
      if (!fired && generation === this.pumpGeneration) {
        this.pumpCancel = () => {
          video.cancelVideoFrameCallback?.(handle);
        };
      }
      return;
    }

    if (typeof globalThis.requestAnimationFrame === "function") {
      let fired = false;
      const handle = globalThis.requestAnimationFrame((now) => {
        fired = true;
        onTick(now);
      });
      if (!fired && generation === this.pumpGeneration) {
        this.pumpCancel = () => {
          globalThis.cancelAnimationFrame?.(handle);
        };
      }
      return;
    }

    const handle = setTimeout(() => {
      onTick(performance.now());
    }, 33);
    this.pumpCancel = () => {
      clearTimeout(handle);
    };
  }

  private extractVideoFrame(
    video: VideoFrameSourceLike,
    timestampMs: number,
  ): ReplayFrame | null {
    if (this.frameExtractor !== undefined) {
      return this.frameExtractor(video, timestampMs);
    }

    const width = Math.floor(video.videoWidth);
    const height = Math.floor(video.videoHeight);
    if (width <= 0 || height <= 0) {
      return null;
    }

    if (this.captureCanvas === null) {
      if (typeof OffscreenCanvas === "function") {
        this.captureCanvas = new OffscreenCanvas(width, height);
      } else if (
        typeof document !== "undefined" &&
        typeof document.createElement === "function"
      ) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        this.captureCanvas = canvas;
      } else {
        return null;
      }
      this.captureCtx = this.captureCanvas.getContext("2d", {
        willReadFrequently: true,
      }) as
        | OffscreenCanvasRenderingContext2D
        | CanvasRenderingContext2D
        | null;
    }

    if (this.captureCtx === null) {
      return null;
    }

    if (this.captureCanvas.width !== width) {
      this.captureCanvas.width = width;
    }
    if (this.captureCanvas.height !== height) {
      this.captureCanvas.height = height;
    }

    this.captureCtx.drawImage(
      video as unknown as CanvasImageSource,
      0,
      0,
      width,
      height,
    );
    const imageData = this.captureCtx.getImageData(0, 0, width, height);
    return {
      timestampMs,
      width,
      height,
      data: imageData.data,
    };
  }

  private handleDecodeError(error: unknown): void {
    this.lastStage = "decode";
    this.lastFailureCategory =
      error instanceof RangeError ? "oversized_input" : "engine";
    this.emitEvent({
      type: "error",
      code: "internal_error",
      recoverable: true,
    });
  }

  private emitEvent(event: ScannerEvent): void {
    this.suppressUiOnResult = true;
    try {
      this.ui.handleScannerEvent(event);
    } finally {
      this.suppressUiOnResult = false;
    }
    this.notifyListeners(event);
  }

  private notifyListeners(event: ScannerEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
