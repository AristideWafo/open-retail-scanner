import {
  prepareZXingModule,
  purgeZXingModule,
  readBarcodes,
  ZXING_CPP_COMMIT,
  ZXING_WASM_VERSION,
  type ReadInputBarcodeFormat,
  type ReadResult,
  type ReaderOptions,
} from "zxing-wasm/reader";
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

export const ZXING_ENGINE_VERSION = `zxing-wasm@${ZXING_WASM_VERSION} (zxing-cpp@${ZXING_CPP_COMMIT})`;

const DEFAULT_FORMATS: readonly BarcodeFormat[] = ["ean8", "ean13", "upca"];
const REMOTE_WASM_ERROR =
  "Remote WASM CDN URLs are forbidden; serve zxing_reader.wasm locally";

const FORMAT_TO_ZXING: Record<BarcodeFormat, ReadInputBarcodeFormat> = {
  ean8: "EAN8",
  ean13: "EAN13",
  upca: "UPCA",
};

const ZXING_TO_FORMAT: Readonly<Record<string, BarcodeFormat>> = {
  EAN8: "ean8",
  "EAN-8": "ean8",
  EAN13: "ean13",
  "EAN-13": "ean13",
  UPCA: "upca",
  "UPC-A": "upca",
};

let cachedNodeWasmBinary: Uint8Array | null = null;
let pendingNodeWasmLoad: Promise<Uint8Array> | null = null;

/**
 * Loads the local `zxing_reader.wasm` binary from the installed `zxing-wasm`
 * package in Node.js environments and caches it in memory.
 */
export async function loadLocalZxingWasmBinary(): Promise<Uint8Array> {
  if (!globalThis.process?.versions?.node) {
    throw new Error(REMOTE_WASM_ERROR);
  }
  if (cachedNodeWasmBinary !== null) {
    return cachedNodeWasmBinary;
  }
  if (pendingNodeWasmLoad === null) {
    pendingNodeWasmLoad = (async () => {
      const [{ readFile }, { createRequire }] = await Promise.all([
        import("node:fs/promises"),
        import("node:module"),
      ]);
      const require = createRequire(import.meta.url);
      const wasmPath = require.resolve("zxing-wasm/reader/zxing_reader.wasm");
      const bytes = await readFile(wasmPath);
      const buffer = new Uint8Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      cachedNodeWasmBinary = buffer;
      return buffer;
    })().catch((error: unknown) => {
      pendingNodeWasmLoad = null;
      throw error;
    });
  }
  return pendingNodeWasmLoad;
}

function validateLocalWasmUrl(wasmUrl: string): string {
  const trimmed = wasmUrl.trim();
  if (trimmed.length === 0 || /^(?:data|blob|ftp|ws|wss):/i.test(trimmed)) {
    throw new Error(REMOTE_WASM_ERROR);
  }

  const locationOrigin = globalThis.location?.origin;
  if (
    typeof locationOrigin === "string" &&
    locationOrigin.length > 0 &&
    locationOrigin !== "null"
  ) {
    let resolved: URL;
    try {
      resolved = new URL(trimmed, locationOrigin);
    } catch {
      throw new Error(REMOTE_WASM_ERROR);
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      throw new Error(REMOTE_WASM_ERROR);
    }
    if (resolved.origin !== locationOrigin) {
      throw new Error(REMOTE_WASM_ERROR);
    }
    return resolved.href;
  }

  // Without a browser origin, reject explicit http(s), protocol-relative, or other schemes.
  if (
    /^(?:https?:)?\/\//i.test(trimmed) ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    throw new Error(REMOTE_WASM_ERROR);
  }
  return trimmed;
}

function toOwnedArrayBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export interface ZxingAdapterOptions {
  readonly formats?: readonly BarcodeFormat[];
  readonly tryHarder?: boolean;
  readonly tryRotate?: boolean;
  readonly tryInvert?: boolean;
  readonly tryDownscale?: boolean;
  readonly maxNumberOfSymbols?: number;
  readonly configurationId?: string;
  readonly wasmBinary?: ArrayBuffer | Uint8Array;
  readonly wasmUrl?: string;
}

