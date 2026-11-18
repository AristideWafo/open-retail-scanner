import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FRAME_BYTES,
  MAX_FRAME_HEIGHT,
  MAX_FRAME_WIDTH,
  assertPrivacySafePayload,
  validateDiagnosticEvent,
  validateFrameBounds,
} from "./privacy.ts";

test("validateFrameBounds accepts valid dimensions and byte lengths", () => {
  assert.doesNotThrow(() => validateFrameBounds(640, 480));
  assert.doesNotThrow(() =>
    validateFrameBounds(MAX_FRAME_WIDTH, MAX_FRAME_HEIGHT, MAX_FRAME_BYTES),
  );
  assert.doesNotThrow(() => validateFrameBounds(1280, 720, 1280 * 720 * 4));
});

test("validateFrameBounds rejects invalid, negative, non-integer, or oversized inputs", () => {
  assert.throws(() => validateFrameBounds(0, 480), RangeError);
  assert.throws(() => validateFrameBounds(-1, 480), RangeError);
  assert.throws(() => validateFrameBounds(640, 0), RangeError);
  assert.throws(() => validateFrameBounds(640, -10), RangeError);
  assert.throws(() => validateFrameBounds(640.5, 480), RangeError);
  assert.throws(() => validateFrameBounds(Number.NaN, 480), RangeError);
  assert.throws(() => validateFrameBounds(MAX_FRAME_WIDTH + 1, 480), RangeError);
  assert.throws(() => validateFrameBounds(640, MAX_FRAME_HEIGHT + 1), RangeError);
  assert.throws(() => validateFrameBounds(640, 480, 0), RangeError);
  assert.throws(() => validateFrameBounds(640, 480, -4), RangeError);
  assert.throws(
    () => validateFrameBounds(640, 480, MAX_FRAME_BYTES + 1),
    RangeError,
  );
});

test("assertPrivacySafePayload rejects binary frame/crop buffers and Blobs", () => {
  assert.throws(
    () => assertPrivacySafePayload({ data: new ArrayBuffer(8) }),
    /Privacy violation/,
  );
  assert.throws(
    () => assertPrivacySafePayload({ buf: new Uint8Array(4) }),
    /Privacy violation/,
  );
  assert.throws(
    () => assertPrivacySafePayload({ rgba: new Uint8ClampedArray(4) }),
    /Privacy violation/,
  );
  assert.throws(
    () => assertPrivacySafePayload({ nested: [new Blob(["x"])] }),
    /Privacy violation/,
  );
});

test("assertPrivacySafePayload rejects forbidden keys for frames, crops, barcodes, and product identities", () => {
  const forbiddenObjects = [
    { frame: "ok" },
    { image: "ok" },
    { crop: { x: 1 } },
    { pixels: [1, 2, 3] },
    { bitmap: {} },
    { dataUrl: "abc" },
    { base64: "YWJj" },
    { rawValue: "123" },
    { canonicalValue: "123" },
    { barcode: "x" },
    { gtin: "x" },
    { ean: "x" },
    { upc: "x" },
    { productName: "Oat Milk" },
    { ingredients: ["oats"] },
    { allergens: ["gluten"] },
    { profile: { id: "user" } },
    { deviceIdLabel: "Front Camera" },
    { nested: { croppedImage: "x" } },
  ];

  for (const obj of forbiddenObjects) {
    assert.throws(
      () => assertPrivacySafePayload(obj),
      /Privacy violation/,
      `Expected rejection for ${JSON.stringify(obj)}`,
    );
  }
});

test("assertPrivacySafePayload rejects data URLs and barcode/gtin strings", () => {
  assert.throws(
    () =>
      assertPrivacySafePayload({
        note: "data:image/png;base64,iVBORw0KGgo=",
      }),
    /Privacy violation/,
  );

  // Standalone EAN-8, UPC-A, EAN-13, GTIN-14
  for (const code of [
    "96385074",
    "036000291452",
    "4006381333931",
    "00036000291452",
  ]) {
    assert.throws(
      () => assertPrivacySafePayload({ note: code }),
      /Privacy violation/,
    );
  }

  // Embedded barcode / gtin strings
  assert.throws(
    () => assertPrivacySafePayload({ msg: "barcode: 4006381333931" }),
    /Privacy violation/,
  );
  assert.throws(
    () => assertPrivacySafePayload({ msg: "gtin=0036000291452" }),
    /Privacy violation/,
  );
});

