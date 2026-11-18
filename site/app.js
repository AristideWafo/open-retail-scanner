import {
  computeCheckDigit,
  isValidCode,
} from "open-retail-scanner-core";
import {
  WebBarcodeScanner,
  renderLinearBarcodeFrame,
} from "open-retail-scanner-web";

const WASM_URL = "./vendor/zxing-wasm/zxing_reader.wasm";

const FORMAT_LENGTH = {
  ean8: 8,
  upca: 12,
  ean13: 13,
};

const FORMAT_LABELS = {
  ean8: "EAN-8",
  upca: "UPC-A",
  ean13: "EAN-13",
};

const DEVICE_LABELS = {
  ios_safari_low: "Device: ios_safari_low",
  ios_safari_mid: "Device: ios_safari_mid",
  android_chrome_low: "Device: android_chrome_low",
  android_chrome_mid: "Device: android_chrome_mid",
};

const CONDITION_LABELS = {
  normal: "Condition: normal",
  low_light: "Condition: low_light",
  glare_curved: "Condition: glare_curved",
  small_damaged: "Condition: small_damaged",
};

const SYMBOLOGY_LABELS = {
  ean13: "Symbology: ean13",
  upca: "Symbology: upca",
  ean8: "Symbology: ean8",
};

// --- DOM References ---
const simCanvas = document.getElementById("sim-canvas");
const simBoundsOverlay = document.getElementById("sim-bounds-overlay");
const simBoundsPoly = document.getElementById("sim-bounds-poly");
const simFrameMeta = document.getElementById("sim-frame-meta");
const simEngineStatus = document.getElementById("sim-engine-status");
const simLatencyEl = document.getElementById("sim-latency");
const simSchedulerCountsEl = document.getElementById("sim-scheduler-counts");
const simQueueDepthEl = document.getElementById("sim-queue-depth");
const simConsensusStatusEl = document.getElementById("sim-consensus-status");
const simResultBadge = document.getElementById("sim-result-badge");
const simResultJson = document.getElementById("sim-result-json");
const simDiagJson = document.getElementById("sim-diag-json");

const customCodeBox = document.getElementById("custom-code-box");
const customFormatSelect = document.getElementById("custom-format-select");
const customDigitsInput = document.getElementById("custom-digits-input");
const customValidationMsg = document.getElementById("custom-validation-msg");
const btnCalcCheckDigit = document.getElementById("btn-calc-checkdigit");
const btnRunSim = document.getElementById("btn-run-sim");

const presetButtons = Array.from(document.querySelectorAll("[data-preset]"));
const conditionButtons = Array.from(document.querySelectorAll("[data-condition]"));

// --- Simulator State ---
let simFormat = "ean13";
let simCode = "4006381333931";
let simCondition = "normal";
let simTimestampBase = 1000;
let simRunChain = Promise.resolve();

let simScanner = null;
let simPendingResolve = null;

