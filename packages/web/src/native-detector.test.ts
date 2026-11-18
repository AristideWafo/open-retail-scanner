import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ReplayDecodeResult,
  ReplayEngineAdapter,
  ReplayFrame,
} from "open-retail-scanner-core";
import {
  NativeBarcodeDetectorAdapter,
  REQUIRED_NATIVE_FORMATS,
  isNativeBarcodeDetectorSupported,
  type NativeBarcodeDetectorConstructor,
  type NativeDetectedBarcode,
} from "./native-detector.ts";

function makeFrame(width = 16, height = 16): ReplayFrame {
  return {
    timestampMs: 100,
    width,
    height,
    data: new Uint8Array(width * height),
  };
}

function makeFallbackAdapter(
  result: ReplayDecodeResult | null,
): ReplayEngineAdapter & {
  initCalls: number;
  decodeCalls: number;
  disposeCalls: number;
} {
  return {
    engineName: "mock-wasm-fallback",
    engineVersion: "1.0.0",
    buildId: "mock-wasm",
    configurationId: "default",
    initCalls: 0,
    decodeCalls: 0,
    disposeCalls: 0,
    init() {
      this.initCalls++;
    },
    decodeFrame() {
      this.decodeCalls++;
      return result;
    },
    dispose() {
      this.disposeCalls++;
    },
  };
}

function createMockDetectorCtor(options: {
  readonly formats: readonly string[];
  readonly detectImpl: (
    image: unknown,
  ) => Promise<readonly NativeDetectedBarcode[]>;
}): NativeBarcodeDetectorConstructor {
  return class MockBarcodeDetector {
    static async getSupportedFormats(): Promise<readonly string[]> {
      return options.formats;
    }

    async detect(image: unknown): Promise<readonly NativeDetectedBarcode[]> {
      return options.detectImpl(image);
    }
  };
}

test("absent BarcodeDetector (e.g. iOS Safari default) returns false and uses fallback adapter", async () => {
  const g = globalThis as { BarcodeDetector?: unknown };
  const original = g.BarcodeDetector;
  delete g.BarcodeDetector;

  try {
    assert.equal(await isNativeBarcodeDetectorSupported(), false);
    assert.equal(await isNativeBarcodeDetectorSupported(undefined), false);

    const fallbackResult: ReplayDecodeResult = {
      rawValue: "4006381333931",
      format: "ean13",
    };
    const fallback = makeFallbackAdapter(fallbackResult);
    const adapter = new NativeBarcodeDetectorAdapter({
      fallbackAdapter: fallback,
    });

    await adapter.init();
    const decoded = await adapter.decodeFrame(makeFrame());

    assert.deepEqual(decoded, fallbackResult);
    assert.equal(fallback.initCalls, 1);
    assert.equal(fallback.decodeCalls, 1);

    await adapter.dispose();
    assert.equal(fallback.disposeCalls, 1);
  } finally {
    if (original !== undefined) {
      g.BarcodeDetector = original;
    }
  }
});

test("partial format support (missing upc_a) returns false and uses fallback adapter", async () => {
  let constructed = false;
  const PartialDetector = class {
    constructor() {
      constructed = true;
    }
    static async getSupportedFormats(): Promise<readonly string[]> {
      return ["ean_8", "ean_13", "qr_code"];
    }
    async detect(): Promise<readonly NativeDetectedBarcode[]> {
      return [];
    }
  } satisfies NativeBarcodeDetectorConstructor;

  assert.equal(
    await isNativeBarcodeDetectorSupported(PartialDetector),
    false,
  );

  const fallbackResult: ReplayDecodeResult = {
    rawValue: "036000291452",
    format: "upca",
  };
  const fallback = makeFallbackAdapter(fallbackResult);
  const adapter = new NativeBarcodeDetectorAdapter({
    detectorCtor: PartialDetector,
    fallbackAdapter: fallback,
  });

  const decoded = await adapter.decodeFrame(makeFrame());
  assert.equal(constructed, false);
  assert.deepEqual(decoded, fallbackResult);
  assert.equal(fallback.initCalls, 1);
  assert.equal(fallback.decodeCalls, 1);

  await adapter.dispose();
  assert.equal(fallback.disposeCalls, 1);
});

