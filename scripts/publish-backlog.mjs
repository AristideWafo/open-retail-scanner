// Idempotent backlog UPSERT.
// Each issue has a stable `key`; its body ends with `<!-- orc-key: KEY -->`.
// Existing issues are found by that marker, falling back to `legacyTitle`.
// Usage: bun scripts/publish-backlog.mjs [--dry-run] OWNER/REPO
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const repo = args.find((a) => !a.startsWith("--"));
if (!repo) throw new Error("Usage: scripts/publish-backlog.mjs [--dry-run] OWNER/REPO");

const P0 = "Phase 0 — Evidence-lite";
const P1 = "Phase 1 — Web vertical slice";

const labels = [
  ["phase:0", "5319e7", "Evidence and benchmark phase"],
  ["phase:1", "1d76db", "Web vertical slice"],
  ["type:epic", "6f42c1", "Tracking issue"],
  ["type:benchmark", "d4c5f9", "Benchmark or corpus work"],
  ["type:architecture", "0e8a16", "Architecture and contracts"],
  ["type:feature", "a2eeef", "Product capability"],
  ["type:bug", "d73a4a", "Defect"],
  ["type:legal", "b60205", "Licensing or clean-room review"],
  ["type:security", "b60205", "Security and privacy"],
  ["type:infra", "c5def5", "Toolchain, CI, repository tooling"],
  ["status:blocked", "8b949e", "Blocked by a recorded dependency"],
  ["status:ready", "2da44e", "Ready for implementation"],
  ["status:triage", "fbca04", "Needs maintainer triage"],
  ["status:done", "0e8a16", "Completed; kept open only until verified"],
  ["priority:P0", "b60205", "Must be completed first"],
  ["priority:P1", "d93f0b", "High priority"],
  ["good first issue", "7057ff", "Suitable for a first contribution"]
];
const managedPrefixes = ["phase:", "type:", "status:", "priority:"];

const milestones = [
  {
    title: P0,
    legacyTitle: "Phase 0 — Evidence",
    description: "Evidence-lite, at most 2 weeks, one person: SafeEat funnel measurement, replay harness on about 40 owned products, engine comparison, and a human GO / ITERATE / NO-GO decision."
  },
  {
    title: P1,
    description: "Thin Web slice on the zxing-wasm npm package with a native BarcodeDetector fast path, after Phase 0 records GO."
  }
];

const PRIVACY = "Privacy: no frame, crop, barcode value, product identity, profile, or health data may enter git, logs, diagnostics, or published results; only aggregate counts and metrics.";
const CLEAN = "Clean-room: use only public documentation and permissively licensed code; no decompiled, extracted, or proprietary code or assets (see `docs/clean-room-policy.md`).";

function body({ problem, deliverables, acceptance, deps = [], notes = [], privacy = false, clean = false }) {
  const list = (xs) => xs.map((x) => `- ${x}`).join("\n");
  const parts = [
    `## Problem / Outcome\n${problem}`,
    `## Deliverables\n${list(deliverables)}`,
    `## Acceptance\n${list(acceptance)}`,
    `## Dependencies\n${deps.length ? list(deps.map((d) => `\`${d}\``)) : "None."}`
  ];
  const constraints = [...notes, ...(privacy ? [PRIVACY] : []), ...(clean ? [CLEAN] : [])];
  if (constraints.length) parts.push(`## Constraints\n${list(constraints)}`);
  parts.push("Read `AGENTS.md`, `ROADMAP.md`, and the docs linked above before starting.");
  return parts.join("\n\n");
}