/**
 * `ReplayEngineAdapter` backed by `zxing-wasm/reader` with strict local-only
 * WASM instantiation and privacy-preserving decode output.
 */
export class ZxingWasmAdapter implements ReplayEngineAdapter {
  readonly engineName = "zxing-wasm";
  readonly engineVersion = ZXING_ENGINE_VERSION;
  readonly buildId = `zxing-wasm@${ZXING_WASM_VERSION}:reader`;
  readonly configurationId: string;

  private readonly allowedFormats: ReadonlySet<BarcodeFormat>;
  private readonly readerOptions: ReaderOptions;
  private readonly wasmBinaryOption: ArrayBuffer | Uint8Array | undefined;
  private readonly wasmUrlOption: string | undefined;

  private initialized = false;
  private rgbaScratch: Uint8ClampedArray | null = null;
  private longTaskCount = 0;

  constructor(options: ZxingAdapterOptions = {}) {
    const formats =
      options.formats && options.formats.length > 0
        ? options.formats
        : DEFAULT_FORMATS;
    const tryHarder = options.tryHarder ?? true;
    const tryRotate = options.tryRotate ?? true;
    const tryInvert = options.tryInvert ?? false;
    const tryDownscale = options.tryDownscale ?? true;
    const maxNumberOfSymbols = options.maxNumberOfSymbols ?? 1;

    this.allowedFormats = new Set(formats);
    this.configurationId =
      options.configurationId ??
      `th${Number(tryHarder)}-tr${Number(tryRotate)}-ti${Number(tryInvert)}-td${Number(tryDownscale)}`;

    this.readerOptions = {
      formats: formats.map((format) => FORMAT_TO_ZXING[format]),
      tryHarder,
      tryRotate,
      tryInvert,
      tryDownscale,
      maxNumberOfSymbols,
      returnErrors: false,
    };

    this.wasmBinaryOption = options.wasmBinary;
    this.wasmUrlOption = options.wasmUrl;
  }

  async init(): Promise<void> {
    if (this.wasmUrlOption !== undefined) {
      validateLocalWasmUrl(this.wasmUrlOption);
    }

    if (this.wasmBinaryOption !== undefined) {
      const wasmBinary = toOwnedArrayBuffer(this.wasmBinaryOption);
      await prepareZXingModule({
        overrides: { wasmBinary },
        fireImmediately: true,
      });
    } else if (this.wasmUrlOption !== undefined) {
      const localUrl = validateLocalWasmUrl(this.wasmUrlOption);
      await prepareZXingModule({
        overrides: { locateFile: () => localUrl },
        fireImmediately: true,
      });
    } else {
      const localBytes = await loadLocalZxingWasmBinary();
      const wasmBinary = toOwnedArrayBuffer(localBytes);
      await prepareZXingModule({
        overrides: { wasmBinary },
        fireImmediately: true,
      });
    }

    this.longTaskCount = 0;
    this.initialized = true;
  }

  async decodeFrame(frame: ReplayFrame): Promise<ReplayDecodeResult | null> {
    if (!this.initialized) {
      throw new Error(
        "ZxingWasmAdapter is not initialized; call init() before decodeFrame()",
      );
    }

    validateFrameBounds(frame.width, frame.height, frame.data.byteLength);

    const imageData = this.frameToImageData(frame);
    const startMs = performance.now();
    const results = await readBarcodes(imageData, this.readerOptions);
    if (performance.now() - startMs > 50) {
      this.longTaskCount++;
    }

    return this.mapFirstValidResult(results);
  }

  async dispose(): Promise<void> {
    purgeZXingModule();
    this.initialized = false;
    this.rgbaScratch = null;
    this.longTaskCount = 0;
  }

  getDiagnostics(): {
    readonly longTaskCount?: number;
    readonly peakMemoryClass?: PeakMemoryClass;
  } {
    return {
      longTaskCount: this.longTaskCount,
      peakMemoryClass: "low",
    };
  }

