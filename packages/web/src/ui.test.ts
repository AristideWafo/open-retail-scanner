import { test } from "node:test";
import assert from "node:assert/strict";
import type { GuidanceReason, ScanResult } from "open-retail-scanner-core";
import {
  GUIDANCE_MESSAGES,
  MANUAL_ENTRY_ENGINE_VERSION,
  ScannerUIController,
  getAccessibleErrorMessage,
  getGuidanceMessage,
  mountScannerUI,
  type ScannerUILifecycleState,
} from "./ui.ts";

const FORBIDDEN_CLAIMS_RE =
  /\b(?:safe|unsafe|allergen|allergy|allergies|food|eat|consume|consumption|health|medical|ingredient|ingredients|product|nutrition|diet|diagnose|diagnosis|symptom|symptoms|toxic|gluten|peanut|dairy|halal|vegan|brand)\b/i;

test("tracks lifecycle states, guidance, error, and capabilities", async () => {
  const results: ScanResult[] = [];
  let torchCalls: boolean[] = [];
  let zoomCalls: number[] = [];

  const controller = new ScannerUIController({
    now: () => 1_700_000_000_000,
    onResult: (result) => results.push(result),
    onTorchChange: (enabled) => {
      torchCalls.push(enabled);
      return true;
    },
    onZoomChange: (factor) => {
      zoomCalls.push(factor);
      return true;
    },
  });

  assert.equal(controller.getState().state, "idle");
  assert.equal(controller.getState().manualEntryOpen, false);
  assert.equal(controller.getState().activeFocusTarget, "scanner");

  controller.handleScannerEvent({ type: "state", state: "starting" });
  assert.equal(controller.getState().state, "starting");

  controller.handleScannerEvent({ type: "state", state: "running" });
  assert.equal(controller.getState().state, "running");

  controller.setCapabilities({
    torchSupported: true,
    zoomSupported: true,
    minZoom: 1,
    maxZoom: 3,
  });
  assert.equal(await controller.toggleTorch(), true);
  assert.equal(controller.getState().torchEnabled, true);
  assert.equal(await controller.setZoomFactor(5), true); // Clamped to 3
  assert.equal(controller.getState().zoomFactor, 3);
  assert.deepEqual(torchCalls, [true]);
  assert.deepEqual(zoomCalls, [3]);

  controller.handleScannerEvent({ type: "guidance", reason: "too_far" });
  assert.equal(controller.getState().guidance, "too_far");
  assert.equal(
    controller.getState().ariaLiveMessage,
    "Move closer to the barcode",
  );

  controller.handleScannerEvent({
    type: "result",
    result: {
      rawValue: "4006381333931",
      canonicalValue: "4006381333931",
      format: "ean13",
      timestampMs: 1_700_000_000_001,
      engineVersion: "zxing-wasm@2.2.0",
      evidence: { checksumValid: true, confirmingFrames: 2 },
    },
  });
  assert.equal(results.length, 1);
  assert.equal(controller.getState().guidance, null);
  // Barcode digits must never be placed in ariaLiveMessage.
  assert.equal(controller.getState().ariaLiveMessage.includes("4006381333931"), false);

  // Unsupported torch/zoom safely return false.
  controller.setCapabilities({
    torchSupported: false,
    zoomSupported: false,
    minZoom: 1,
    maxZoom: 1,
  });
  assert.equal(controller.getState().torchEnabled, false);
  assert.equal(await controller.toggleTorch(), false);
  assert.equal(await controller.setZoomFactor(2), false);
});

test("manual entry is reachable in 100% of states and recoverable error paths", () => {
  const states: ScannerUILifecycleState[] = [
    "idle",
    "starting",
    "running",
    "stopped",
    "error",
  ];
  for (const targetState of states) {
    const controller = new ScannerUIController();
    if (targetState === "starting" || targetState === "running" || targetState === "stopped") {
      controller.handleScannerEvent({ type: "state", state: targetState });
    } else if (targetState === "error") {
      controller.handleScannerEvent({
        type: "error",
        code: "camera_permission_denied",
        recoverable: true,
      });
    }
    assert.equal(controller.getState().state, targetState);
    assert.equal(controller.isManualEntryReachable(), true);
    controller.openManualEntry();
    assert.equal(controller.getState().manualEntryOpen, true);
    assert.equal(controller.getState().activeFocusTarget, "manual_input");
  }

  const errorCodes = [
    "camera_permission_denied",
    "camera_not_found",
    "camera_in_use",
    "camera_constraints_unsupported",
    "camera_track_ended",
    "camera_unavailable",
    "engine_load_failed",
    "decode_timeout",
    "resource_limit",
  ];

  for (const code of errorCodes) {
    const controller = new ScannerUIController({ now: () => 42 });
    controller.handleScannerEvent({ type: "error", code, recoverable: true });
    assert.equal(controller.getState().state, "error");
    assert.equal(controller.getState().errorCode, code);
    assert.equal(controller.getState().activeFocusTarget, "retry_button");
    assert.equal(controller.isManualEntryReachable(), true);

    controller.openManualEntry();
    assert.equal(controller.getState().manualEntryOpen, true);
    const submitted = controller.submitManualEntry("4006381333931");
    assert.equal(submitted.ok, true);
    if (submitted.ok) {
      assert.equal(submitted.result.rawValue, "4006381333931");
      assert.equal(submitted.result.canonicalValue, "4006381333931");
      assert.equal(submitted.result.format, "ean13");
      assert.equal(submitted.result.engineVersion, MANUAL_ENTRY_ENGINE_VERSION);
      assert.equal(submitted.result.evidence.checksumValid, true);
      assert.equal(submitted.result.evidence.confirmingFrames, 1);
    }
  }
});