const issues = [
  {
    key: "epic-phase0",
    legacyTitle: "[Epic] Phase 0 — establish evidence before SDK implementation",
    title: "[Epic] Phase 0 — Evidence-lite (at most 2 weeks, one person)",
    milestone: P0,
    labels: ["phase:0", "type:epic", "priority:P0"],
    body: body({
      problem: "Decide with bounded evidence whether a zxing-wasm based pipeline beats the current SafeEat reader enough to justify Phase 1. Budget: at most 2 weeks, one person. See `ROADMAP.md` and `docs/benchmark/protocol.md`.",
      deliverables: [
        "funnel measurement (`funnel`), the first step and an early NO-GO check",
        "frozen protocol v1-lite (`protocol`)",
        "rights-clean device clips with ground truth (`clips`)",
        "replay harness (`harness`) and engine runs (`engines`)",
        "bounded report and human decision (`report`)",
        "toolchain bootstrap (`toolchain`)"
      ],
      acceptance: [
        "funnel step finished before engine work starts; NO-GO if capture/decode share is below 20%",
        "all mandatory subgroups reported with denominators and Wilson intervals",
        "no public parity or superiority claim; Scanbot is optional and never a gate",
        "Phase 1 stays `status:blocked` until `report` records GO"
      ],
      deps: ["funnel", "protocol", "clips", "harness", "engines", "report", "toolchain"],
      privacy: true,
      clean: true
    })
  },
  {
    key: "funnel",
    legacyTitle: "Define and instrument the SafeEat first-pilot integration",
    title: "Measure the SafeEat funnel: share of failures/abandons due to capture/decode",
    milestone: P0,
    labels: ["phase:0", "type:benchmark", "priority:P0", "status:ready"],
    body: body({
      problem: "Before any scanner work, determine what share of SafeEat failures and abandons is caused by barcode capture/decode versus network, product lookup, absent product, or incomplete data. This is the FIRST Phase 0 task. NO-GO if the capture/decode share is below 20% (or projected completed-task gain is below 5 percentage points).",
      deliverables: [
        "Allow-list event categories agreed with SafeEat before collection: camera permission, camera lifecycle, no decode, wrong decode, network, product not found, data insufficient, user cancellation, completed task (counts only).",
        "SafeEat-side instrumentation is implemented in the SafeEat repository, not here; link its PR in this issue.",
        "This repository holds only the analysis template `docs/pilots/funnel-template.md` (created with this backlog); fill it in with aggregate counts, denominators, and Wilson 95% intervals per platform segment.",
        "A short recorded decision: continue or NO-GO."
      ],
      acceptance: [
        "capture/decode share reported with denominator and Wilson interval, overall and per platform (iOS Safari, Android Chrome)",
        "projected completion-gain upper bound computed as in the template",
        "decision recorded in this issue; below 20% closes Phase 0 as NO-GO"
      ],
      notes: ["See `docs/pilots/safeeat.md`. SafeEat owns lookup, profile, and health logic; none of it enters this repository."],
      privacy: true
    })
  },
  {
    key: "protocol",
    legacyTitle: "Lock protocol v1, device matrix, metric definitions, and spike budget",
    title: "Freeze protocol v1-lite: matrix, metrics, gates",
    milestone: P0,
    labels: ["phase:0", "type:benchmark", "priority:P0", "status:ready"],
    body: body({
      problem: "The mandate to be better than the current reader is only falsifiable once the matrix, metrics, and gates are frozen before any engine result is opened.",
      deliverables: [
        "finalize `docs/benchmark/protocol.md` for v1-lite: at least 40 distinct products (at least 10 per condition), at least 4 device/OS/browser combinations including iOS Safari and Android Chrome (low and mid tier), four conditions",
        "metric definitions with denominators; Wilson confidence intervals per symbology and condition",
        "gates expressed relative to the current reader: correct within 3 s at least 10 points higher overall, no mandatory subgroup worse than 3 points, P95 not worse, zero wrong checksum-valid in replay",
        "named owner, spike budget (at most 2 weeks, one person; NO-GO if no GO/ITERATE path within 3 calendar weeks), and a hash or tag of the frozen document"
      ],
      acceptance: [
        "every metric has a calculation and a denominator",
        "GO / ITERATE / NO-GO are mutually exclusive and actionable",
        "Scanbot appears only as an optional informational row",
        "a human owner approves the freeze before `engines` results are opened"
      ],
      deps: ["funnel"],
      privacy: true
    })
  },
  {
    key: "clips",
    legacyTitle: "Create lawful corpus manifest, annotation workflow, and locked split",
    title: "Record device clips and ground truth (rights-clean, kept outside git)",
    milestone: P0,
    labels: ["phase:0", "type:benchmark", "type:legal", "priority:P0", "status:blocked"],
    body: body({
      problem: "Replay needs raw camera clips of about 40 products you own, recorded on 4-6 real devices under 4 conditions (normal, low light, glare/curved, small/damaged), with trustworthy ground truth.",
      deliverables: [
        "clips recorded on at least 4 device/browser combinations (iOS Safari, Android Chrome, low and mid tier), stored outside git with content hashes",
        "a manifest (hashes, device, condition, symbology, split; no values or images) that can be committed",
        "ground truth: printed digits read by one person plus checksum; a second person only for disagreements",
        "development/locked split by physical product; ownership or consent noted per asset",
        "tooling or a check that prevents clips and barcode values from entering git"
      ],
      acceptance: [
        "at least 40 products, at least 10 per condition; EAN-8/EAN-13/UPC-A reported separately where available",
        "every asset has a rights note; no personal data (faces, hands identifying people, receipts) retained",
        "locked split is not used for tuning"
      ],
      deps: ["protocol", "toolchain"],
      privacy: true
    })
  },
  {
    key: "harness",
    legacyTitle: "Implement benchmark schema, runner interfaces, and aggregate report",
    title: "Replay harness: schema, runner, metrics, wrong-valid replay + synthetic stress (≥100k frames, rule-of-three bound)",
    milestone: P0,
    labels: ["phase:0", "type:benchmark", "priority:P0", "status:ready"],
    body: body({
      problem: "Engines must be compared by replaying identical recorded clips through a deterministic harness, including wrong checksum-valid measurement.",
      deliverables: [
        "run/result schema (based on `docs/benchmark/result-schema.md`) and an engine adapter interface",
        "deterministic recorded-clip runner with randomized engine order and per-frame decode, then the consensus policy",
        "metrics: correct within 1/2/3/5 s, time-to-first-correct P50/P90/P95, wrong checksum-valid, no-result rate, cold init; Wilson intervals",
        "wrong-valid measurement: replay every clip, plus a synthetic stress set of at least 100,000 frames (noise, blur, occlusion, partial-bar perturbations of real frames) with the consensus policy applied",
        "one-sided 95% upper bound by rule of three (0 events in N gives about 3/N); never present it as zero real-world risk",
        "CI tests with a synthetic fixture proving frames and values cannot enter results or diagnostics"
      ],
      acceptance: [
        "a synthetic fixture run produces a reproducible aggregate report in CI",
        "development and locked partitions are distinguishable; locked results are not produced until analysis code is frozen",
        "zero events always reported with denominator and bound"
      ],
      deps: ["toolchain", "protocol"],
      privacy: true
    })
  },
  {
    key: "engines",
    legacyTitle: "Benchmark ZXing-C++/WASM, Quagga2, BarcodeDetector, and current reader",
    title: "Run engines on identical clips: current reader, zxing-wasm, native BarcodeDetector, optional Quagga2",
    milestone: P0,
    labels: ["phase:0", "type:benchmark", "priority:P0", "status:blocked"],
    body: body({
      problem: "Produce the comparison against the current SafeEat reader on identical clips.",
      deliverables: [
        "adapters and runs for: current SafeEat reader (primary comparison), `zxing-wasm` (reader build, EAN/UPC only, pinned), native `BarcodeDetector` where available (not default in iOS Safari), optional Quagga2",
        "exact package versions, build flags, browser/OS/device, and configuration recorded; no privileged ROI/resolution for one engine unless it is a declared production configuration",
        "`tryHarder`, `tryRotate`, `tryInvert` measured, not assumed",
        "aggregate results by symbology, condition, device tier, OS, browser; development first, locked split only after analysis freeze"
      ],
      acceptance: [
        "all mandatory subgroups reported with denominators and Wilson intervals",
        "native BarcodeDetector reported only where available and never treated as universal",
        "no Scanbot binary or automation used here"
      ],
      deps: ["harness", "clips", "protocol"],
      privacy: true,
      clean: true
    })
  },
  {
    key: "report",
    legacyTitle: "Execute physical-device benchmark and publish bounded results",
    title: "Publish bounded Phase 0 report and record GO/ITERATE/NO-GO",
    milestone: P0,
    labels: ["phase:0", "type:architecture", "priority:P0", "status:blocked"],
    body: body({
      problem: "Summarise the evidence and record the human decision against the preregistered gates in `docs/benchmark/protocol.md`.",
      deliverables: [
        "baseline report: denominators, Wilson intervals, every mandatory subgroup, invalidated runs and incidents",
        "wrong-valid replay result with the stress-set rule-of-three bound",
        "decision record (`docs/decision-record.md`): GO / ITERATE / NO-GO, evidence, failed subgroups, objections, owner, maintenance budget, review date",
        "if NO-GO, archive runtime work and keep only the useful harness"
      ],
      acceptance: [
        "conclusions explicitly bounded to the named versions, device matrix, and date",
        "a HUMAN decision-maker records the decision; agent agreement is not approval",
        "GO satisfies every gate in the protocol; Phase 1 issues stay blocked until then"
      ],
      deps: ["funnel", "engines"],
      notes: ["Do not publish raw assets, barcode values, or product identities. Named commercial comparisons need legal approval (`legal-scanbot`), which is not required for GO."],
      privacy: true
    })
  },
  {
    key: "legal-scanbot",
    legacyTitle: "Obtain legal decision for Scanbot black-box benchmark and publication",
    title: "Optional: legal review of Scanbot black-box comparison",
    milestone: P0,
    labels: ["phase:0", "type:legal", "priority:P1", "status:triage"],
    body: body({
      problem: "Scanbot was perceived as more performant in historical use. A black-box comparison is optional and informational. It is explicitly NOT blocking: the GO gate is relative to the current SafeEat reader.",
      deliverables: [
        "qualified reviewer examines the current Scanbot agreement and the planned black-box protocol",
        "dated decision: whether evaluation is permitted, which aggregates may be retained, whether a named comparison may be published and with what wording"
      ],
      acceptance: [
        "until approved, no Scanbot binary, automation, or named claim is used",
        "approval or refusal does not change Phase 0 or Phase 1 gating"
      ],
      notes: ["Scanbot legal review blocks only a named commercial comparison."],
      clean: true
    })
  },
  {
    key: "toolchain",
    title: "Bootstrap toolchain: TypeScript typecheck, node:test, CI green",
    milestone: P0,
    labels: ["phase:0", "type:infra", "priority:P0", "status:ready"],
    body: body({
      problem: "The repository needs a working TypeScript typecheck, `node:test` test runner, and green CI before harness code lands. The controller is doing this locally in its own commit; this issue tracks it and is intentionally not closed here.",
      deliverables: [
        "TypeScript typecheck script",
        "tests run with `node:test`",
        "CI workflow green on the default branch"
      ],
      acceptance: ["`npm run check` passes locally and in CI", "close this issue when the controller's commit is merged and CI is green"],
      notes: ["Being done in the controller's commit; do not duplicate."]
    })
  },
  {
    key: "epic-phase1",
    legacyTitle: "[Epic] Phase 1 — Web/WASM vertical slice",
    title: "[Epic] Phase 1 — Web vertical slice",
    milestone: P1,
    labels: ["phase:1", "type:epic", "status:blocked"],
    body: body({
      problem: "Thin Web scanner for EAN-8/EAN-13/UPC-A, local-only, built on the `zxing-wasm` npm package (no own WASM build), after Phase 0 records GO.",
      deliverables: [
        "zxing adapter, native fast path, scheduler, camera adapter, checksum/consensus, minimal accessible UI, privacy/teardown/audit tests"
      ],
      acceptance: ["all child issues done", "no QR, OCR, cloud, native mobile package, analytics, or universal performance claim"],
      deps: ["report", "zxing-adapter", "native-detector", "scheduler", "camera", "consensus", "ui", "privacy-tests"],
      notes: ["Blocked until `report` records GO."],
      privacy: true
    })
  },
  {
    key: "zxing-adapter",
    legacyTitle: "Integrate pinned ZXing-C++ single-thread WASM adapter",
    title: "zxing-wasm adapter (pinned npm package, EAN/UPC hints measured) behind the engine interface",
    milestone: P1,
    labels: ["phase:1", "type:feature", "type:architecture", "priority:P0", "status:blocked"],
    body: body({
      problem: "Provide the universal decoder through the pinned `zxing-wasm` npm package (reader build, single-thread). Do not compile our own WASM (ADR 0001).",
      deliverables: [
        "adapter implementing the engine-independent interface, with EAN-8/EAN-13/UPC-A hints",
        "`tryHarder`/`tryRotate`/`tryInvert` set from Phase 0 measurements",
        "pinned version, exposed engine version, NOTICE/licence inventory entry",
        "WASM loaded locally with no remote runtime dependency"
      ],
      acceptance: ["works without COOP/COEP (single-thread)", "teardown releases memory", "`npm run check` passes", "deterministic fixtures"],
      deps: ["report", "toolchain"],
      clean: true
    })
  },
  {
    key: "native-detector",
    title: "Native BarcodeDetector fast path with feature detection (ADR 0003)",
    milestone: P1,
    labels: ["phase:1", "type:feature", "priority:P0", "status:blocked"],
    body: body({
      problem: "Use native `BarcodeDetector` where available for speed and battery, behind the same interface and `ScanResult` contract (`docs/adr/0003-native-barcodedetector-fast-path.md`).",
      deliverables: [
        "feature detection: enabled only if `getSupportedFormats()` includes `ean_8`, `ean_13`, `upc_a`",
        "adapter returning the same `ScanResult`; checksum and consensus applied identically",
        "fallback to the zxing adapter; enabled by default only if Phase 0 data shows it is no worse than WASM"
      ],
      acceptance: ["never assumed available (not default in iOS Safari)", "tests for absent API, missing formats, and runtime failure fallback"],
      deps: ["zxing-adapter", "report"]
    })
  },
  {
    key: "scheduler",
    legacyTitle: "Implement latest-frame worker scheduler without JPEG/base64",
    title: "Latest-frame worker scheduler without JPEG/base64",
    milestone: P1,
    labels: ["phase:1", "type:feature", "priority:P0", "status:blocked"],
    body: body({
      problem: "Keep decoding off the main thread and always work on the newest frame (ADR 0002).",
      deliverables: [
        "worker lifecycle with at most one pending frame and stale-frame replacement",
        "luminance buffer / VideoFrame / ImageBitmap transfer with capability fallback; no JPEG/base64",
        "monotonic timings, abort/stop"
      ],
      acceptance: ["queue depth never above one", "no main-thread decode", "repeated start/stop leaks no track, worker, listener, or buffer", "long-task and latency tests"],
      deps: ["zxing-adapter"]
    })
  },
  {
    key: "camera",
    legacyTitle: "Implement resilient camera adapter and capability-driven controls",
    title: "Camera adapter + capture tuning (resolution, focus, zoom, torch, lifecycle)",
    milestone: P1,
    labels: ["phase:1", "type:feature", "priority:P0", "status:blocked"],
    body: body({
      problem: "Expected gains come from capture: resolution of at least 1080p where available, continuous focus, zoom, torch, native-resolution decoding.",
      deliverables: [
        "rear-camera selection, resolution negotiation, optional torch/zoom/focus only when reported",
        "visibility, interruption, track-ended handling; typed errors; deterministic cleanup",
        "each tuning step justified by Phase 0 or later measured gain"
      ],
      acceptance: ["tests: permission denied, no camera, interruption, background/foreground, camera replacement, unsupported torch, repeated lifecycle", "camera failure distinct from decode failure", "no device label persisted"],
      deps: ["report"],
      privacy: true
    })
  },
  {
    key: "consensus",
    legacyTitle: "Implement checksum, UPC/EAN normalization, and temporal consensus",
    title: "Checksum, UPC/EAN canonicalisation, 2-frame time-windowed consensus",
    milestone: P1,
    labels: ["phase:1", "type:feature", "priority:P0", "status:blocked"],
    body: body({
      problem: "Never emit a wrong checksum-valid code: validate, canonicalise, and require agreement across frames.",
      deliverables: [
        "standard EAN-8/EAN-13/UPC-A checksum validation",
        "explicit UPC-A/EAN-13 leading-zero canonicalisation; raw value and observed format preserved",
        "consensus: 2 agreeing frames within a time window (window calibrated on Phase 0 data)",
        "engine/evidence version in results; no uncalibrated percentage confidence"
      ],
      acceptance: ["no partial or checksum-invalid result", "conflicting frames never emit", "raw and canonical values tested separately", "replay and stress tests from the harness show zero wrong-valid"],
      deps: ["harness", "report"]
    })
  },
  {
    key: "ui",
    legacyTitle: "Build accessible scanner UI, guidance, and universal manual fallback",
    title: "Accessible minimal UI, guidance, manual fallback",
    milestone: P1,
    labels: ["phase:1", "type:feature", "priority:P1", "status:blocked"],
    body: body({
      problem: "A minimal accessible scanner UI with a manual entry path reachable from every recoverable failure.",
      deliverables: [
        "camera preview, clear states and errors, basic guidance, torch/zoom only when supported",
        "keyboard and screen-reader behaviour; manual entry",
        "quality guidance (blur/dark/glare) is Phase 2, only if data justifies it"
      ],
      acceptance: ["manual entry reachable in 100% of recoverable failure paths", "guidance never claims product identity or food safety", "focus-management and interruption tests"],
      deps: ["camera", "consensus"]
    })
  },
  {
    key: "privacy-tests",
    legacyTitle: "Add privacy, teardown, fuzzing, and supply-chain release gates",
    title: "Privacy, teardown and dependency-audit tests",
    milestone: P1,
    labels: ["phase:1", "type:security", "priority:P0", "status:blocked"],
    body: body({
      problem: "Prove locally that nothing sensitive leaves the scanner and that resources are released. Mandatory fuzzing, SBOM, and signed releases are deferred to Phase 3.",
      deliverables: [
        "allow-list diagnostic schema and tests rejecting frames, values, identities",
        "teardown tests: tracks, workers, buffers released",
        "dependency audit (licences, advisories) for the pinned `zxing-wasm`",
        "input size limits for decoder inputs"
      ],
      acceptance: ["no prohibited data crosses a logging, error, or persistence boundary", "oversized inputs fail within budget", "audit result recorded"],
      deps: ["zxing-adapter", "camera"],
      privacy: true
    })
  }
];

