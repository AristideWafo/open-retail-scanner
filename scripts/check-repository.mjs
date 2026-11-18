import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const required = [
  "LICENSE",
  "NOTICE",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "GOVERNANCE.md",
  "docs/architecture.md",
  "docs/benchmark/protocol.md",
  "docs/clean-room-policy.md",
  "docs/privacy-security.md",
  "docs/pilots/safeeat.md"
];

await Promise.all(required.map((path) => access(path, constants.R_OK)));

const readme = await readFile("README.md", "utf8");
if (!readme.includes("has not demonstrated parity")) {
  throw new Error("README must retain the no-unverified-parity disclaimer");
}

console.log(`Repository contract OK (${required.length} required files).`);
