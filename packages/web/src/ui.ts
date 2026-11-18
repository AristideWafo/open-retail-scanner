import {
  canonicalValue,
  isValidCode,
  type BarcodeFormat,
  type GuidanceReason,
  type ScannerEvent,
  type ScanResult,
} from "open-retail-scanner-core";
import type { CameraCapabilitiesReport } from "./camera.ts";

export type ScannerUILifecycleState =
  | "idle"
  | "starting"
  | "running"
  | "stopped"
  | "error";

export type ScannerFocusTarget = "scanner" | "manual_input" | "retry_button";

export const MANUAL_ENTRY_ENGINE_VERSION = "manual-entry@1.0.0";

export const GUIDANCE_MESSAGES: Readonly<Record<GuidanceReason, string>> = {
  too_far: "Move closer to the barcode",
  too_blurry: "Hold steady",
  glare: "Adjust angle to reduce glare",
  too_dark: "Increase lighting or use manual entry",
  code_not_found: "Center the barcode in the frame or use manual entry",
};

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  camera_permission_denied:
    "Camera permission denied. Allow camera access or enter the barcode manually.",
  permission_denied:
    "Camera permission denied. Allow camera access or enter the barcode manually.",
  camera_not_found: "No camera found. Enter the barcode manually.",
  camera_in_use:
    "Camera is in use by another application. Retry or enter the barcode manually.",
  camera_constraints_unsupported:
    "Camera constraints are unsupported on this device. Enter the barcode manually.",
  camera_track_ended:
    "Camera stream ended. Retry camera or enter the barcode manually.",
  camera_interrupted:
    "Camera stream interrupted. Retry camera or enter the barcode manually.",
  camera_unavailable:
    "Camera is unavailable in this browser. Enter the barcode manually.",
  unsupported_platform:
    "Camera scanning is unsupported in this browser. Enter the barcode manually.",
  engine_load_failed:
    "Scanner decoder failed to load. Retry or enter the barcode manually.",
  decode_timeout:
    "Barcode was not decoded in time. Retry or enter the barcode manually.",
  resource_limit:
    "Scanner reached a device resource limit. Retry or enter the barcode manually.",
  internal_error:
    "Scanner encountered an unexpected error. Retry or enter the barcode manually.",
};

const FORMAT_LENGTH: Readonly<Record<BarcodeFormat, number>> = {
  ean8: 8,
  upca: 12,
  ean13: 13,
};

const FORMAT_LABEL: Readonly<Record<BarcodeFormat, string>> = {
  ean8: "EAN-8",
  upca: "UPC-A",
  ean13: "EAN-13",
};

export interface ScannerUIState {
  readonly state: ScannerUILifecycleState;
  readonly manualEntryOpen: boolean;
  readonly manualInputValue: string;
  readonly manualFormat: BarcodeFormat;
  readonly manualValidationError: string | null;
  readonly guidance: GuidanceReason | null;
  readonly errorCode: string | null;
  readonly torchEnabled: boolean;
  readonly torchSupported: boolean;
  readonly zoomFactor: number;
  readonly zoomSupported: boolean;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly ariaLiveMessage: string;
  readonly activeFocusTarget: ScannerFocusTarget;
}

export type ManualSubmitResult =
  | { readonly ok: true; readonly result: ScanResult }
  | { readonly ok: false; readonly message: string };

export interface ScannerUIControllerOptions {
  readonly initialFormat?: BarcodeFormat;
  readonly now?: () => number;
  readonly onResult?: (result: ScanResult) => void;
  readonly onStop?: () => void;
  readonly onRetry?: () => void;
  readonly onTorchChange?: (enabled: boolean) => Promise<boolean> | boolean;
  readonly onZoomChange?: (factor: number) => Promise<boolean> | boolean;
}

export interface ScannerDomView {
  destroy(): void;
}

/** Returns a neutral, accessible message for a scanner or camera error code. */
export function getAccessibleErrorMessage(
  code: string,
  recoverable = true,
): string {
  const known = ERROR_MESSAGES[code];
  if (known) {
    return known;
  }
  return recoverable
    ? "Scanner error occurred. Retry or enter the barcode manually."
    : "Camera scanning is unavailable. Enter the barcode manually.";
}

/** Returns the neutral, action-oriented guidance string for a guidance reason. */
export function getGuidanceMessage(reason: GuidanceReason): string {
  return GUIDANCE_MESSAGES[reason];
}

