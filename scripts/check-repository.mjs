import { execFileSync } from "node:child_process";
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
  "docs/integration.md",
  "docs/benchmark/protocol.md",
  "docs/clean-room-policy.md",
  "docs/privacy-security.md",
  "docs/pilots/safeeat.md"
];

const FORBIDDEN_MEDIA_EXT_RE =
  /\.(?:mp4|mov|webm|mkv|avi|m4v|y4m|yuv|png|jpe?g|webp|heic|heif|raw|dng)$/i;

await Promise.all(required.map((path) => access(path, constants.R_OK)));

const readme = await readFile("README.md", "utf8");
if (!readme.includes("has not demonstrated parity")) {
  throw new Error("README must retain the no-unverified-parity disclaimer");
}

const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((line) => line.length > 0);
const forbiddenTracked = trackedFiles.filter((file) => FORBIDDEN_MEDIA_EXT_RE.test(file));
if (forbiddenTracked.length > 0) {
  throw new Error(
    `Forbidden raw clip or image files tracked in git: ${forbiddenTracked.join(", ")}`,
  );
}

console.log(`Repository contract OK (${required.length} required files).`);
