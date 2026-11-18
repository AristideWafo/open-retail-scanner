# Application Integration Guide

This guide explains how to integrate **Open Retail Scanner** (`open-retail-scanner-web` and `open-retail-scanner-core`) into a web or PWA application (Vanilla TypeScript/JavaScript, React, Vue, or custom UI).

---

## 1. Prerequisites & Local WASM Asset Hosting

Open Retail Scanner processes all frames locally on-device and **blocks remote CDN URLs** for `zxing_reader.wasm`. Your application must serve `zxing_reader.wasm` from the same origin (or pass an in-memory `wasmBinary`).

### Package Dependencies

Add the workspace or package dependencies to your application:

```json
{
  "dependencies": {
    "open-retail-scanner-core": "*",
    "open-retail-scanner-web": "*"
  }
}
```

### Serving `zxing_reader.wasm` Locally (Vite / Bundlers)

1. Copy or expose `node_modules/zxing-wasm/dist/reader/zxing_reader.wasm` in your static assets directory (for example `public/wasm/zxing_reader.wasm`), or import its asset URL via your bundler:

```ts
// Vite asset URL import (resolved to a same-origin path like "/assets/zxing_reader-xxxx.wasm")
import zxingReaderWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
```

2. Pass `wasmUrl` (must be relative or same-origin) or `wasmBinary` (`Uint8Array` / `ArrayBuffer`) in `zxingOptions`:

```ts
const scanner = new WebBarcodeScanner({
  zxingOptions: {
    wasmUrl: zxingReaderWasmUrl, // or "/wasm/zxing_reader.wasm"
  },
});
```

### Content Security Policy (CSP) & HTTPS

- **HTTPS (or `localhost`)** is required by browsers to expose `navigator.mediaDevices.getUserMedia`. If `navigator.mediaDevices` is unavailable, the scanner automatically emits `{ type: "error", code: "camera_unavailable", recoverable: true }` and opens manual barcode entry.
- **CSP header** must allow WebAssembly compilation and same-origin workers:
  ```http
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
  ```
- **No COOP/COEP required:** The Phase 1 decoder uses single-thread WASM and does not require `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy`.

---

## 2. Mode A — Turnkey Accessible DOM UI (`scanner.mount`)

Use `scanner.mount(containerElement)` when you want a ready-to-use, accessible scanner section with:
- `<video data-role="camera-preview" playsinline muted autoplay>` bound automatically to the camera stream;
- automatic native-resolution frame capture (`requestVideoFrameCallback` / `requestAnimationFrame` → `LatestFrameScheduler`);
- ARIA live status announcements (`role="status"`, `aria-live="polite"`) and keyboard navigation (`Escape` closes manual entry or stops scanning);
- torch and zoom controls shown only when hardware capabilities report support;
- universal manual barcode entry (`Auto (EAN-13 / UPC-A / EAN-8)`) reachable in 100% of states and recoverable errors.

```ts
import { WebBarcodeScanner } from "open-retail-scanner-web";

const root = document.getElementById("scanner-root");
if (!root) throw new Error("Missing #scanner-root container");

const scanner = new WebBarcodeScanner({
  formats: ["ean13", "upca", "ean8"],
  requiredConfirmingFrames: 2,
  consensusWindowMs: 1500,
  duplicateCooldownMs: 2000,
  preferNativeDetector: true,
  zxingOptions: {
    wasmUrl: "/wasm/zxing_reader.wasm",
  },
  onEvent(event) {
    if (event.type === "result") {
      // Stop scanner and pass result in memory to your app's product lookup.
      // Never log rawValue or canonicalValue to console or telemetry.
      void scanner.stop();
      handleConfirmedBarcode(event.result);
    }
  },
});

// Mount accessible DOM controls & <video> preview
const view = scanner.mount(root);

// Start camera acquisition and decoding
await scanner.start();

// On screen teardown / route leave:
async function cleanup() {
  view.destroy();
  await scanner.dispose();
}
```

---

## 3. Mode B — Custom UI / React Integration (`attachVideoElement`)

If your application owns its design system (for example a React app with custom bottom sheets, buttons, and overlays), bind your `<video>` element via `scanner.attachVideoElement(videoEl)` and subscribe to scanner state and events.