function inferManualFormat(
  digits: string,
  explicitFormat: BarcodeFormat | undefined,
  currentFormat: BarcodeFormat,
): BarcodeFormat {
  if (explicitFormat) {
    return explicitFormat;
  }
  if (/^\d+$/.test(digits)) {
    if (digits.length === 8) return "ean8";
    if (digits.length === 12) return "upca";
    if (digits.length === 13) return "ean13";
  }
  return currentFormat;
}

function buildManualValidationMessage(
  trimmed: string,
  format: BarcodeFormat,
  explicitFormat: boolean,
): string {
  if (trimmed.length === 0 || !/^\d+$/.test(trimmed)) {
    return "Enter digits only: 8 digits for EAN-8, 12 for UPC-A, or 13 for EAN-13.";
  }
  const expectedLength = FORMAT_LENGTH[format];
  if (trimmed.length !== expectedLength) {
    return explicitFormat
      ? `Enter exactly ${expectedLength} digits for ${FORMAT_LABEL[format]}.`
      : "Enter 8 digits for EAN-8, 12 digits for UPC-A, or 13 digits for EAN-13.";
  }
  return "Check digit is invalid. Verify the digits and try again.";
}

/**
 * Engine-independent, accessible minimal scanner UI controller and state machine.
 * Guarantees manual entry remains reachable in every lifecycle and failure state.
 */
export class ScannerUIController {
  private readonly now: () => number;
  private readonly onResult: ((result: ScanResult) => void) | undefined;
  private readonly onStop: (() => void) | undefined;
  private readonly onRetry: (() => void) | undefined;
  private readonly onTorchChange:
    | ((enabled: boolean) => Promise<boolean> | boolean)
    | undefined;
  private readonly onZoomChange:
    | ((factor: number) => Promise<boolean> | boolean)
    | undefined;
  private readonly listeners = new Set<(state: ScannerUIState) => void>();

  private currentState: ScannerUIState;

  constructor(options: ScannerUIControllerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.onResult = options.onResult;
    this.onStop = options.onStop;
    this.onRetry = options.onRetry;
    this.onTorchChange = options.onTorchChange;
    this.onZoomChange = options.onZoomChange;

    this.currentState = {
      state: "idle",
      manualEntryOpen: false,
      manualInputValue: "",
      manualFormat: options.initialFormat ?? "ean13",
      manualValidationError: null,
      guidance: null,
      errorCode: null,
      torchEnabled: false,
      torchSupported: false,
      zoomFactor: 1,
      zoomSupported: false,
      minZoom: 1,
      maxZoom: 1,
      ariaLiveMessage: "Scanner ready.",
      activeFocusTarget: "scanner",
    };
  }

  getState(): ScannerUIState {
    return this.currentState;
  }