test("getSupportedFormats throwing or returning non-array returns false", async () => {
  const ThrowingDetector = class {
    static async getSupportedFormats(): Promise<readonly string[]> {
      throw new Error("platform error");
    }
    async detect(): Promise<readonly NativeDetectedBarcode[]> {
      return [];
    }
  } satisfies NativeBarcodeDetectorConstructor;

  assert.equal(
    await isNativeBarcodeDetectorSupported(ThrowingDetector),
    false,
  );
  assert.equal(
    await isNativeBarcodeDetectorSupported(
      {} as unknown as NativeBarcodeDetectorConstructor,
    ),
    false,
  );
});

test("full format support decodes ean_8, ean_13, upc_a and maps cornerPoints", async () => {
  const cases: ReadonlyArray<{
    readonly nativeFormat: "ean_8" | "ean_13" | "upc_a";
    readonly expectedFormat: "ean8" | "ean13" | "upca";
    readonly rawValue: string;
    readonly cornerPoints: readonly { x: number; y: number }[];
  }> = [
    {
      nativeFormat: "ean_8",
      expectedFormat: "ean8",
      rawValue: "96385074",
      cornerPoints: [
        { x: 1, y: 2 },
        { x: 11, y: 2 },
        { x: 11, y: 8 },
        { x: 1, y: 8 },
      ],
    },
    {
      nativeFormat: "ean_13",
      expectedFormat: "ean13",
      rawValue: "4006381333931",
      cornerPoints: [
        { x: 10, y: 20 },
        { x: 110, y: 20 },
        { x: 110, y: 60 },
        { x: 10, y: 60 },
      ],
    },
    {
      nativeFormat: "upc_a",
      expectedFormat: "upca",
      rawValue: "036000291452",
      cornerPoints: [
        { x: 4, y: 5 },
        { x: 44, y: 5 },
        { x: 44, y: 25 },
        { x: 4, y: 25 },
      ],
    },
  ];

  let nextCaseIndex = 0;
  let requestedFormats: readonly string[] | undefined;

  const FullDetector = class {
    constructor(opts?: { readonly formats?: readonly string[] | undefined }) {
      requestedFormats = opts?.formats;
    }
    static async getSupportedFormats(): Promise<readonly string[]> {
      return ["qr_code", ...REQUIRED_NATIVE_FORMATS];
    }
    async detect(): Promise<readonly NativeDetectedBarcode[]> {
      const current = cases[nextCaseIndex++];
      assert.ok(current !== undefined);
      return [
        // Non-retail or invalid checksum detections before the valid one are skipped.
        { rawValue: "https://example.com", format: "qr_code" },
        { rawValue: "4006381333932", format: "ean_13" },
        {
          rawValue: current.rawValue,
          format: current.nativeFormat,
          cornerPoints: current.cornerPoints,
        },
      ];
    }
  } satisfies NativeBarcodeDetectorConstructor;

  assert.equal(await isNativeBarcodeDetectorSupported(FullDetector), true);

  const fallback = makeFallbackAdapter(null);
  const adapter = new NativeBarcodeDetectorAdapter({
    detectorCtor: FullDetector,
    fallbackAdapter: fallback,
  });

  await adapter.init();
  assert.deepEqual(requestedFormats, [...REQUIRED_NATIVE_FORMATS]);

  for (const c of cases) {
    const result = await adapter.decodeFrame(makeFrame());
    assert.deepEqual(result, {
      rawValue: c.rawValue,
      format: c.expectedFormat,
      bounds: c.cornerPoints,
    });
  }

  assert.equal(fallback.initCalls, 0);
  assert.equal(fallback.decodeCalls, 0);

  await adapter.dispose();
  assert.equal(fallback.disposeCalls, 0);
});

test("runtime exception in detect() seamlessly falls back to fallbackAdapter", async () => {
  const FailingDetectDetector = createMockDetectorCtor({
    formats: [...REQUIRED_NATIVE_FORMATS],
    async detectImpl() {
      throw new Error("GPU readback failed");
    },
  });

  const fallbackResult: ReplayDecodeResult = {
    rawValue: "4006381333931",
    format: "ean13",
  };
  const fallback = makeFallbackAdapter(fallbackResult);
  const adapter = new NativeBarcodeDetectorAdapter({
    detectorCtor: FailingDetectDetector,
    fallbackAdapter: fallback,
  });

  await adapter.init();
  assert.equal(fallback.initCalls, 0);

  const decoded = await adapter.decodeFrame(makeFrame());
  assert.deepEqual(decoded, fallbackResult);
  assert.equal(fallback.initCalls, 1);
  assert.equal(fallback.decodeCalls, 1);

  await adapter.dispose();
  assert.equal(fallback.disposeCalls, 1);
});