```tsx
import { useEffect, useRef, useState } from "react";
import {
  WebBarcodeScanner,
  getAccessibleErrorMessage,
  getGuidanceMessage,
  type ScannerUIState,
} from "open-retail-scanner-web";
import type { BarcodeFormat, ScanResult } from "open-retail-scanner-core";

export interface ProductBarcodeScannerProps {
  readonly wasmUrl?: string;
  readonly onBarcodeConfirmed: (result: ScanResult) => void;
}

export function ProductBarcodeScanner({
  wasmUrl = "/wasm/zxing_reader.wasm",
  onBarcodeConfirmed,
}: ProductBarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<WebBarcodeScanner | null>(null);
  const callbackRef = useRef(onBarcodeConfirmed);
  callbackRef.current = onBarcodeConfirmed;

  const [uiState, setUiState] = useState<ScannerUIState | null>(null);
  const [manualDigits, setManualDigits] = useState("");
  const [manualFormat, setManualFormat] = useState<BarcodeFormat | undefined>(undefined);
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    const scanner = new WebBarcodeScanner({
      formats: ["ean13", "upca", "ean8"],
      preferNativeDetector: true,
      zxingOptions: { wasmUrl },
      onEvent(event) {
        if (event.type === "result") {
          void scanner.stop();
          callbackRef.current(event.result);
        }
      },
    });
    scannerRef.current = scanner;

    const unsubscribeUi = scanner.getUIController().subscribe((nextState) => {
      setUiState(nextState);
    });

    if (videoRef.current) {
      scanner.attachVideoElement(videoRef.current);
    }

    void scanner.start();

    return () => {
      unsubscribeUi();
      scanner.attachVideoElement(null);
      void scanner.dispose();
      scannerRef.current = null;
    };
  }, [wasmUrl]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const scanner = scannerRef.current;
    if (!scanner) return;
    const outcome = scanner.submitManualCode(manualDigits, manualFormat);
    if (!outcome.ok) {
      setManualError(outcome.message);
    } else {
      setManualError(null);
    }
  };

  return (
    <section aria-label="Barcode scanner">
      <div role="status" aria-live="polite" className="sr-only">
        {uiState?.ariaLiveMessage}
      </div>

      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        hidden={uiState?.manualEntryOpen === true}
      />

      {uiState?.guidance && (
        <p>{getGuidanceMessage(uiState.guidance)}</p>
      )}

      {uiState?.state === "error" && uiState.errorCode && (
        <div role="alert">
          <p>{getAccessibleErrorMessage(uiState.errorCode, uiState.errorRecoverable)}</p>
          <button type="button" onClick={() => void scannerRef.current?.start()}>
            Retry camera
          </button>
        </div>
      )}

      <div>
        {uiState?.torchSupported && (
          <button
            type="button"
            aria-pressed={uiState.torchEnabled}
            onClick={() => void scannerRef.current?.setTorch(!uiState.torchEnabled)}
          >
            {uiState.torchEnabled ? "Disable torch" : "Enable torch"}
          </button>
        )}

        {uiState?.zoomSupported && (
          <input
            type="range"
            aria-label="Camera zoom"
            min={uiState.minZoom}
            max={uiState.maxZoom}
            step={0.1}
            value={uiState.zoomFactor}
            onChange={(e) => void scannerRef.current?.setZoom(Number(e.target.value))}
          />
        )}

        <button
          type="button"
          onClick={() => scannerRef.current?.getUIController().openManualEntry()}
        >
          Enter barcode manually
        </button>
      </div>

      {uiState?.manualEntryOpen && (
        <form onSubmit={handleManualSubmit} aria-label="Manual barcode entry">
          <select
            aria-label="Barcode format"
            value={manualFormat ?? "auto"}
            onChange={(e) => {
              const v = e.target.value;
              setManualFormat(
                v === "ean13" || v === "upca" || v === "ean8" ? v : undefined,
              );
            }}
          >
            <option value="auto">Auto (EAN-13 / UPC-A / EAN-8)</option>
            <option value="ean13">EAN-13 (13 digits)</option>
            <option value="upca">UPC-A (12 digits)</option>
            <option value="ean8">EAN-8 (8 digits)</option>
          </select>

          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Barcode digits"
            aria-invalid={manualError !== null}
            value={manualDigits}
            onChange={(e) => setManualDigits(e.target.value)}
          />

          {manualError && <p role="alert">{manualError}</p>}

          <button type="submit">Submit barcode</button>
        </form>
      )}
    </section>
  );
}
```

---

## 4. Mode C — Off-Main-Thread Web Worker Decoding

To run WASM decoding inside a dedicated Web Worker with zero JPEG/base64 serialization and bounded queue depth (`queueDepth <= 1`):

### 1. Create `scanner.worker.ts`