function formatPercent(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatCI(ci) {
  return `[${formatPercent(ci.lower)}, ${formatPercent(ci.upper)}]`;
}

function drawGrayscaleFrameToCanvas(canvas, frame) {
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rgba = new Uint8ClampedArray(frame.width * frame.height * 4);
  const src = frame.data;
  for (let i = 0, dst = 0; i < src.length; i++, dst += 4) {
    const lum = src[i] ?? 0;
    rgba[dst] = lum;
    rgba[dst + 1] = lum;
    rgba[dst + 2] = lum;
    rgba[dst + 3] = 255;
  }
  ctx.putImageData(new ImageData(rgba, frame.width, frame.height), 0, 0);
}

function renderBoundsOverlay(bounds, width, height) {
  simBoundsOverlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
  if (!Array.isArray(bounds) || bounds.length === 0) {
    simBoundsPoly.setAttribute("points", "");
    return;
  }
  const pointsStr = bounds.map((pt) => `${pt.x},${pt.y}`).join(" ");
  simBoundsPoly.setAttribute("points", pointsStr);
}

async function ensureSimScanner() {
  if (simScanner !== null) {
    return simScanner;
  }
  simScanner = new WebBarcodeScanner({
    formats: ["ean8", "ean13", "upca"],
    requiredConfirmingFrames: 2,
    consensusWindowMs: 1500,
    duplicateCooldownMs: 0,
    preferNativeDetector: false,
    mediaDevices: null,
    zxingOptions: {
      wasmUrl: WASM_URL,
      tryHarder: true,
      tryRotate: true,
      tryInvert: false,
      tryDownscale: true,
    },
    onEvent(event) {
      if (event.type === "result" && simPendingResolve !== null) {
        const resolve = simPendingResolve;
        simPendingResolve = null;
        resolve(event.result);
      }
    },
  });
  await simScanner.start();
  return simScanner;
}

function updateCustomValidationHint() {
  const format = customFormatSelect.value;
  const expectedLen = FORMAT_LENGTH[format];
  const raw = customDigitsInput.value.trim();

  if (raw.length === 0) {
    customValidationMsg.textContent = `Enter ${expectedLen - 1} payload digits (and click Calc Check Digit) or all ${expectedLen} digits.`;
    customValidationMsg.className = "field-hint";
    return false;
  }

  if (!/^\d+$/.test(raw)) {
    customValidationMsg.textContent = "Digits only (0–9).";
    customValidationMsg.className = "field-hint is-error";
    return false;
  }

  if (raw.length === expectedLen - 1) {
    const cd = computeCheckDigit(raw, format);
    customValidationMsg.textContent = `Payload valid. Mod-10 check digit is ${cd} -> ${raw}${cd}.`;
    customValidationMsg.className = "field-hint";
    return false;
  }

  if (raw.length !== expectedLen) {
    customValidationMsg.textContent = `Expected ${expectedLen} digits for ${FORMAT_LABELS[format]} (got ${raw.length}).`;
    customValidationMsg.className = "field-hint is-error";
    return false;
  }

  if (!isValidCode(raw, format)) {
    const expectedDigit = computeCheckDigit(raw.slice(0, expectedLen - 1), format);
    customValidationMsg.textContent = `Invalid check digit (expected ${expectedDigit} at position ${expectedLen}).`;
    customValidationMsg.className = "field-hint is-error";
    return false;
  }

  customValidationMsg.textContent = `Valid ${FORMAT_LABELS[format]} GS1 code.`;
  customValidationMsg.className = "field-hint is-valid";
  return true;
}

async function runSimulatorDecode() {
  if (!isValidCode(simCode, simFormat)) {
    simResultBadge.textContent = "Invalid Code";
    simResultBadge.className = "status-pill status-danger";
    simResultJson.textContent = "Provide a checksum-valid EAN-8, UPC-A, or EAN-13 digit sequence.";
    return;
  }

  const rotate90 = simCondition === "small_damaged";
  const baseFrame = renderLinearBarcodeFrame(simCode, simFormat, {
    condition: simCondition,
    rotate90,
  });

  drawGrayscaleFrameToCanvas(simCanvas, baseFrame);
  renderBoundsOverlay(null, baseFrame.width, baseFrame.height);

  const kb = (baseFrame.data.byteLength / 1024).toFixed(1);
  simFrameMeta.textContent = `${baseFrame.width}×${baseFrame.height}${rotate90 ? " (90°)" : ""} · ${kb} KB · ${simCondition}`;

  simResultBadge.textContent = "Decoding...";
  simResultBadge.className = "status-pill status-amber";
  simConsensusStatusEl.textContent = "0 / 2 frames";

  try {
    const scanner = await ensureSimScanner();
    simEngineStatus.textContent = "Local zxing_reader.wasm ready · 100% on-device";

    const t0 = performance.now();
    const ts1 = simTimestampBase;
    const ts2 = simTimestampBase + 33;
    simTimestampBase += 100;

    const resultPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (simPendingResolve !== null) {
          simPendingResolve = null;
          reject(new Error("Timed out waiting for 2-frame consensus"));
        }
      }, 4000);
      simPendingResolve = (res) => {
        clearTimeout(timer);
        resolve(res);
      };
    });

    scanner.submitFrame({
      frame: { ...baseFrame, timestampMs: ts1 },
    });
    const peakMidQueue = scanner.getMetrics().queueDepth;
    scanner.submitFrame({
      frame: { ...baseFrame, timestampMs: ts2 },
    });
    const peakPostQueue = Math.max(peakMidQueue, scanner.getMetrics().queueDepth);

    const result = await resultPromise;
    const elapsedMs = performance.now() - t0;

    const metrics = scanner.getMetrics();
    const diagnostics = scanner.getDiagnostics();

    renderBoundsOverlay(result.bounds, baseFrame.width, baseFrame.height);
    simLatencyEl.textContent = `${elapsedMs.toFixed(1)} ms`;
    simSchedulerCountsEl.textContent = `${metrics.processedFrames} / ${metrics.droppedFrames}`;
    simQueueDepthEl.textContent = `${metrics.queueDepth} (peak ${peakPostQueue} / 1)`;
    simConsensusStatusEl.textContent = `${result.evidence.confirmingFrames} / 2 confirmed`;

    simResultBadge.textContent = `${FORMAT_LABELS[result.format]} Confirmed`;
    simResultBadge.className = "status-pill status-emerald";
    simResultJson.textContent = JSON.stringify(result, null, 2);
    simDiagJson.textContent = JSON.stringify(diagnostics, null, 2);
  } catch (err) {
    simResultBadge.textContent = "Decode Failed";
    simResultBadge.className = "status-pill status-danger";
    simEngineStatus.textContent = err instanceof Error ? err.message : String(err);
  }
}