test("submitManualEntry validates checksums, normalizes UPC-A, and rejects bad codes", () => {
  const emitted: ScanResult[] = [];
  const controller = new ScannerUIController({
    now: () => 12345,
    onResult: (res) => emitted.push(res),
  });

  // Valid UPC-A auto-inferred by length and canonicalized with leading zero.
  controller.openManualEntry();
  const upcResult = controller.submitManualEntry(" 036000291452 ");
  assert.equal(upcResult.ok, true);
  if (upcResult.ok) {
    assert.equal(upcResult.result.rawValue, "036000291452");
    assert.equal(upcResult.result.canonicalValue, "0036000291452");
    assert.equal(upcResult.result.format, "upca");
    assert.equal(upcResult.result.timestampMs, 12345);
    assert.equal(upcResult.result.engineVersion, "manual-entry@1.0.0");
    assert.equal(upcResult.result.evidence.confirmingFrames, 1);
    assert.equal(upcResult.result.evidence.checksumValid, true);
  }
  assert.equal(controller.getState().manualEntryOpen, false);

  // Valid EAN-8.
  controller.openManualEntry();
  const ean8Result = controller.submitManualEntry("96385074");
  assert.equal(ean8Result.ok, true);
  if (ean8Result.ok) {
    assert.equal(ean8Result.result.format, "ean8");
    assert.equal(ean8Result.result.canonicalValue, "96385074");
  }
  assert.equal(emitted.length, 2);

  // Invalid check digit.
  controller.openManualEntry();
  const badCheck = controller.submitManualEntry("4006381333932", "ean13");
  assert.equal(badCheck.ok, false);
  if (!badCheck.ok) {
    assert.match(badCheck.message, /check digit/i);
    assert.equal(badCheck.message.includes("4006381333932"), false);
  }
  assert.equal(controller.getState().manualEntryOpen, true);
  assert.equal(controller.getState().activeFocusTarget, "manual_input");
  assert.equal(
    controller.getState().ariaLiveMessage.includes("4006381333932"),
    false,
  );

  // Explicit format mismatch (12 digits submitted as ean13).
  const mismatch = controller.submitManualEntry("036000291452", "ean13");
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.match(mismatch.message, /13 digits/i);
  }

  // Non-digit characters rejected.
  const nonDigits = controller.submitManualEntry("40063813339X1");
  assert.equal(nonDigits.ok, false);
  if (!nonDigits.ok) {
    assert.match(nonDigits.message, /digits only/i);
  }
  assert.equal(emitted.length, 2);
});

test("keyboard accessibility: Escape closes manual entry or stops active scanner", () => {
  let stopCount = 0;
  const controller = new ScannerUIController({
    onStop: () => {
      stopCount += 1;
    },
  });

  // Escape when idle does nothing.
  assert.equal(controller.handleKeyDown("Escape"), false);

  // Escape while running stops scanner.
  controller.handleScannerEvent({ type: "state", state: "running" });
  assert.equal(controller.handleKeyDown({ key: "Escape" }), true);
  assert.equal(stopCount, 1);
  assert.equal(controller.getState().state, "stopped");

  // Escape while manual entry is open in error state returns focus to retry_button.
  controller.handleScannerEvent({
    type: "error",
    code: "camera_in_use",
    recoverable: true,
  });
  assert.equal(controller.getState().activeFocusTarget, "retry_button");
  controller.openManualEntry();
  assert.equal(controller.getState().activeFocusTarget, "manual_input");
  assert.equal(controller.handleKeyDown("Escape"), true);
  assert.equal(controller.getState().manualEntryOpen, false);
  assert.equal(controller.getState().activeFocusTarget, "retry_button");
});