test("validates frame bounds and omits bounds property when cornerPoints absent", async () => {
  const NoBoundsDetector = createMockDetectorCtor({
    formats: [...REQUIRED_NATIVE_FORMATS],
    async detectImpl() {
      return [{ rawValue: "96385074", format: "ean_8" }];
    },
  });

  const adapter = new NativeBarcodeDetectorAdapter({
    detectorCtor: NoBoundsDetector,
  });

  const result = await adapter.decodeFrame(makeFrame());
  assert.ok(result !== null);
  assert.equal(result.rawValue, "96385074");
  assert.equal(result.format, "ean8");
  assert.equal(Object.hasOwn(result, "bounds"), false);

  await assert.rejects(
    () =>
      adapter.decodeFrame({
        timestampMs: 0,
        width: 0,
        height: 16,
        data: new Uint8Array(16),
      }),
    RangeError,
  );

  await assert.rejects(
    () =>
      adapter.decodeFrame({
        timestampMs: 0,
        width: 4097,
        height: 16,
        data: new Uint8Array(16),
      }),
    RangeError,
  );
});

test("transient init and fallback init failures clear cached promises so retries succeed", async () => {
  let initAttempts = 0;
  const fallbackResult: ReplayDecodeResult = {
    rawValue: "4006381333931",
    format: "ean13",
  };
  const flakyFallback: ReplayEngineAdapter = {
    engineName: "flaky-wasm",
    engineVersion: "zxing-wasm@3.1.7",
    buildId: "flaky",
    configurationId: "default",
    init() {
      initAttempts++;
      if (initAttempts === 1) {
        throw new Error("transient WASM fetch failure");
      }
    },
    decodeFrame() {
      return fallbackResult;
    },
  };

  // Case 1: Native unavailable -> init() fails transiently on first call, retries and succeeds on second.
  const UnavailableDetector = createMockDetectorCtor({
    formats: ["qr_code"],
    async detectImpl() {
      return [];
    },
  });
  const adapter1 = new NativeBarcodeDetectorAdapter({
    detectorCtor: UnavailableDetector,
    fallbackAdapter: flakyFallback,
  });

  await assert.rejects(() => adapter1.init(), /transient WASM fetch failure/);
  await adapter1.init();
  assert.equal(initAttempts, 2);
  assert.deepEqual(await adapter1.decodeFrame(makeFrame()), fallbackResult);

  // Case 2: Native available at init(), runtime detect() triggers fallback whose init() fails once then retries.
  let runtimeInitAttempts = 0;
  const runtimeFlakyFallback: ReplayEngineAdapter = {
    engineName: "runtime-flaky-wasm",
    engineVersion: "zxing-wasm@3.1.7",
    buildId: "flaky",
    configurationId: "default",
    init() {
      runtimeInitAttempts++;
      if (runtimeInitAttempts === 1) {
        throw new Error("transient fallback init error");
      }
    },
    decodeFrame() {
      return fallbackResult;
    },
  };
  const FailingDetectDetector = createMockDetectorCtor({
    formats: [...REQUIRED_NATIVE_FORMATS],
    async detectImpl() {
      throw new Error("GPU failure");
    },
  });

  const adapter2 = new NativeBarcodeDetectorAdapter({
    detectorCtor: FailingDetectDetector,
    fallbackAdapter: runtimeFlakyFallback,
  });
  await adapter2.init();
  await assert.rejects(
    () => adapter2.decodeFrame(makeFrame()),
    /transient fallback init error/,
  );
  assert.deepEqual(await adapter2.decodeFrame(makeFrame()), fallbackResult);
  assert.equal(runtimeInitAttempts, 2);
});