function enqueueSimulatorDecode() {
  simRunChain = simRunChain.then(() => runSimulatorDecode());
  return simRunChain;
}

presetButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    presetButtons.forEach((b) => b.classList.remove("is-selected"));
    btn.classList.add("is-selected");

    const preset = btn.dataset.preset;
    if (preset === "custom") {
      customCodeBox.hidden = false;
      customDigitsInput.value = simCode;
      customFormatSelect.value = simFormat;
      updateCustomValidationHint();
      customDigitsInput.focus();
      return;
    }

    customCodeBox.hidden = true;
    simFormat = btn.dataset.format;
    simCode = btn.dataset.code;
    void enqueueSimulatorDecode();
  });
});

conditionButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    conditionButtons.forEach((b) => {
      b.classList.remove("is-selected");
      b.setAttribute("aria-checked", "false");
    });
    btn.classList.add("is-selected");
    btn.setAttribute("aria-checked", "true");
    simCondition = btn.dataset.condition;
    void enqueueSimulatorDecode();
  });
});

customFormatSelect.addEventListener("change", () => {
  const fmt = customFormatSelect.value;
  customDigitsInput.maxLength = FORMAT_LENGTH[fmt];
  if (updateCustomValidationHint()) {
    simFormat = fmt;
    simCode = customDigitsInput.value.trim();
    void enqueueSimulatorDecode();
  }
});

customDigitsInput.addEventListener("input", () => {
  const fmt = customFormatSelect.value;
  if (updateCustomValidationHint()) {
    simFormat = fmt;
    simCode = customDigitsInput.value.trim();
    void enqueueSimulatorDecode();
  }
});

