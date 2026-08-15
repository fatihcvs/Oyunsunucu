#!/usr/bin/env node
/**
 * Cross-platform port of scripts/validate-artifact.sh.
 *
 * The shell version is what the Linux build agent runs. Windows and macOS
 * machines do not ship bash by default, so local builds validate through this
 * file instead. Both must assert the same contract: the packaged Sites Worker
 * exposes an ESM default export with fetch(request, env, ctx), and the hosting
 * manifest is present and parseable.
 */
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workerPath = join(projectRoot, "dist", "server", "index.js");
const hostingPath = join(projectRoot, "dist", ".openai", "hosting.json");

async function requireFile(path, message) {
  try {
    await access(path);
  } catch {
    console.error(message);
    process.exit(66);
  }
}

await requireFile(workerPath, "Missing Sites Worker entry: dist/server/index.js");
await requireFile(hostingPath, "Missing packaged Sites manifest: dist/.openai/hosting.json");

JSON.parse(await readFile(hostingPath, "utf8"));

// A fresh query string keeps repeated validations from reusing a cached module.
const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("sites-validation", `${process.pid}-${Date.now()}`);
const worker = await import(workerUrl.href);

if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error("dist/server/index.js must have an ESM default export with fetch(request, env, ctx)");
}

console.log("Validated Sites artifact: ESM Worker default.fetch and hosting manifest are present.");