  private frameToImageData(frame: ReplayFrame): ImageData {
    const pixelCount = frame.width * frame.height;
    const expectedRgbaBytes = pixelCount * 4;

    let rgba: Uint8ClampedArray<ArrayBuffer>;
    if (frame.data.byteLength === pixelCount) {
      if (
        this.rgbaScratch === null ||
        this.rgbaScratch.byteLength !== expectedRgbaBytes
      ) {
        this.rgbaScratch = new Uint8ClampedArray(expectedRgbaBytes);
      }
      rgba = this.rgbaScratch as Uint8ClampedArray<ArrayBuffer>;
      const src = frame.data;
      for (let i = 0, dst = 0; i < pixelCount; i++, dst += 4) {
        const lum = src[i] ?? 0;
        rgba[dst] = lum;
        rgba[dst + 1] = lum;
        rgba[dst + 2] = lum;
        rgba[dst + 3] = 255;
      }
    } else if (frame.data.byteLength === expectedRgbaBytes) {
      if (frame.data.buffer instanceof ArrayBuffer) {
        rgba = new Uint8ClampedArray(
          frame.data.buffer,
          frame.data.byteOffset,
          frame.data.byteLength,
        );
      } else {
        const copy = new Uint8ClampedArray(expectedRgbaBytes);
        copy.set(frame.data);
        rgba = copy;
      }
    } else {
      throw new RangeError(
        `Frame byteLength (${frame.data.byteLength}) must equal width*height (${pixelCount}) or width*height*4 (${expectedRgbaBytes})`,
      );
    }

    return {
      data: rgba,
      width: frame.width,
      height: frame.height,
      colorSpace: "srgb",
    };
  }

  private mapFirstValidResult(
    results: readonly ReadResult[],
  ): ReplayDecodeResult | null {
    for (const hit of results) {
      if (!hit.isValid || hit.text.length === 0) {
        continue;
      }
      const format = ZXING_TO_FORMAT[hit.format];
      if (format === undefined || !this.allowedFormats.has(format)) {
        continue;
      }
      const pos = hit.position;
      const bounds: readonly Point[] = [
        { x: pos.topLeft.x, y: pos.topLeft.y },
        { x: pos.topRight.x, y: pos.topRight.y },
        { x: pos.bottomRight.x, y: pos.bottomRight.y },
        { x: pos.bottomLeft.x, y: pos.bottomLeft.y },
      ];
      return {
        rawValue: hit.text,
        format,
        bounds,
      };
    }
    return null;
  }
}

const L_PATTERNS: readonly string[] = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];

const G_PATTERNS: readonly string[] = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
];

const R_PATTERNS: readonly string[] = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
];

const EAN13_PARITY_TABLE: readonly string[] = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

function encodeLinearModules(code: string, format: BarcodeFormat): string {
  if (!isValidCode(code, format)) {
    throw new RangeError(`Invalid ${format} barcode payload`);
  }

  const digits = Array.from(code, (ch) => ch.charCodeAt(0) - 48);
  const parts: string[] = ["101"];

  if (format === "ean8") {
    for (let i = 0; i < 4; i++) {
      parts.push(L_PATTERNS[digits[i] ?? 0] ?? "");
    }
    parts.push("01010");
    for (let i = 4; i < 8; i++) {
      parts.push(R_PATTERNS[digits[i] ?? 0] ?? "");
    }
  } else if (format === "upca") {
    for (let i = 0; i < 6; i++) {
      parts.push(L_PATTERNS[digits[i] ?? 0] ?? "");
    }
    parts.push("01010");
    for (let i = 6; i < 12; i++) {
      parts.push(R_PATTERNS[digits[i] ?? 0] ?? "");
    }
  } else {
    const first = digits[0] ?? 0;
    const parity = EAN13_PARITY_TABLE[first] ?? "LLLLLL";
    for (let i = 0; i < 6; i++) {
      const d = digits[i + 1] ?? 0;
      parts.push(
        (parity[i] === "G" ? G_PATTERNS[d] : L_PATTERNS[d]) ?? "",
      );
    }
    parts.push("01010");
    for (let i = 7; i < 13; i++) {
      parts.push(R_PATTERNS[digits[i] ?? 0] ?? "");
    }
  }

  parts.push("101");
  return parts.join("");
}

