import {
  isValidCode,
  validateFrameBounds,
  type BarcodeFormat,
  type PeakMemoryClass,
  type Point,
  type ReplayDecodeResult,
  type ReplayEngineAdapter,
  type ReplayFrame,
} from "open-retail-scanner-core";

/**
 * Required Web Barcode Detection API symbology names for retail EAN/UPC scanning
 * (ADR 0003).
 */
export const REQUIRED_NATIVE_FORMATS = ["ean_8", "ean_13", "upc_a"] as const;

export type NativeBarcodeFormat = (typeof REQUIRED_NATIVE_FORMATS)[number];

const NATIVE_FORMAT_MAP: Readonly<Record<string, BarcodeFormat>> = {
  ean_8: "ean8",
  ean_13: "ean13",
  upc_a: "upca",
};

/** Subset of the W3C Shape Detection `DetectedBarcode` object consumed by this adapter. */
export interface NativeDetectedBarcode {
  readonly rawValue: string;
  readonly format: string;
  readonly cornerPoints?: readonly Point[] | undefined;
}

/** Options accepted by the Web `BarcodeDetector` constructor. */
export interface NativeBarcodeDetectorOptions {
  readonly formats?: readonly string[] | undefined;
}

/** Instance shape of the Web `BarcodeDetector` API. */
export interface NativeBarcodeDetectorInstance {
  detect(image: unknown): Promise<readonly NativeDetectedBarcode[]>;
}

/** Constructor shape of the Web `BarcodeDetector` API. */
export interface NativeBarcodeDetectorConstructor {
  new (options?: NativeBarcodeDetectorOptions): NativeBarcodeDetectorInstance;
  getSupportedFormats(): Promise<readonly string[]>;
}

/** Configuration for {@link NativeBarcodeDetectorAdapter}. */
export interface NativeBarcodeDetectorAdapterOptions {
  readonly detectorCtor?: NativeBarcodeDetectorConstructor | undefined;
  readonly fallbackAdapter?: ReplayEngineAdapter | undefined;
  readonly engineName?: string | undefined;
  readonly engineVersion?: string | undefined;
  readonly buildId?: string | undefined;
  readonly configurationId?: string | undefined;
}

function resolveDetectorCtor(
  detectorCtor?: NativeBarcodeDetectorConstructor | undefined,
): NativeBarcodeDetectorConstructor | undefined {
  return (
    detectorCtor ??
    (globalThis as { BarcodeDetector?: NativeBarcodeDetectorConstructor })
      .BarcodeDetector
  );
}

/**
 * Feature-detects native `BarcodeDetector` support and verifies that all
 * required retail formats (`ean_8`, `ean_13`, `upc_a`) are supported.
 */
export async function isNativeBarcodeDetectorSupported(
  detectorCtor?: NativeBarcodeDetectorConstructor | undefined,
): Promise<boolean> {
  const Ctor = resolveDetectorCtor(detectorCtor);
  if (
    typeof Ctor !== "function" ||
    typeof Ctor.getSupportedFormats !== "function"
  ) {
    return false;
  }

  try {
    const supported = await Ctor.getSupportedFormats();
    if (!Array.isArray(supported)) {
      return false;
    }
    const formatSet = new Set(supported);
    return REQUIRED_NATIVE_FORMATS.every((format) => formatSet.has(format));
  } catch {
    return false;
  }
}

function toNativeImageSource(frame: ReplayFrame): unknown {
  if (typeof ImageData !== "function") {
    return frame;
  }

  const rgbaByteLength = frame.width * frame.height * 4;
  if (frame.data.byteLength === rgbaByteLength) {
    if (
      frame.data instanceof Uint8ClampedArray &&
      frame.data.buffer instanceof ArrayBuffer
    ) {
      return new ImageData(
        frame.data as Uint8ClampedArray<ArrayBuffer>,
        frame.width,
        frame.height,
      );
    }
    const rgba = new Uint8ClampedArray(rgbaByteLength);
    rgba.set(frame.data);
    return new ImageData(rgba, frame.width, frame.height);
  }

  const grayByteLength = frame.width * frame.height;
  if (frame.data.byteLength === grayByteLength) {
    const rgba = new Uint8ClampedArray(rgbaByteLength);
    const src = frame.data;
    for (let i = 0, j = 0; i < src.length; i++, j += 4) {
      const lum = src[i] ?? 0;
      rgba[j] = lum;
      rgba[j + 1] = lum;
      rgba[j + 2] = lum;
      rgba[j + 3] = 255;
    }
    return new ImageData(rgba, frame.width, frame.height);
  }

  return frame;
}

function mapCornerPoints(
  cornerPoints: readonly Point[] | undefined,
): readonly Point[] | undefined {
  if (!Array.isArray(cornerPoints) || cornerPoints.length === 0) {
    return undefined;
  }
  const mapped: Point[] = [];
  for (const point of cornerPoints) {
    if (
      point !== null &&
      typeof point === "object" &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y)
    ) {
      mapped.push({ x: point.x, y: point.y });
    }
  }
  return mapped.length > 0 ? mapped : undefined;
}