test("getActiveEngineVersion() tracks native engine and switches to fallback engineVersion on runtime fallback", async () => {
  let shouldFailDetect = false;
  const ToggleDetector = createMockDetectorCtor({
    formats: [...REQUIRED_NATIVE_FORMATS],
    async detectImpl() {
      if (shouldFailDetect) {
        throw new Error("runtime native error");
      }
      return [{ rawValue: "96385074", format: "ean_8" }];
    },
  });

  const fallback: ReplayEngineAdapter = {
    engineName: "zxing-wasm",
    engineVersion: "zxing-wasm@3.1.7 (zxing-cpp@test)",
    buildId: "wasm",
    configurationId: "default",
    decodeFrame() {
      return { rawValue: "4006381333931", format: "ean13" };
    },
  };

  const adapter = new NativeBarcodeDetectorAdapter({
    detectorCtor: ToggleDetector,
    fallbackAdapter: fallback,
    engineName: "native-barcodedetector",
    engineVersion: "2.0.0",
  });

  await adapter.init();
  assert.equal(adapter.getActiveEngineVersion(), "native-barcodedetector@2.0.0");

  const nativeDecoded = await adapter.decodeFrame(makeFrame());
  assert.equal(nativeDecoded?.rawValue, "96385074");
  assert.equal(adapter.getActiveEngineVersion(), "native-barcodedetector@2.0.0");

  shouldFailDetect = true;
  const fallbackDecoded = await adapter.decodeFrame(makeFrame());
  assert.equal(fallbackDecoded?.rawValue, "4006381333931");
  assert.equal(
    adapter.getActiveEngineVersion(),
    "zxing-wasm@3.1.7 (zxing-cpp@test)",
  );
});

test("zero-copy imageSource passthrough and invalid byteLength fallback when ImageData is defined", async () => {
  const seenImages: unknown[] = [];
  const Detector = createMockDetectorCtor({
    formats: [...REQUIRED_NATIVE_FORMATS],
    async detectImpl(image) {
      seenImages.push(image);
      return [{ rawValue: "036000291452", format: "upc_a" }];
    },
  });

  const fallbackResult: ReplayDecodeResult = {
    rawValue: "4006381333931",
    format: "ean13",
  };
  const fallback = makeFallbackAdapter(fallbackResult);

  const g = globalThis as { ImageData?: unknown };
  const originalImageDataDesc = Object.getOwnPropertyDescriptor(g, "ImageData");
  class MockImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  Object.defineProperty(g, "ImageData", {
    value: MockImageData,
    configurable: true,
    writable: true,
  });

  try {
    const adapter = new NativeBarcodeDetectorAdapter({
      detectorCtor: Detector,
      fallbackAdapter: fallback,
    });
    await adapter.init();

    // Zero-copy ImageBitmap/VideoFrame handle is passed straight through to detect().
    const videoFrameHandle = { kind: "VideoFrame", codedWidth: 16, codedHeight: 16 };
    const zeroCopyFrame = {
      ...makeFrame(16, 16),
      imageSource: videoFrameHandle,
    } as ReplayFrame & { readonly imageSource: unknown };

    const zeroCopyRes = await adapter.decodeFrame(zeroCopyFrame);
    assert.equal(zeroCopyRes?.rawValue, "036000291452");
    assert.equal(seenImages.length, 1);
    assert.equal(seenImages[0], videoFrameHandle);
    assert.equal(fallback.decodeCalls, 0);

    // String/dataURL imageSource must never reach detect() and falls back cleanly.
    const dataUrlFrame = {
      ...makeFrame(16, 16),
      imageSource: "data:image/jpeg;base64,/9j/4AAQ",
    } as ReplayFrame & { readonly imageSource: unknown };
    const dataUrlFallback = await adapter.decodeFrame(dataUrlFrame);
    assert.deepEqual(dataUrlFallback, fallbackResult);
    assert.equal(seenImages.length, 1);
    assert.equal(fallback.decodeCalls, 1);

    // Valid grayscale frame converts to MockImageData for native detect().
    const grayRes = await adapter.decodeFrame(makeFrame(16, 16));
    assert.equal(grayRes?.rawValue, "036000291452");
    assert.equal(seenImages.length, 2);
    assert.ok(seenImages[1] instanceof MockImageData);

    // Unsupported byteLength throws RangeError in toNativeImageSource and falls back cleanly.
    const invalidBytesFrame: ReplayFrame = {
      timestampMs: 200,
      width: 16,
      height: 16,
      data: new Uint8Array(10),
    };
    const invalidBytesRes = await adapter.decodeFrame(invalidBytesFrame);
    assert.deepEqual(invalidBytesRes, fallbackResult);
    assert.equal(seenImages.length, 2);
    assert.equal(fallback.decodeCalls, 2);
    assert.equal(adapter.getActiveEngineVersion(), fallback.engineVersion);
  } finally {
    if (originalImageDataDesc !== undefined) {
      Object.defineProperty(g, "ImageData", originalImageDataDesc);
    } else {
      delete g.ImageData;
    }
  }
});