test("assertPrivacySafePayload rejects all data URLs, embedded barcode digit runs, Error leaks, and health/user/device keys", () => {
  // All data: URLs (including non-image MIME types and leading whitespace)
  for (const url of [
    "data:text/plain;base64,SGVsbG8=",
    "  data:application/octet-stream;base64,AAAA",
    "prefix data:text/html,<script>",
  ]) {
    assert.throws(
      () => assertPrivacySafePayload({ note: url }),
      /Privacy violation/,
      `Expected rejection for data URL: ${url}`,
    );
  }

  // Embedded 8, 12, 13, 14-digit runs (while allowing ISO dates)
  for (const str of ["seq-4006381333931", "20261118", "id=036000291452-ok", "code:00036000291452"]) {
    assert.throws(
      () => assertPrivacySafePayload({ note: str }),
      /Privacy violation/,
      `Expected rejection for embedded barcode digits: ${str}`,
    );
  }
  assert.doesNotThrow(() =>
    assertPrivacySafePayload({ date: "2026-11-18", sequenceId: "seq-0001" }),
  );

  // Error instances leaking in message, cause, name, or extra properties
  assert.throws(
    () => assertPrivacySafePayload(new Error("failed on 4006381333931")),
    /Privacy violation/,
  );
  assert.throws(
    () =>
      assertPrivacySafePayload({
        err: new Error("decode failed", { cause: { rawValue: "96385074" } }),
      }),
    /Privacy violation/,
  );

  // Health/product/user/camera-label forbidden keys
  for (const obj of [
    { product: "snack" },
    { user: "u1" },
    { health: { flag: true } },
    { allergy: "peanut" },
    { symptom: "none" },
    { medical: {} },
    { identity: "anon" },
    { cameraLabel: "Back Camera" },
    { deviceLabel: "Pixel 7" },
  ]) {
    assert.throws(
      () => assertPrivacySafePayload(obj),
      /Privacy violation/,
      `Expected rejection for key in ${JSON.stringify(obj)}`,
    );
  }
});

test("assertPrivacySafePayload allows safe metadata payloads", () => {
  assert.doesNotThrow(() =>
    assertPrivacySafePayload({
      protocolVersion: "1.0.0",
      engineName: "BarcodeDetector",
      configurationId: "ean-upc-only",
      sequenceId: "seq-0001",
      startedAtMonotonicMs: 1731937889000,
    }),
  );
});

test("validateDiagnosticEvent validates strict allow-list and omits undefined optional fields", () => {
  const valid = validateDiagnosticEvent({
    sdkVersion: "0.1.0",
    engineVersion: "2.0.0",
    platformClass: "ios_safari",
    stage: "decode",
    durationMsBand: "10_50",
    featureBarcodeDetector: false,
  });

  assert.deepEqual(valid, {
    sdkVersion: "0.1.0",
    engineVersion: "2.0.0",
    platformClass: "ios_safari",
    stage: "decode",
    durationMsBand: "10_50",
    featureBarcodeDetector: false,
  });
  assert.equal("failureCategory" in valid, false);

  const withFailure = validateDiagnosticEvent({
    sdkVersion: "0.1.0",
    engineVersion: "2.0.0",
    platformClass: "android_chrome",
    stage: "camera",
    durationMsBand: "200_plus",
    failureCategory: "oversized_input",
    featureBarcodeDetector: true,
  });
  assert.equal(withFailure.failureCategory, "oversized_input");
});

test("validateDiagnosticEvent rejects unknown keys and leaked values", () => {
  assert.throws(
    () =>
      validateDiagnosticEvent({
        sdkVersion: "0.1.0",
        engineVersion: "2.0.0",
        platformClass: "ci_node",
        stage: "init",
        durationMsBand: "0_10",
        featureBarcodeDetector: false,
        extraField: "not-allowed",
      }),
    /Privacy violation/,
  );

  assert.throws(
    () =>
      validateDiagnosticEvent({
        sdkVersion: "4006381333931",
        engineVersion: "2.0.0",
        platformClass: "ci_node",
        stage: "init",
        durationMsBand: "0_10",
        featureBarcodeDetector: false,
      }),
    /Privacy violation/,
  );

  assert.throws(() =>
    validateDiagnosticEvent({
      sdkVersion: "0.1.0",
      engineVersion: "2.0.0",
      platformClass: "invalid_platform",
      stage: "init",
      durationMsBand: "0_10",
      featureBarcodeDetector: false,
    }),
  );
});