```ts
import {
  ZxingWasmAdapter,
  attachDecoderWorkerScope,
  type WorkerGlobalScopeLike,
} from "open-retail-scanner-web";

const adapter = new ZxingWasmAdapter({
  formats: ["ean8", "ean13", "upca"],
  wasmUrl: "/wasm/zxing_reader.wasm",
});

attachDecoderWorkerScope(
  self as unknown as WorkerGlobalScopeLike,
  async (frame) => {
    await adapter.init();
    return adapter.decodeFrame(frame);
  },
);
```

### 2. Configure `createWorkerTransport` on `WebBarcodeScanner`

Using `createWorkerTransport` allows `WebBarcodeScanner` to create a fresh worker on `start()` and terminate it cleanly on `stop()` / `dispose()`:

```ts
import {
  WebBarcodeScanner,
  createWebWorkerTransport,
  type WebWorkerLike,
} from "open-retail-scanner-web";

const scanner = new WebBarcodeScanner({
  zxingOptions: {
    wasmUrl: "/wasm/zxing_reader.wasm",
  },
  createWorkerTransport: () => {
    const worker = new Worker(new URL("./scanner.worker.ts", import.meta.url), {
      type: "module",
    });
    return createWebWorkerTransport(worker as unknown as WebWorkerLike, {
      transferBuffer: true,
    });
  },
});
```

---

## 5. Result Contract, Canonicalization & Error Taxonomy

### `ScanResult` Contract

Every emitted `ScanResult` guarantees a validated GS1 mod-10 check digit:

```ts
interface ScanResult {
  readonly rawValue: string;       // Exact digits decoded (e.g. "036000291452" for UPC-A)
  readonly canonicalValue: string; // Normalized GTIN-13 / EAN-8 (UPC-A gets one leading "0" -> "0036000291452")
  readonly format: "ean8" | "ean13" | "upca";
  readonly bounds?: readonly { readonly x: number; readonly y: number }[];
  readonly timestampMs: number;
  readonly engineVersion: string;  // e.g. "zxing-wasm@3.1.7 (zxing-cpp@...)" or "manual-entry@1.0.0"
  readonly evidence: {
    readonly checksumValid: true;
    readonly confirmingFrames: number; // >= 2 for camera stream, 1 for explicit manual entry
  };
}
```

- **Database Lookup Tip:** Use `result.canonicalValue` when querying EAN-13-indexed databases (such as Open Food Facts) so 12-digit UPC-A codes match their 13-digit EAN-13 representation, or query with `result.rawValue` as fallback. Always keep `result.rawValue` and `result.format` if displaying the printed code format to the user.

### Recoverable Error Codes (`ScannerEvent` with `type: "error"`)

Camera errors are **never** conflated with barcode decode timeouts, and manual entry remains reachable for 100% of recoverable errors:

| Error `code` | Cause | Automatic UI Behaviour |
|---|---|---|
| `camera_permission_denied` | User or browser denied camera access (`NotAllowedError`) | Transitions to `error`, announces accessible message, opens manual entry |
| `camera_not_found` | No rear or environment video input found (`NotFoundError`) | Transitions to `error`, opens manual entry |
| `camera_in_use` | Hardware locked by another app (`NotReadableError`) | Transitions to `error`, offers retry + manual entry |
| `camera_constraints_unsupported` | Both primary (`>=1080p`) and fallback constraints failed | Transitions to `error`, opens manual entry |
| `camera_track_ended` | Camera disconnected or OS interrupted the video track | Stops active pump/scheduler, offers retry + manual entry |
| `camera_unavailable` | `navigator.mediaDevices` is missing (e.g. non-HTTPS origin) | Transitions to `error`, opens manual entry |
| `engine_load_failed` | Local WASM binary failed to load or compile | Transitions to `error`, opens manual entry |
| `internal_error` | Unexpected worker or runtime decode failure | Emits recoverable error; manual entry remains available |

---

## 6. Architectural & Privacy Boundary

When integrating Open Retail Scanner into a consuming application (such as **SafeEat**):

1. **No Product or Health Claims in Scanner Layer:** A `ScanResult` only attests that a checksum-valid barcode was consistently observed across frames (or entered manually). Product database lookup, ingredient extraction, allergen matching, user profiles, and health/safety wording belong strictly in the consuming application.
2. **Zero Sensitive Telemetry:** Never pass `ScanResult.rawValue`, `ScanResult.canonicalValue`, frames, or cropped images to analytics or crash reporters. If you collect operational diagnostics, call `scanner.getDiagnostics()` which returns a validated, privacy-safe `DiagnosticEvent` checked by `assertPrivacySafePayload` and `validateDiagnosticEvent`.
