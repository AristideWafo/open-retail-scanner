import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_PAGES_DIR = path.join(ROOT_DIR, "dist", "pages");

const TS_COMPILER_OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ES2022,
  strict: true,
  verbatimModuleSyntax: true,
  erasableSyntaxOnly: true,
};

function rewriteRelativeTsImports(jsSource) {
  return jsSource.replace(
    /(["'])(\.\.?\/[^"'\n]+)\.ts\1/g,
    "$1$2.js$1",
  );
}

async function compileDirectory({ srcDir, outDir, excludeFiles = new Set() }) {
  await mkdir(outDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  const compiled = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name;
    if (!name.endsWith(".ts") || name.endsWith(".test.ts") || excludeFiles.has(name)) {
      continue;
    }

    const srcPath = path.join(srcDir, name);
    const outPath = path.join(outDir, name.replace(/\.ts$/, ".js"));
    const tsSource = await readFile(srcPath, "utf8");

    const result = ts.transpileModule(tsSource, {
      fileName: srcPath,
      reportDiagnostics: true,
      compilerOptions: TS_COMPILER_OPTIONS,
    });

    const errors = (result.diagnostics ?? []).filter(
      (diag) => diag.category === ts.DiagnosticCategory.Error,
    );
    if (errors.length > 0) {
      const formatted = errors
        .map((diag) => ts.flattenDiagnosticMessageText(diag.messageText, "\n"))
        .join("\n");
      throw new Error(`TypeScript transpile error in ${srcPath}:\n${formatted}`);
    }

    const jsOutput = rewriteRelativeTsImports(result.outputText);
    await writeFile(outPath, jsOutput, "utf8");
    compiled.push(path.relative(ROOT_DIR, outPath));
  }

  return compiled.sort();
}

async function copyFileEnsureDir(srcRelative, destRelative) {
  const srcPath = path.join(ROOT_DIR, srcRelative);
  const destPath = path.join(DIST_PAGES_DIR, destRelative);
  await mkdir(path.dirname(destPath), { recursive: true });
  await cp(srcPath, destPath);
  return path.relative(ROOT_DIR, destPath);
}

async function buildPages() {
  await rm(DIST_PAGES_DIR, { recursive: true, force: true });
  await mkdir(DIST_PAGES_DIR, { recursive: true });

  const coreOutputs = await compileDirectory({
    srcDir: path.join(ROOT_DIR, "packages", "core", "src"),
    outDir: path.join(DIST_PAGES_DIR, "sdk", "core"),
  });

  const webOutputs = await compileDirectory({
    srcDir: path.join(ROOT_DIR, "packages", "web", "src"),
    outDir: path.join(DIST_PAGES_DIR, "sdk", "web"),
    excludeFiles: new Set(["phase0-runner.ts"]),
  });

  const vendorFiles = await Promise.all([
    copyFileEnsureDir(
      "node_modules/zxing-wasm/dist/es/reader/index.js",
      "vendor/zxing-wasm/es/reader/index.js",
    ),
    copyFileEnsureDir(
      "node_modules/zxing-wasm/dist/es/share.js",
      "vendor/zxing-wasm/es/share.js",
    ),
    copyFileEnsureDir(
      "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm",
      "vendor/zxing-wasm/zxing_reader.wasm",
    ),
  ]);

  const siteFiles = await Promise.all([
    copyFileEnsureDir("site/index.html", "index.html"),
    copyFileEnsureDir("site/styles.css", "styles.css"),
    copyFileEnsureDir("site/app.js", "app.js"),
    copyFileEnsureDir("docs/benchmark/phase0-results.json", "phase0-results.json"),
  ]);

  await writeFile(path.join(DIST_PAGES_DIR, ".nojekyll"), "", "utf8");

  console.log(
    `Built GitHub Pages bundle in ${path.relative(ROOT_DIR, DIST_PAGES_DIR)}:`,
  );
  console.log(`  core modules:   ${coreOutputs.length}`);
  console.log(`  web modules:    ${webOutputs.length}`);
  console.log(`  vendor assets:  ${vendorFiles.length}`);
  console.log(`  site assets:    ${siteFiles.length + 1} (incl. .nojekyll)`);
}

await buildPages();