  subscribe(listener: (state: ScannerUIState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Manual entry is unconditionally reachable in all states and all failure paths. */
  isManualEntryReachable(): true {
    return true;
  }

  handleScannerEvent(event: ScannerEvent): void {
    switch (event.type) {
      case "state": {
        const message =
          event.state === "starting"
            ? "Starting camera."
            : event.state === "running"
              ? "Camera active. Align barcode inside frame."
              : "Scanner stopped.";
        this.updateState({
          state: event.state,
          errorCode: null,
          guidance: event.state === "stopped" ? null : this.currentState.guidance,
          torchEnabled:
            event.state === "stopped" ? false : this.currentState.torchEnabled,
          ariaLiveMessage: this.currentState.manualEntryOpen
            ? this.currentState.ariaLiveMessage
            : message,
          activeFocusTarget: this.currentState.manualEntryOpen
            ? "manual_input"
            : "scanner",
        });
        return;
      }
      case "guidance": {
        this.updateState({
          guidance: event.reason,
          ariaLiveMessage: this.currentState.manualEntryOpen
            ? this.currentState.ariaLiveMessage
            : GUIDANCE_MESSAGES[event.reason],
        });
        return;
      }
      case "error": {
        this.updateState({
          state: "error",
          errorCode: event.code,
          guidance: null,
          torchEnabled: false,
          ariaLiveMessage: getAccessibleErrorMessage(event.code, event.recoverable),
          activeFocusTarget: this.currentState.manualEntryOpen
            ? "manual_input"
            : "retry_button",
        });
        return;
      }
      case "result": {
        this.updateState({
          guidance: null,
          errorCode: null,
          ariaLiveMessage: "Barcode scanned.",
        });
        this.onResult?.(event.result);
      }
    }
  }

  setCapabilities(
    capabilities: Pick<
      CameraCapabilitiesReport,
      "torchSupported" | "zoomSupported" | "minZoom" | "maxZoom"
    >,
  ): void {
    const zoomSupported =
      capabilities.zoomSupported &&
      Number.isFinite(capabilities.minZoom) &&
      Number.isFinite(capabilities.maxZoom) &&
      capabilities.maxZoom > capabilities.minZoom;
    const minZoom = zoomSupported ? capabilities.minZoom : 1;
    const maxZoom = zoomSupported ? capabilities.maxZoom : 1;
    const clampedZoom = Math.min(
      maxZoom,
      Math.max(minZoom, this.currentState.zoomFactor),
    );

    this.updateState({
      torchSupported: capabilities.torchSupported,
      torchEnabled: capabilities.torchSupported ? this.currentState.torchEnabled : false,
      zoomSupported,
      minZoom,
      maxZoom,
      zoomFactor: clampedZoom,
    });
  }

  openManualEntry(): void {
    this.updateState({
      manualEntryOpen: true,
      manualValidationError: null,
      activeFocusTarget: "manual_input",
      ariaLiveMessage: "Manual barcode entry opened.",
    });
  }

  closeManualEntry(): void {
    this.updateState({
      manualEntryOpen: false,
      manualValidationError: null,
      activeFocusTarget:
        this.currentState.state === "error" ? "retry_button" : "scanner",
      ariaLiveMessage: "Manual barcode entry closed.",
    });
  }

  setManualInputValue(value: string): void {
    this.updateState({
      manualInputValue: value,
      manualValidationError: null,
    });
  }

  setManualFormat(format: BarcodeFormat): void {
    this.updateState({
      manualFormat: format,
      manualValidationError: null,
    });
  }

  submitManualEntry(
    rawValue: string = this.currentState.manualInputValue,
    format?: BarcodeFormat,
  ): ManualSubmitResult {
    const trimmed = rawValue.trim();
    const resolvedFormat = inferManualFormat(
      trimmed,
      format,
      this.currentState.manualFormat,
    );

    if (!isValidCode(trimmed, resolvedFormat)) {
      const message = buildManualValidationMessage(
        trimmed,
        resolvedFormat,
        format !== undefined,
      );
      this.updateState({
        manualEntryOpen: true,
        manualInputValue: rawValue,
        manualFormat: resolvedFormat,
        manualValidationError: message,
        activeFocusTarget: "manual_input",
        ariaLiveMessage: message,
      });
      return { ok: false, message };
    }

    const result: ScanResult = {
      rawValue: trimmed,
      canonicalValue: canonicalValue(trimmed, resolvedFormat),
      format: resolvedFormat,
      timestampMs: this.now(),
      engineVersion: MANUAL_ENTRY_ENGINE_VERSION,
      evidence: {
        checksumValid: true,
        confirmingFrames: 1,
      },
    };

    this.updateState({
      manualEntryOpen: false,
      manualInputValue: "",
      manualFormat: resolvedFormat,
      manualValidationError: null,
      errorCode: null,
      guidance: null,
      activeFocusTarget: "scanner",
      ariaLiveMessage: "Manual barcode entry accepted.",
    });
    this.onResult?.(result);
    return { ok: true, result };
  }

  async setTorchEnabled(enabled: boolean): Promise<boolean> {
    if (!this.currentState.torchSupported) {
      return false;
    }
    const applied = this.onTorchChange ? await this.onTorchChange(enabled) : true;
    if (!applied) {
      return false;
    }
    this.updateState({
      torchEnabled: enabled,
      ariaLiveMessage: enabled ? "Torch turned on." : "Torch turned off.",
    });
    return true;
  }

  async toggleTorch(): Promise<boolean> {
    return this.setTorchEnabled(!this.currentState.torchEnabled);
  }

  async setZoomFactor(factor: number): Promise<boolean> {
    if (!this.currentState.zoomSupported || !Number.isFinite(factor)) {
      return false;
    }
    const clamped = Math.min(
      this.currentState.maxZoom,
      Math.max(this.currentState.minZoom, factor),
    );
    const applied = this.onZoomChange ? await this.onZoomChange(clamped) : true;
    if (!applied) {
      return false;
    }
    this.updateState({
      zoomFactor: clamped,
      ariaLiveMessage: `Zoom set to ${clamped.toFixed(1)}x.`,
    });
    return true;
  }

  requestRetry(): void {
    this.updateState({
      state: "starting",
      errorCode: null,
      guidance: null,
      activeFocusTarget: "scanner",
      ariaLiveMessage: "Retrying camera.",
    });
    this.onRetry?.();
  }

  requestStop(): void {
    this.updateState({
      state: "stopped",
      guidance: null,
      torchEnabled: false,
      activeFocusTarget: "scanner",
      ariaLiveMessage: "Scanner stopped.",
    });
    this.onStop?.();
  }

  setFocusTarget(target: ScannerFocusTarget): void {
    this.updateState({ activeFocusTarget: target });
  }

  /**
   * Handles keyboard accessibility shortcuts (`Escape` closes manual entry
   * or stops an active scanner session). Returns `true` when handled.
   */
  handleKeyDown(
    input: string | { readonly key: string; preventDefault?: () => void },
  ): boolean {
    const key = typeof input === "string" ? input : input.key;
    if (key !== "Escape") {
      return false;
    }

    if (typeof input !== "string") {
      input.preventDefault?.();
    }

    if (this.currentState.manualEntryOpen) {
      this.closeManualEntry();
      return true;
    }

    if (this.currentState.state === "running" || this.currentState.state === "starting") {
      this.requestStop();
      return true;
    }

    return false;
  }

  private updateState(patch: Partial<ScannerUIState>): void {
    this.currentState = {
      ...this.currentState,
      ...patch,
    };
    for (const listener of this.listeners) {
      listener(this.currentState);
    }
  }
}

/**
 * Optional, dependency-free DOM view binding for {@link ScannerUIController}.
 * Uses safe DOM node creation only (never `innerHTML`) and preserves full keyboard
 * and screen-reader accessibility.
 */
export function mountScannerUI(
  controller: ScannerUIController,
  root: HTMLElement,
): ScannerDomView {
  const doc = root.ownerDocument;

  const container = doc.createElement("section");
  container.setAttribute("aria-label", "Barcode scanner");
  container.tabIndex = -1;

  const liveRegion = doc.createElement("div");
  liveRegion.setAttribute("role", "status");
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("aria-atomic", "true");

  const guidanceEl = doc.createElement("p");
  guidanceEl.setAttribute("data-role", "guidance");

  const errorBanner = doc.createElement("div");
  errorBanner.setAttribute("role", "alert");

  const errorText = doc.createElement("p");
  const retryButton = doc.createElement("button");
  retryButton.type = "button";
  retryButton.textContent = "Retry camera";

  const controls = doc.createElement("div");

  const manualOpenButton = doc.createElement("button");
  manualOpenButton.type = "button";
  manualOpenButton.textContent = "Enter barcode manually";

  const torchButton = doc.createElement("button");
  torchButton.type = "button";
  torchButton.textContent = "Toggle torch";

  const zoomInput = doc.createElement("input");
  zoomInput.type = "range";
  zoomInput.step = "0.1";
  zoomInput.setAttribute("aria-label", "Camera zoom");

  const stopButton = doc.createElement("button");
  stopButton.type = "button";
  stopButton.textContent = "Stop scanner";

  const manualForm = doc.createElement("form");
  manualForm.setAttribute("aria-label", "Manual barcode entry");

  const formatSelect = doc.createElement("select");
  formatSelect.setAttribute("aria-label", "Barcode format");
  for (const format of ["ean13", "upca", "ean8"] as const) {
    const option = doc.createElement("option");
    option.value = format;
    option.textContent = FORMAT_LABEL[format];
    formatSelect.appendChild(option);
  }

  const manualInput = doc.createElement("input");
  manualInput.type = "text";
  manualInput.inputMode = "numeric";
  manualInput.autocomplete = "off";
  manualInput.setAttribute("aria-label", "Barcode digits");

  const manualError = doc.createElement("p");
  manualError.setAttribute("role", "alert");

  const submitButton = doc.createElement("button");
  submitButton.type = "submit";
  submitButton.textContent = "Submit barcode";

  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  errorBanner.append(errorText, retryButton);
  controls.append(manualOpenButton, torchButton, zoomInput, stopButton);
  manualForm.append(
    formatSelect,
    manualInput,
    manualError,
    submitButton,
    cancelButton,
  );
  container.append(liveRegion, guidanceEl, errorBanner, controls, manualForm);
  root.appendChild(container);

  const onRetryClick = (): void => {
    controller.requestRetry();
  };
  const onManualOpenClick = (): void => {
    controller.openManualEntry();
  };
  const onTorchClick = (): void => {
    void controller.toggleTorch();
  };
  const onZoomInput = (): void => {
    void controller.setZoomFactor(Number(zoomInput.value));
  };
  const onStopClick = (): void => {
    controller.requestStop();
  };
  const onFormatChange = (): void => {
    const value = formatSelect.value;
    if (value === "ean8" || value === "upca" || value === "ean13") {
      controller.setManualFormat(value);
    }
  };
  const onManualInput = (): void => {
    controller.setManualInputValue(manualInput.value);
  };
  const onManualSubmit = (event: Event): void => {
    event.preventDefault();
    controller.submitManualEntry(manualInput.value, formatSelect.value as BarcodeFormat);
  };
  const onCancelClick = (): void => {
    controller.closeManualEntry();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    controller.handleKeyDown(event);
  };

  retryButton.addEventListener("click", onRetryClick);
  manualOpenButton.addEventListener("click", onManualOpenClick);
  torchButton.addEventListener("click", onTorchClick);
  zoomInput.addEventListener("input", onZoomInput);
  stopButton.addEventListener("click", onStopClick);
  formatSelect.addEventListener("change", onFormatChange);
  manualInput.addEventListener("input", onManualInput);
  manualForm.addEventListener("submit", onManualSubmit);
  cancelButton.addEventListener("click", onCancelClick);
  container.addEventListener("keydown", onKeyDown);

  let previousFocusTarget: ScannerFocusTarget | null = null;

  const render = (state: ScannerUIState): void => {
    liveRegion.textContent = state.ariaLiveMessage;

    guidanceEl.textContent = state.guidance ? GUIDANCE_MESSAGES[state.guidance] : "";
    guidanceEl.hidden = state.guidance === null;

    const hasError = state.state === "error" && state.errorCode !== null;
    errorBanner.hidden = !hasError;
    errorText.textContent = hasError && state.errorCode
      ? getAccessibleErrorMessage(state.errorCode)
      : "";

    torchButton.hidden = !state.torchSupported;
    torchButton.setAttribute("aria-pressed", state.torchEnabled ? "true" : "false");

    zoomInput.hidden = !state.zoomSupported;
    zoomInput.min = String(state.minZoom);
    zoomInput.max = String(state.maxZoom);
    zoomInput.value = String(state.zoomFactor);

    stopButton.hidden = state.state !== "running" && state.state !== "starting";

    manualForm.hidden = !state.manualEntryOpen;
    formatSelect.value = state.manualFormat;
    if (manualInput.value !== state.manualInputValue) {
      manualInput.value = state.manualInputValue;
    }
    manualError.textContent = state.manualValidationError ?? "";
    manualError.hidden = state.manualValidationError === null;
    manualInput.setAttribute(
      "aria-invalid",
      state.manualValidationError ? "true" : "false",
    );

    if (state.activeFocusTarget !== previousFocusTarget) {
      previousFocusTarget = state.activeFocusTarget;
      if (state.activeFocusTarget === "manual_input" && state.manualEntryOpen) {
        manualInput.focus?.();
      } else if (state.activeFocusTarget === "retry_button" && hasError) {
        retryButton.focus?.();
      } else {
        container.focus?.();
      }
    }
  };

  render(controller.getState());
  const unsubscribe = controller.subscribe(render);

  return {
    destroy(): void {
      unsubscribe();
      retryButton.removeEventListener("click", onRetryClick);
      manualOpenButton.removeEventListener("click", onManualOpenClick);
      torchButton.removeEventListener("click", onTorchClick);
      zoomInput.removeEventListener("input", onZoomInput);
      stopButton.removeEventListener("click", onStopClick);
      formatSelect.removeEventListener("change", onFormatChange);
      manualInput.removeEventListener("input", onManualInput);
      manualForm.removeEventListener("submit", onManualSubmit);
      cancelButton.removeEventListener("click", onCancelClick);
      container.removeEventListener("keydown", onKeyDown);
      container.remove();
    },
  };
}