test("no guidance, error, or UI string contains forbidden food, health, or product claims", () => {
  const reasons: GuidanceReason[] = [
    "too_dark",
    "too_blurry",
    "too_far",
    "glare",
    "code_not_found",
  ];

  for (const reason of reasons) {
    const msg = getGuidanceMessage(reason);
    assert.equal(
      FORBIDDEN_CLAIMS_RE.test(msg),
      false,
      `Guidance "${reason}" contained forbidden claim: ${msg}`,
    );
    assert.equal(GUIDANCE_MESSAGES[reason], msg);
  }

  const errorCodes = [
    "camera_permission_denied",
    "permission_denied",
    "camera_not_found",
    "camera_in_use",
    "camera_constraints_unsupported",
    "camera_track_ended",
    "camera_interrupted",
    "camera_unavailable",
    "unsupported_platform",
    "engine_load_failed",
    "decode_timeout",
    "resource_limit",
    "internal_error",
    "unknown_error_code",
  ];

  for (const code of errorCodes) {
    for (const recoverable of [true, false]) {
      const msg = getAccessibleErrorMessage(code, recoverable);
      assert.equal(
        FORBIDDEN_CLAIMS_RE.test(msg),
        false,
        `Error "${code}" contained forbidden claim: ${msg}`,
      );
    }
  }

  const uiMessages: string[] = [];
  const controller = new ScannerUIController();
  controller.subscribe((s) => {
    uiMessages.push(s.ariaLiveMessage);
    if (s.manualValidationError) {
      uiMessages.push(s.manualValidationError);
    }
  });

  controller.handleScannerEvent({ type: "state", state: "starting" });
  controller.handleScannerEvent({ type: "state", state: "running" });
  for (const reason of reasons) {
    controller.handleScannerEvent({ type: "guidance", reason });
  }
  controller.handleScannerEvent({
    type: "error",
    code: "camera_permission_denied",
    recoverable: true,
  });
  controller.openManualEntry();
  controller.submitManualEntry("bad");
  controller.submitManualEntry("4006381333932", "ean13");
  controller.submitManualEntry("4006381333931", "ean13");
  controller.requestRetry();
  controller.requestStop();

  for (const msg of uiMessages) {
    assert.equal(
      FORBIDDEN_CLAIMS_RE.test(msg),
      false,
      `UI message contained forbidden claim: ${msg}`,
    );
  }
});

test("mountScannerUI binds accessible DOM controls and cleans up on destroy()", () => {
  // Minimal DOM mock so the optional DOM view is deterministically verified in Node.
  class MockElement {
    readonly tagName: string;
    readonly children: MockElement[] = [];
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, Set<(event: unknown) => void>>();
    textContent = "";
    hidden = false;
    tabIndex = 0;
    type = "";
    value = "";
    inputMode = "";
    autocomplete = "";
    min = "";
    max = "";
    step = "";
    focusCalls = 0;
    parentNode: MockElement | null = null;
    readonly ownerDocument: { createElement(tag: string): MockElement };

    constructor(
      tagName: string,
      ownerDocument: { createElement(tag: string): MockElement },
    ) {
      this.tagName = tagName;
      this.ownerDocument = ownerDocument;
    }

    appendChild(child: MockElement): MockElement {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    append(...nodes: MockElement[]): void {
      for (const node of nodes) {
        this.appendChild(node);
      }
    }

    remove(): void {
      if (this.parentNode) {
        const idx = this.parentNode.children.indexOf(this);
        if (idx >= 0) {
          this.parentNode.children.splice(idx, 1);
        }
        this.parentNode = null;
      }
    }

    setAttribute(name: string, val: string): void {
      this.attributes.set(name, val);
    }

    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    }

    addEventListener(type: string, fn: (event: unknown) => void): void {
      let set = this.listeners.get(type);
      if (!set) {
        set = new Set();
        this.listeners.set(type, set);
      }
      set.add(fn);
    }

    removeEventListener(type: string, fn: (event: unknown) => void): void {
      this.listeners.get(type)?.delete(fn);
    }

    dispatch(type: string, event: Record<string, unknown> = {}): void {
      for (const fn of [...(this.listeners.get(type) ?? [])]) {
        fn(event);
      }
    }

    focus(): void {
      this.focusCalls += 1;
    }
  }

  const doc = {
    createElement(tag: string): MockElement {
      return new MockElement(tag, doc);
    },
  };
  const root = doc.createElement("div");

  const results: ScanResult[] = [];
  const controller = new ScannerUIController({
    now: () => 999,
    onResult: (r) => results.push(r),
  });

  const view = mountScannerUI(controller, root as unknown as HTMLElement);
  const section = root.children[0]!;
  const liveRegion = section.children[0]!;
  const controls = section.children[3]!;
  const manualOpenButton = controls.children[0]!;
  const manualForm = section.children[4]!;
  const manualInput = manualForm.children[1]!;

  assert.equal(liveRegion.getAttribute("aria-live"), "polite");
  assert.equal(manualForm.hidden, true);

  manualOpenButton.dispatch("click");
  assert.equal(manualForm.hidden, false);
  assert.equal(manualInput.focusCalls, 1);

  manualInput.value = "4006381333931";
  manualInput.dispatch("input");
  manualForm.dispatch("submit", { preventDefault() {} });
  assert.equal(results.length, 1);
  assert.equal(manualForm.hidden, true);

  // Escape closes manual entry via keydown listener on container.
  manualOpenButton.dispatch("click");
  assert.equal(manualForm.hidden, false);
  section.dispatch("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(manualForm.hidden, true);

  view.destroy();
  assert.equal(root.children.length, 0);
  assert.equal(section.listeners.get("keydown")?.size ?? 0, 0);
});