btnCalcCheckDigit.addEventListener("click", () => {
  const fmt = customFormatSelect.value;
  const expectedLen = FORMAT_LENGTH[fmt];
  const digits = customDigitsInput.value.trim().replace(/\D/g, "");
  if (digits.length < expectedLen - 1) {
    updateCustomValidationHint();
    return;
  }
  const payload = digits.slice(0, expectedLen - 1);
  const check = computeCheckDigit(payload, fmt);
  const full = `${payload}${check}`;
  customDigitsInput.value = full;
  if (updateCustomValidationHint()) {
    simFormat = fmt;
    simCode = full;
    void enqueueSimulatorDecode();
  }
});

btnRunSim.addEventListener("click", () => {
  if (!customCodeBox.hidden) {
    const fmt = customFormatSelect.value;
    if (!updateCustomValidationHint()) {
      return;
    }
    simFormat = fmt;
    simCode = customDigitsInput.value.trim();
  }
  void enqueueSimulatorDecode();
});

// --- Tab 2: Live Device Camera & Universal Manual Entry ---
const cameraMountRoot = document.getElementById("camera-mount-root");
const btnCamStart = document.getElementById("btn-cam-start");
const btnCamStop = document.getElementById("btn-cam-stop");
const camStatePill = document.getElementById("cam-state-pill");
const camResultBadge = document.getElementById("cam-result-badge");
const camResultJson = document.getElementById("cam-result-json");
const camDiagJson = document.getElementById("cam-diag-json");

let camScanner = null;
let camMountView = null;

function setCamBadgeState(state) {
  camStatePill.textContent = state;
  if (state === "running") {
    camStatePill.className = "status-pill status-emerald";
  } else if (state === "starting") {
    camStatePill.className = "status-pill status-cyan";
  } else if (state === "error") {
    camStatePill.className = "status-pill status-danger";
  } else {
    camStatePill.className = "status-pill status-amber";
  }
  btnCamStart.disabled = state === "running" || state === "starting";
  btnCamStop.disabled = state !== "running" && state !== "starting";
}

function initCameraScanner() {
  if (camScanner !== null) {
    return camScanner;
  }
  camScanner = new WebBarcodeScanner({
    formats: ["ean8", "ean13", "upca"],
    requiredConfirmingFrames: 2,
    consensusWindowMs: 1500,
    duplicateCooldownMs: 2000,
    preferNativeDetector: true,
    zxingOptions: {
      wasmUrl: WASM_URL,
      tryHarder: true,
      tryRotate: true,
      tryInvert: false,
      tryDownscale: true,
    },
    onEvent(event) {
      if (event.type === "result") {
        camResultBadge.textContent = `${FORMAT_LABELS[event.result.format]} (${event.result.evidence.confirmingFrames}x)`;
        camResultBadge.className = "status-pill status-emerald";
        camResultJson.textContent = JSON.stringify(event.result, null, 2);
        camDiagJson.textContent = JSON.stringify(camScanner.getDiagnostics(), null, 2);
      } else if (event.type === "error") {
        camResultBadge.textContent = event.code;
        camResultBadge.className = "status-pill status-amber";
        camDiagJson.textContent = JSON.stringify(camScanner.getDiagnostics(), null, 2);
      }
    },
  });

  camScanner.getUIController().subscribe((uiState) => {
    setCamBadgeState(uiState.state);
    camDiagJson.textContent = JSON.stringify(camScanner.getDiagnostics(), null, 2);
  });

  camMountView = camScanner.mount(cameraMountRoot);
  camDiagJson.textContent = JSON.stringify(camScanner.getDiagnostics(), null, 2);
  return camScanner;
}

btnCamStart.addEventListener("click", async () => {
  const scanner = initCameraScanner();
  await scanner.start();
});

btnCamStop.addEventListener("click", async () => {
  if (camScanner !== null) {
    await camScanner.stop();
  }
});