function clampByte(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}

/**
 * Deterministically renders an EAN-8, EAN-13, or UPC-A barcode into a
 * 1-channel grayscale `ReplayFrame` using GS1 L/G/R bit patterns.
 */
export function renderLinearBarcodeFrame(
  code: string,
  format: BarcodeFormat,
  options?: {
    readonly width?: number;
    readonly height?: number;
    readonly condition?: "normal" | "low_light" | "glare_curved" | "small_damaged";
    readonly rotate90?: boolean;
  },
): ReplayFrame {
  const rotate90 = options?.rotate90 ?? false;
  const width = options?.width ?? (rotate90 ? 180 : 320);
  const height = options?.height ?? (rotate90 ? 320 : 180);
  const condition = options?.condition ?? "normal";

  validateFrameBounds(width, height, width * height);
  const modules = encodeLinearModules(code, format);

  const quietModules = 12;
  const totalModules = modules.length + quietModules * 2;
  const data = new Uint8Array(width * height);

  const barAxisLen = rotate90 ? height : width;
  const crossAxisLen = rotate90 ? width : height;

  const isSmall = condition === "small_damaged";
  const barSpanRatio = isSmall ? 0.68 : 0.84;
  const crossSpanRatio =
    condition === "small_damaged"
      ? 0.16
      : condition === "glare_curved"
        ? 0.36
        : 0.58;

  const minReadableSpan = Math.min(barAxisLen, Math.ceil(totalModules * 1.8));
  const barSpan = Math.max(minReadableSpan, Math.floor(barSpanRatio * barAxisLen));
  const barStart = Math.max(0, Math.floor((barAxisLen - barSpan) * 0.5));
  const crossStart = Math.floor(((1 - crossSpanRatio) * 0.5) * crossAxisLen);
  const crossEnd = Math.min(
    crossAxisLen,
    crossStart + Math.max(12, Math.floor(crossSpanRatio * crossAxisLen)),
  );
  const crossSpan = Math.max(1, crossEnd - crossStart);

  const bgLum = condition === "low_light" ? 38 : 244;
  const darkLum = condition === "low_light" ? 20 : 16;
  const lightLum = condition === "low_light" ? 44 : 244;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const barCoord = rotate90 ? y : x;
      const crossCoord = rotate90 ? x : y;

      let lum = bgLum;
      const inCrossBand = crossCoord >= crossStart && crossCoord < crossEnd;
      const inBarBand = barCoord >= barStart && barCoord < barStart + barSpan;

      if (inCrossBand && inBarBand) {
        let u = (barCoord - barStart) / barSpan;
        const v = (crossCoord - crossStart) / crossSpan;

        if (condition === "glare_curved") {
          // Subtle cylindrical distortion across module axis.
          u = Math.max(0, Math.min(0.999999, u + 0.015 * Math.sin(u * Math.PI * 2)));
        }

        const modIdx = Math.floor(u * totalModules) - quietModules;
        const isBlack =
          modIdx >= 0 && modIdx < modules.length && modules[modIdx] === "1";
        lum = isBlack ? darkLum : lightLum;

        if (condition === "glare_curved") {
          // Specular glare band washing out the middle scanlines (0.20 <= v <= 0.80).
          const distFromGlare = Math.abs(v - 0.5);
          if (distFromGlare < 0.30) {
            const glareStrength = 1 - distFromGlare / 0.30;
            lum = lum + (252 - lum) * (0.76 + 0.24 * glareStrength);
          }
        } else if (condition === "small_damaged") {
          // Partial horizontal scratch / print void across middle scanlines.
          if (v >= 0.35 && v <= 0.65 && u >= 0.34 && u <= 0.48) {
            lum = lightLum;
          }
        }
      }

      if (condition === "low_light") {
        // Deterministic sensor grain in low-light captures.
        const grain = ((x * 73 + y * 179 + (x ^ y) * 31) % 9) - 4;
        lum += grain;
      }

      data[y * width + x] = clampByte(lum);
    }
  }

  return {
    timestampMs: 0,
    width,
    height,
    data,
  };
}