function toReplayDecodeResult(
  detection: NativeDetectedBarcode,
): ReplayDecodeResult | null {
  const format = NATIVE_FORMAT_MAP[detection.format];
  if (format === undefined || typeof detection.rawValue !== "string") {
    return null;
  }
  if (!isValidCode(detection.rawValue, format)) {
    return null;
  }

  const bounds = mapCornerPoints(detection.cornerPoints);
  if (bounds !== undefined) {
    return {
      rawValue: detection.rawValue,
      format,
      bounds,
    };
  }
  return {
    rawValue: detection.rawValue,
    format,
  };
}

/**
 * {@link ReplayEngineAdapter} for the Web `BarcodeDetector` fast path (ADR 0003)
 * with automatic fallback to a universal adapter (e.g. WASM) when native
 * detection is unavailable, incomplete, or fails at runtime.
 */
export class NativeBarcodeDetectorAdapter implements ReplayEngineAdapter {
  readonly engineName: string;
  readonly engineVersion: string;
  readonly buildId: string;
  readonly configurationId: string;

  private readonly detectorCtor: NativeBarcodeDetectorConstructor | undefined;
  private readonly fallbackAdapter: ReplayEngineAdapter | undefined;

  private detector: NativeBarcodeDetectorInstance | null = null;
  private nativeAvailable = false;
  private initPromise: Promise<void> | null = null;
  private fallbackInitPromise: Promise<void> | null = null;

  constructor(options: NativeBarcodeDetectorAdapterOptions = {}) {
    this.detectorCtor = options.detectorCtor;
    this.fallbackAdapter = options.fallbackAdapter;
    this.engineName = options.engineName ?? "native-barcodedetector";
    this.engineVersion = options.engineVersion ?? "1.0.0";
    this.buildId = options.buildId ?? "web-native-fast-path";
    this.configurationId = options.configurationId ?? "ean8-ean13-upca";
  }

  async init(): Promise<void> {
    if (this.initPromise !== null) {
      return this.initPromise;
    }

    this.initPromise = this.performInit();
    return this.initPromise;
  }

  async decodeFrame(frame: ReplayFrame): Promise<ReplayDecodeResult | null> {
    validateFrameBounds(frame.width, frame.height, frame.data.byteLength);

    if (this.initPromise === null) {
      await this.init();
    } else {
      await this.initPromise;
    }

    if (this.nativeAvailable && this.detector !== null) {
      try {
        const imageSource = toNativeImageSource(frame);
        const detections = await this.detector.detect(imageSource);
        if (Array.isArray(detections)) {
          for (const detection of detections) {
            const result = toReplayDecodeResult(detection);
            if (result !== null) {
              return result;
            }
          }
        }
        return null;
      } catch {
        return this.decodeWithFallback(frame);
      }
    }

    return this.decodeWithFallback(frame);
  }

  async dispose(): Promise<void> {
    this.detector = null;
    this.nativeAvailable = false;
    this.initPromise = null;

    if (this.fallbackInitPromise !== null && this.fallbackAdapter?.dispose) {
      this.fallbackInitPromise = null;
      await this.fallbackAdapter.dispose();
    } else {
      this.fallbackInitPromise = null;
    }
  }

  getDiagnostics(): {
    readonly longTaskCount?: number;
    readonly peakMemoryClass?: PeakMemoryClass;
  } {
    if (!this.nativeAvailable && this.fallbackAdapter?.getDiagnostics) {
      return this.fallbackAdapter.getDiagnostics();
    }
    return {
      peakMemoryClass: "low",
    };
  }

  private async performInit(): Promise<void> {
    const supported = await isNativeBarcodeDetectorSupported(this.detectorCtor);
    if (supported) {
      const Ctor = resolveDetectorCtor(this.detectorCtor);
      if (Ctor !== undefined) {
        try {
          this.detector = new Ctor({
            formats: [...REQUIRED_NATIVE_FORMATS],
          });
          this.nativeAvailable = true;
          return;
        } catch {
          this.detector = null;
          this.nativeAvailable = false;
        }
      }
    }

    this.detector = null;
    this.nativeAvailable = false;
    if (this.fallbackAdapter !== undefined) {
      await this.ensureFallbackInit();
    }
  }

  private async ensureFallbackInit(): Promise<void> {
    if (this.fallbackAdapter === undefined) {
      return;
    }
    if (this.fallbackInitPromise === null) {
      this.fallbackInitPromise = Promise.resolve(
        this.fallbackAdapter.init?.(),
      );
    }
    await this.fallbackInitPromise;
  }

  private async decodeWithFallback(
    frame: ReplayFrame,
  ): Promise<ReplayDecodeResult | null> {
    if (this.fallbackAdapter === undefined) {
      return null;
    }
    await this.ensureFallbackInit();
    return this.fallbackAdapter.decodeFrame(frame);
  }
}