// --- Accessible Tablist Switching (Playground + Code Tabs) ---
function setupTabGroup(groupName) {
  const tablist = document.querySelector(`[data-tab-group="${groupName}"]`);
  if (!tablist) return;
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));

  const activateTab = (targetTab, focusTarget = false) => {
    tabs.forEach((tab) => {
      const selected = tab === targetTab;
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.classList.toggle("is-active", selected);
      if (selected) {
        tab.removeAttribute("tabindex");
      } else {
        tab.setAttribute("tabindex", "-1");
      }
      const panelId = tab.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;
      if (panel) {
        panel.hidden = !selected;
      }
    });

    if (focusTarget) {
      targetTab.focus();
    }

    if (groupName === "playground" && targetTab.id === "tab-cam") {
      initCameraScanner();
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab, false));
    tab.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        activateTab(tabs[(index + 1) % tabs.length], true);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        activateTab(tabs[(index - 1 + tabs.length) % tabs.length], true);
      }
    });
  });
}

setupTabGroup("playground");
setupTabGroup("integration");

// --- Copy Integration Code Snippet ---
const btnCopyCode = document.getElementById("btn-copy-code");
btnCopyCode.addEventListener("click", async () => {
  const visiblePanel = document.querySelector(".code-panel:not([hidden]) code");
  if (!visiblePanel) return;
  try {
    await navigator.clipboard.writeText(visiblePanel.textContent ?? "");
    const original = btnCopyCode.textContent;
    btnCopyCode.textContent = "Copied!";
    setTimeout(() => {
      btnCopyCode.textContent = original;
    }, 1600);
  } catch {
    btnCopyCode.textContent = "Copy unavailable";
  }
});

// --- Phase 0 Benchmark Data Hydration ---
const benchTabVal = document.getElementById("bench-tab-val");
const benchTabDev = document.getElementById("bench-tab-dev");
const benchOverallBody = document.getElementById("bench-overall-body");
const benchSubgroupBody = document.getElementById("bench-subgroup-body");
const benchMetaLine = document.getElementById("bench-meta-line");

let benchmarkData = null;
let activeBenchSplit = "validation";