const retired = [
  {
    legacyTitle: "Record Phase 0 GO / ITERATE / NO-GO decision",
    comment: "Superseded by the realigned backlog: the decision is now recorded in the issue 'Publish bounded Phase 0 report and record GO/ITERATE/NO-GO' (key `report`). Closing as not planned."
  }
];

const marker = (key) => `<!-- orc-key: ${key} -->`;
const markerRe = /<!--\s*orc-key:\s*([\w-]+)\s*-->/;
for (const i of issues) i.fullBody = `${i.body}\n\n${marker(i.key)}`;

function gh(ghArgs, { capture = false } = {}) {
  const output = execFileSync("gh", ghArgs, { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  return typeof output === "string" ? output.trim() : "";
}
const read = (ghArgs) => JSON.parse(gh(ghArgs, { capture: true }));
function write(description, ghArgs) {
  if (dryRun) { console.log(`[dry-run] ${description}`); return; }
  console.log(description);
  gh(ghArgs);
}

// Labels
for (const [name, color, description] of labels) {
  write(`label upsert: ${name}`, ["label", "create", name, "--repo", repo, "--color", color, "--description", description, "--force"]);
}

// Milestones
const existingMilestones = read(["api", `repos/${repo}/milestones?state=all&per_page=100`]);
for (const m of milestones) {
  const found = existingMilestones.find((x) => x.title === m.title) ?? (m.legacyTitle && existingMilestones.find((x) => x.title === m.legacyTitle));
  if (!found) {
    write(`milestone create: ${m.title}`, ["api", "--method", "POST", `repos/${repo}/milestones`, "-f", `title=${m.title}`, "-f", `description=${m.description}`]);
  } else if (found.title !== m.title || found.description !== m.description) {
    write(`milestone update #${found.number}: ${found.title} -> ${m.title}`, ["api", "--method", "PATCH", `repos/${repo}/milestones/${found.number}`, "-f", `title=${m.title}`, "-f", `description=${m.description}`]);
  }
}

// Issues
const existing = read(["issue", "list", "--repo", repo, "--state", "all", "--limit", "500", "--json", "number,title,body,state,labels,milestone"]);
const byKey = new Map();
for (const e of existing) {
  const k = markerRe.exec(e.body ?? "")?.[1];
  if (k && !byKey.has(k)) byKey.set(k, e);
}
const used = new Set();
const findFor = (key, legacyTitle) => {
  const e = byKey.get(key) ?? (legacyTitle && existing.find((x) => x.title === legacyTitle && !markerRe.test(x.body ?? "") && !used.has(x.number)));
  if (e) used.add(e.number);
  return e;
};

for (const issue of issues) {
  const e = findFor(issue.key, issue.legacyTitle);
  if (!e) {
    write(`issue create [${issue.key}]: ${issue.title}`, [
      "issue", "create", "--repo", repo, "--title", issue.title, "--body", issue.fullBody,
      "--milestone", issue.milestone, ...issue.labels.flatMap((l) => ["--label", l])
    ]);
    continue;
  }
  const have = e.labels.map((l) => l.name);
  const add = issue.labels.filter((l) => !have.includes(l));
  const remove = have.filter((l) => managedPrefixes.some((p) => l.startsWith(p)) && !issue.labels.includes(l));
  const edit = [];
  const why = [];
  if (e.title !== issue.title) { edit.push("--title", issue.title); why.push("title"); }
  if ((e.body ?? "").trim() !== issue.fullBody.trim()) { edit.push("--body", issue.fullBody); why.push("body"); }
  if (e.milestone?.title !== issue.milestone) { edit.push("--milestone", issue.milestone); why.push("milestone"); }
  for (const l of add) { edit.push("--add-label", l); why.push(`+${l}`); }
  for (const l of remove) { edit.push("--remove-label", l); why.push(`-${l}`); }
  if (!edit.length) { console.log(`unchanged #${e.number} [${issue.key}]`); continue; }
  write(`issue edit #${e.number} [${issue.key}] (${why.join(", ")})`, ["issue", "edit", String(e.number), "--repo", repo, ...edit]);
}

// Retired issues: close with a comment, never delete.
for (const r of retired) {
  const e = existing.find((x) => x.title === r.legacyTitle && !used.has(x.number));
  if (!e) continue;
  if (e.state === "CLOSED") { console.log(`already closed #${e.number}`); continue; }
  write(`issue close #${e.number}: ${e.title}`, ["issue", "close", String(e.number), "--repo", repo, "--reason", "not planned", "--comment", r.comment]);
}

console.log(dryRun ? "Dry run complete; nothing written." : `Backlog published to https://github.com/${repo}/issues`);
