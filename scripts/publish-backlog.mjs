import { execFileSync } from "node:child_process";

const repo = process.argv[2];
if (!repo) throw new Error("Usage: node scripts/publish-backlog.mjs OWNER/REPO");

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
  ["status:blocked", "8b949e", "Blocked by a recorded dependency"],
  ["status:ready", "2da44e", "Ready for implementation"],
  ["status:triage", "fbca04", "Needs maintainer triage"],
  ["priority:P0", "b60205", "Must be completed first"],
  ["priority:P1", "d93f0b", "High priority"],
  ["good first issue", "7057ff", "Suitable for a first contribution"]
];

const issues = [
  {
    title: "[Epic] Phase 0 — establish evidence before SDK implementation",
    labels: ["phase:0", "type:epic", "priority:P0"],
    body: `## Outcome\nProduce a lawful, reproducible baseline and a human GO / ITERATE / NO-GO decision.\n\n## Tracks\n- protocol and corpus governance\n- SafeEat funnel evidence\n- open-source engine baselines\n- lawful commercial black-box baseline\n- physical-device execution\n- gate decision\n\n## Exit criteria\nAll mandatory measures and subgroups in \`docs/benchmark/protocol.md\` are reported. No public parity claim is made from development data. Phase 1 remains blocked until the decision issue records GO.`
  },
  {
    title: "Lock protocol v1, device matrix, metric definitions, and spike budget",
    labels: ["phase:0", "type:benchmark", "priority:P0", "status:ready"],
    body: `## Problem\nThe mandate \"as performant as Scanbot\" is currently non-falsifiable.\n\n## Deliverables\n- finalize protocol quotas and target matrix\n- name product, benchmark, legal, and security owners\n- set the bundle budget and six-engineer-week / four-calendar-week spike cap\n- version and hash the locked protocol\n\n## Acceptance\n- every metric has a denominator and calculation\n- GO / ITERATE / NO-GO are mutually actionable\n- mandatory subgroups cannot be omitted\n- a human owner approves the locked document\n\nBlocked decisions must remain explicit rather than silently defaulted.`
  },
  {
    title: "Create lawful corpus manifest, annotation workflow, and locked split",
    labels: ["phase:0", "type:benchmark", "type:legal", "priority:P0"],
    body: `## Deliverables\n- schema for product unit, sequence, condition, symbology, rights, annotators, arbitration, and hashes\n- development/validation split by physical product\n- two-annotator ground truth and checksum validation\n- rights or consent evidence for every asset\n- tooling that prevents private assets from entering git\n\n## Acceptance\nAt least 150 products can be represented; locked assets are inaccessible to normal development; no personal data is retained; a corpus steward signs off. Do not commit real frames or barcode values to this public repository.`
  },
  {
    title: "Implement benchmark schema, runner interfaces, and aggregate report",
    labels: ["phase:0", "type:benchmark", "priority:P0", "status:ready"],
    body: `## Deliverables\n- validated append-only run schema based on \`docs/benchmark/result-schema.md\`\n- engine adapter interface and deterministic recorded-input runner\n- P50/P90/P95, rates, subgroup tables, denominators, and confidence bounds\n- immutable aggregate output with configuration provenance\n- tests ensuring images, values, and product identities cannot enter results\n\n## Acceptance\nA synthetic fixture run produces a reproducible report in CI; validation and development partitions are distinguishable; zero events never render as zero real-world risk.`
  },
  {
    title: "Instrument SafeEat funnel to isolate barcode-caused failures",
    labels: ["phase:0", "type:benchmark", "priority:P0", "status:blocked"],
    body: `## Question\nIs scanner capture/decoding a top SafeEat friction rather than network, lookup, absent product, or incomplete data?\n\n## Required categories\ncamera permission; camera lifecycle; no decode; wrong decode; network; product not found; data insufficient; user cancellation; completed task.\n\n## Privacy\nNo frame, crop, barcode value, product identity, profile, or health data. Approve an allow-list schema before collection.\n\n## Gate\nNO-GO if barcode capture/decoding represents <20% of failures/abandonments or projected completed-task improvement is <5 percentage points.\n\nThis issue belongs in the SafeEat application repository as well; link the implementation PR here.`
  },
  {
    title: "Benchmark ZXing-C++/WASM, Quagga2, BarcodeDetector, and current reader",
    labels: ["phase:0", "type:benchmark", "priority:P0"],
    body: `## Deliverables\n- exact engine/package versions and build flags\n- equivalent production-intended configuration\n- randomized execution order\n- aggregate results for development, then locked validation after analysis freeze\n\n## Acceptance\nReport correct-within-1/2/3/5s, TTFD percentiles, wrong-valid results, failures, cold start, long tasks, memory class, and bundle size by mandatory subgroup. Native BarcodeDetector is reported only where available and is not treated as a universal dependency.`
  },
  {
    title: "Obtain legal decision for Scanbot black-box benchmark and publication",
    labels: ["phase:0", "type:legal", "priority:P0", "status:blocked"],
    body: `## Required human review\nA qualified reviewer must examine the current Scanbot agreement and planned protocol.\n\n## Questions\n- Is automated or manual black-box evaluation permitted?\n- Which aggregate metrics may be retained?\n- Can named comparisons be published, and with what wording?\n- What separation is required between evaluators and implementers?\n\n## Acceptance\nA dated decision records licence version, permitted actions, prohibited actions, publication limits, and reviewer identity. Until approved, no Scanbot binary, automation, result publication, or named claim is authorized.`
  },
  {
    title: "Execute physical-device benchmark and publish bounded results",
    labels: ["phase:0", "type:benchmark", "priority:P1", "status:blocked"],
    body: `## Prerequisites\nLocked protocol, lawful corpus, runner, analysis freeze, device access, and any required commercial-baseline approval.\n\n## Acceptance\n- >=150 products and >=12 device/OS/browser combinations\n- four mandatory conditions and all three symbologies\n- randomized engine order\n- all subgroup denominators and confidence intervals\n- incident log and invalidated runs disclosed\n- conclusions explicitly bounded to versions, matrix, and date\n\nDo not publish raw assets, barcode values, product identities, or unapproved named comparisons.`
  },
  {
    title: "Record Phase 0 GO / ITERATE / NO-GO decision",
    labels: ["phase:0", "type:architecture", "priority:P0", "status:blocked"],
    body: `## Decision inputs\nLocked benchmark, SafeEat funnel attribution, maintenance estimate, privacy/security review, and legal status.\n\n## Acceptance\nA human decision-maker records evidence, failed/passed subgroups, objections, budget, owner, review date, and rollback. GO must satisfy every mandatory protocol gate. Agent agreement is not approval.\n\nIf NO-GO, archive runtime work and retain only the useful benchmark harness.`
  },
  {
    title: "[Epic] Phase 1 — Web/WASM vertical slice",
    labels: ["phase:1", "type:epic", "status:blocked"],
    body: `## Prerequisite\nPhase 0 decision records GO.\n\n## Outcome\nA minimal accessible Web scanner for EAN-8/EAN-13/UPC-A with local processing, manual fallback, deterministic lifecycle, privacy tests, and measurable budgets.\n\nNo QR, OCR, cloud, native mobile package, analytics, or universal performance claim.`
  },
  {
    title: "Integrate pinned ZXing-C++ single-thread WASM adapter",
    labels: ["phase:1", "type:feature", "type:architecture", "priority:P0", "status:blocked"],
    body: `## Deliverables\n- pinned source version and reproducible build\n- EAN-8/EAN-13/UPC-A-only hints/configuration\n- worker-compatible adapter\n- NOTICE, licence inventory, SBOM input, integrity metadata\n- deterministic fixtures and malformed-input limits\n\n## Acceptance\nNo remote runtime dependency; scalar/single-thread fallback works without COOP/COEP; engine version is exposed; teardown releases memory; \`npm run check\` passes.`
  },
  {
    title: "Implement latest-frame worker scheduler without JPEG/base64",
    labels: ["phase:1", "type:feature", "priority:P0", "status:blocked"],
    body: `## Deliverables\nWorker lifecycle; at-most-one pending frame; stale-frame replacement; monotonic timings; abort/stop; capability fallback for VideoFrame/ImageBitmap/luminance buffer.\n\n## Acceptance\nNo JPEG/base64 in the real-time path; queue depth never exceeds one; no main-thread decode; repeated start/stop leaks no track, worker, listener, or buffer; long-task and latency tests exist.`
  },
  {
    title: "Implement resilient camera adapter and capability-driven controls",
    labels: ["phase:1", "type:feature", "priority:P0", "status:blocked"],
    body: `## Deliverables\nPermission and rear-camera selection; resolution negotiation; optional torch/zoom; visibility/interruption/track-ended handling; typed errors; deterministic cleanup.\n\n## Acceptance\nTest permission denied, no camera, interruption, background/foreground, camera replacement, unsupported torch, and repeated lifecycle. Camera failures remain distinct from decode failures. No device label is persisted.`
  },
  {
    title: "Implement checksum, UPC/EAN normalization, and temporal consensus",
    labels: ["phase:1", "type:feature", "priority:P0", "status:blocked"],
    body: `## Deliverables\nStandard checksums; explicit UPC-A/EAN-13-leading-zero policy; preservation of raw value and observed format; benchmark-calibrated confirming-frame policy; deduplication.\n\n## Acceptance\nNo partial or checksum-invalid result; conflicting frames never emit a result; raw and canonical values are separately tested; no uncalibrated percentage confidence is exposed; engine/evidence versions are present.`
  },
  {
    title: "Build accessible scanner UI, guidance, and universal manual fallback",
    labels: ["phase:1", "type:feature", "priority:P1", "status:blocked"],
    body: `## Deliverables\nCamera preview/ROI; clear state and errors; guidance for darkness, blur, distance, glare, and not-found; torch/zoom only when supported; keyboard/screen-reader behavior; manual entry path.\n\n## Acceptance\nManual entry is reachable in every recoverable failure; guidance never claims product or food safety; motion and vibration respect user settings; tests cover focus management and interruption.`
  },
  {
    title: "Add privacy, teardown, fuzzing, and supply-chain release gates",
    labels: ["phase:1", "type:security", "priority:P0", "status:blocked"],
    body: `## Deliverables\nAllow-list diagnostic schema; tests rejecting frames/values/identities; decoder input limits; native/WASM fuzz targets; dependency audit; SBOM; release provenance/signing design; vulnerability workflow.\n\n## Acceptance\nNo prohibited data crosses a logging, error, analytics, or persistence boundary; malformed/oversized inputs fail within budgets; tracks/workers/buffers are released; a qualified human reviewer approves the release threat model.`
  }
];

function gh(args, { capture = false } = {}) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
  }).trim();
}

for (const [name, color, description] of labels) {
  gh(["label", "create", name, "--repo", repo, "--color", color, "--description", description, "--force"]);
}

const existing = JSON.parse(gh([
  "issue", "list", "--repo", repo, "--state", "all", "--limit", "200", "--json", "title"
], { capture: true })).map(({ title }) => title);

for (const issue of issues) {
  if (existing.includes(issue.title)) {
    console.log(`Exists: ${issue.title}`);
    continue;
  }
  gh([
    "issue", "create", "--repo", repo,
    "--title", issue.title,
    "--body", issue.body,
    ...issue.labels.flatMap((label) => ["--label", label])
  ]);
}

console.log(`Backlog published to https://github.com/${repo}/issues`);
