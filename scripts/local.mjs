#!/usr/bin/env node
/**
 * Cross-platform task runner for developer machines.
 *
 * The scripts/*.sh helpers exist for the Linux build agent: install-ci.sh needs
 * flock and /proc, build-verified.sh needs GNU timeout, and every npm script
 * that prefixes an inline VAR=value assignment fails under cmd.exe. None of
 * that is available on a stock Windows install, so `npm run <task>:local`
 * routes through this file, which spawns the same binaries with the same
 * project-local Wrangler/Miniflare state that vite.config.ts expects.
 */
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const MINIMUM_NODE = [22, 13, 0];

function projectEnv() {
  return {
    ...process.env,
    // Non-secret tool settings. Application config belongs in ignored .env files.
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_PATH: join(projectRoot, ".wrangler", "logs"),
    MINIFLARE_REGISTRY_PATH: join(projectRoot, ".wrangler", "registry"),
  };
}

/**
 * Resolve a dependency's executable to its JavaScript entry point. Reading the
 * package manifest off disk avoids both the .bin shim (which needs a shell on
 * Windows) and any exports map that hides package.json from require.resolve.
 */
async function resolveBin(packageName, binName = packageName) {
  const manifestPath = join(projectRoot, "node_modules", packageName, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    fail(
      `Bagimliliklar kurulu degil (${packageName} bulunamadi).\n` +
        `Once su komutu calistirin:  npm ci`,
      69,
    );
  }
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
  if (!bin) {
    fail(`${packageName} paketi ${binName} calistirilabiliri tanimlamiyor.`, 69);
  }
  return join(projectRoot, "node_modules", packageName, bin);
}

function run(file, args, { env = projectEnv() } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${file} ${signal} sinyali ile sonlandi.`));
        return;
      }
      if (code !== 0) {
        process.exit(code ?? 1);
      }
      resolve();
    });
  });
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function checkNodeVersion() {
  const current = process.versions.node.split(".").map(Number);
  for (let index = 0; index < MINIMUM_NODE.length; index += 1) {
    if (current[index] > MINIMUM_NODE[index]) return;
    if (current[index] < MINIMUM_NODE[index]) {
      fail(
        `Node.js ${MINIMUM_NODE.join(".")} veya uzeri gerekli, kurulu surum ${process.versions.node}.\n` +
          `Windows'ta guncelleme:  winget install OpenJS.NodeJS.LTS`,
        78,
      );
    }
  }
}

async function build() {
  const vinext = await resolveBin("vinext");
  await run(vinext, ["build"]);
  await run(join(projectRoot, "scripts", "validate-artifact.mjs"), []);
}

async function test() {
  await build();
  const testDir = join(projectRoot, "tests");
  const entries = (await readdir(testDir))
    .filter((entry) => entry.endsWith(".test.mjs"))
    .sort()
    .map((entry) => join(testDir, entry));
  if (entries.length === 0) {
    fail("tests/ altinda .test.mjs dosyasi bulunamadi.", 66);
  }
  // node --test expands globs on POSIX shells only, so pass explicit paths.
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", ...entries], {
      cwd: projectRoot,
      env: projectEnv(),
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : process.exit(code ?? 1)));
  });
}

async function doctor() {
  console.log(`proje dizini : ${projectRoot}`);
  console.log(`node         : ${process.versions.node}`);
  console.log(`platform     : ${process.platform}-${process.arch}`);
  checkNodeVersion();

  let installed = true;
  try {
    await readFile(join(projectRoot, "node_modules", "vinext", "package.json"), "utf8");
  } catch {
    installed = false;
  }
  console.log(`bagimliliklar: ${installed ? "kurulu" : "EKSIK -> npm ci"}`);

  if (!installed) {
    process.exit(69);
  }
  console.log("\nHazir. Gelistirme sunucusu:  npm run dev:local");
}

// Anything after the task name is forwarded, so `npm run dev:local -- --port 5174`
// reaches vite the same way `npx vite --port 5174` would.
const passthrough = process.argv.slice(3);

const tasks = {
  dev: async () => run(await resolveBin("vite"), passthrough),
  start: async () => run(await resolveBin("vinext"), ["start", ...passthrough]),
  build,
  validate: () => run(join(projectRoot, "scripts", "validate-artifact.mjs"), []),
  lint: async () =>
    run(await resolveBin("eslint"), [".", "--ignore-pattern", "dist", "--ignore-pattern", ".next", ...passthrough]),
  typecheck: async () => run(await resolveBin("typescript", "tsc"), ["--noEmit", "--pretty", "false", ...passthrough]),
  test,
  doctor,
};

const task = process.argv[2];
if (!task || !(task in tasks)) {
  fail(`kullanim: node scripts/local.mjs <${Object.keys(tasks).join("|")}>`, 64);
}
if (task !== "doctor") {
  checkNodeVersion();
}
await tasks[task]();