function createCell(text, className) {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

function renderBenchmarkTables() {
  if (!benchmarkData) return;
  const splitData = benchmarkData[activeBenchSplit];
  if (!splitData) return;

  benchOverallBody.replaceChildren();
  const configs = splitData.configurations ?? [];
  for (const cfg of configs) {
    const tr = document.createElement("tr");
    if (cfg.configurationId === benchmarkData.frozenConfigurationId) {
      tr.className = "row-highlight";
    }
    const c3 = cfg.overall.correctWithin3s;
    const decodeCell = `${c3.count} / ${cfg.overall.totalTrials} (${formatPercent(c3.rate)})`;
    const ciCell = formatCI(c3.ci95);
    const p50Cell = `${cfg.overall.timeToFirstCorrectMs.p50} ms`;
    const initCell = `${cfg.overall.coldInitP50Ms.toFixed(2)} / ${cfg.overall.coldInitP95Ms.toFixed(2)} ms`;
    const wrongCell = `${cfg.overall.wrongValidCount} (<= ${cfg.overall.wrongValidRuleOfThree95UpperBound.toFixed(4)})`;

    tr.append(
      createCell(cfg.configurationId, "mono"),
      createCell(cfg.engineVersion, "mono"),
      createCell(decodeCell, "mono"),
      createCell(ciCell, "mono"),
      createCell(p50Cell, "mono"),
      createCell(initCell, "mono"),
      createCell(wrongCell, "mono"),
    );
    benchOverallBody.appendChild(tr);
  }

  const baseline = configs.find((c) => c.configurationId === "safeeat-current-reader");
  const tuned = configs.find((c) => c.configurationId === "zxing-tuned-th1-tr1-ti0");
  const nativeCfg = configs.find((c) => c.configurationId === "native-barcode-detector");
  if (!baseline || !tuned) return;

  benchSubgroupBody.replaceChildren();

  const resolveMetric = (source, key) => {
    if (!source) return undefined;
    if (Array.isArray(source)) {
      return source.find((item) => item.symbology === key);
    }
    return source[key];
  };

  const addSubgroupRows = (groupKey, labelMap, keys) => {
    for (const key of keys) {
      const baseMetric = resolveMetric(baseline[groupKey], key);
      const tunedMetric = resolveMetric(tuned[groupKey], key);
      if (!baseMetric || !tunedMetric) continue;
      const nativeMetric = resolveMetric(nativeCfg?.[groupKey], key);

      const baseRate = baseMetric.correctWithin3s;
      const tunedRate = tunedMetric.correctWithin3s;
      const deltaPp = (tunedRate.rate - baseRate.rate) * 100;
      const deltaText = `${deltaPp >= 0 ? "+" : ""}${deltaPp.toFixed(1)} pp`;

      const tr = document.createElement("tr");
      tr.append(
        createCell(labelMap[key] ?? key),
        createCell(String(tunedMetric.totalTrials), "mono"),
        createCell(
          `${baseRate.count}/${baseMetric.totalTrials} (${formatPercent(baseRate.rate)}) ${formatCI(baseRate.ci95)}`,
          "mono",
        ),
        createCell(
          `${tunedRate.count}/${tunedMetric.totalTrials} (${formatPercent(tunedRate.rate)}) ${formatCI(tunedRate.ci95)}`,
          "mono",
        ),
        createCell(deltaText, deltaPp > 0 ? "mono delta-pos" : "mono"),
        createCell(
          nativeMetric
            ? `${nativeMetric.correctWithin3s.count}/${nativeMetric.totalTrials} (${formatPercent(nativeMetric.correctWithin3s.rate)})`
            : "N/A (absent in iOS Safari)",
          "mono",
        ),
      );
      benchSubgroupBody.appendChild(tr);
    }
  };

  addSubgroupRows("byCondition", CONDITION_LABELS, [
    "normal",
    "low_light",
    "glare_curved",
    "small_damaged",
  ]);
  addSubgroupRows("bySymbology", SYMBOLOGY_LABELS, ["ean13", "upca", "ean8"]);
  addSubgroupRows("byDeviceClass", DEVICE_LABELS, [
    "ios_safari_low",
    "ios_safari_mid",
    "android_chrome_low",
    "android_chrome_mid",
  ]);
}

async function loadBenchmarkResults() {
  try {
    const response = await fetch("./phase0-results.json");
    if (!response.ok) return;
    benchmarkData = await response.json();
    benchMetaLine.textContent =
      `Protocol ${benchmarkData.protocolVersion} · Corpus ${benchmarkData.corpusVersion} · Frozen Config ${benchmarkData.frozenConfigurationId}`;
    renderBenchmarkTables();
  } catch {
    // Fallback static rows remain visible if fetch is unavailable.
  }
}

benchTabVal.addEventListener("click", () => {
  activeBenchSplit = "validation";
  benchTabVal.classList.add("is-active");
  benchTabVal.setAttribute("aria-selected", "true");
  benchTabDev.classList.remove("is-active");
  benchTabDev.setAttribute("aria-selected", "false");
  renderBenchmarkTables();
});

benchTabDev.addEventListener("click", () => {
  activeBenchSplit = "development";
  benchTabDev.classList.add("is-active");
  benchTabDev.setAttribute("aria-selected", "true");
  benchTabVal.classList.remove("is-active");
  benchTabVal.setAttribute("aria-selected", "false");
  renderBenchmarkTables();
});

// Cleanup on page unload
window.addEventListener("pagehide", () => {
  if (camMountView !== null) {
    camMountView.destroy();
    camMountView = null;
  }
  if (camScanner !== null) {
    void camScanner.dispose();
  }
  if (simScanner !== null) {
    void simScanner.dispose();
  }
});

// Initial hydration & live WASM simulator run
void loadBenchmarkResults();
void enqueueSimulatorDecode();
