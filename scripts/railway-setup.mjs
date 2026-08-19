#!/usr/bin/env node
/**
 * Provisions or repairs the Railway deployment.
 *
 * Idempotent: every step checks what already exists before creating anything, so
 * running it twice does not create a second project, database or domain. Meant
 * for bootstrapping a fresh environment (staging, a rebuild after a mistake) and
 * for verifying that a live one still has the variables it needs.
 *
 * Secrets belonging to third parties are never invented here. The email and
 * Discord credentials must be entered by the operator; the script reports them
 * as missing instead of writing a placeholder that would make the health check
 * claim a capability the product does not have.
 *
 * Usage:
 *   node scripts/railway-setup.mjs --project riftory
 *   node scripts/railway-setup.mjs --project riftory --check
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

const run = promisify(execFile);

const SERVICE = "web";
const DATABASE_SERVICE = "Postgres";

/** Values the operator must supply; a fake one would be a lie, not a default. */
const OPERATOR_SECRETS = [
  "EMAIL_FROM",
  "RESEND_API_KEY",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
];

function parseArguments(argv) {
  const options = { project: "riftory", check: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--check") options.check = true;
    else if (argv[index] === "--project") options.project = argv[index + 1] ?? options.project;
  }
  return options;
}

async function railway(args, { allowFailure = false } = {}) {
  try {
    const { stdout, stderr } = await run("railway", args, { maxBuffer: 16 * 1024 * 1024 });
    return `${stdout}${stderr}`;
  } catch (error) {
    if (allowFailure) return "";
    throw new Error(`railway ${args[0]} başarısız: ${error.stderr || error.message}`);
  }
}

function secret(bytes) {
  return randomBytes(bytes).toString("base64url");
}

async function readVariables() {
  const output = await railway(["variables", "--service", SERVICE, "--kv"], { allowFailure: true });
  const variables = new Map();
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) variables.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return variables;
}

async function ensureLinkedProject(projectName) {
  const status = await railway(["status"], { allowFailure: true });
  if (status.includes(`Project:`) && status.includes(projectName)) return "linked";

  const created = await railway(["init", "--name", projectName, "--json"]);
  return created.includes("\"id\"") ? "created" : "linked";
}

async function ensureService(name, args) {
  const status = await railway(["status"], { allowFailure: true });
  if (status.includes(`- ${name}:`) || status.includes(`- ${name} `)) return "exists";

  await railway(args);
  return "created";
}

async function ensureDomain() {
  const existing = await railway(["domain", "list", "--service", SERVICE], { allowFailure: true });
  const found = existing.match(/[a-z0-9-]+\.up\.railway\.app/)?.[0];
  if (found) return found;

  await railway(["domain", "--service", SERVICE, "--port", "3000"], { allowFailure: true });
  const created = await railway(["domain", "list", "--service", SERVICE], { allowFailure: true });
  return created.match(/[a-z0-9-]+\.up\.railway\.app/)?.[0] ?? null;
}

async function setVariables(pairs) {
  if (pairs.length === 0) return;
  const args = ["variables", "--service", SERVICE];
  for (const pair of pairs) args.push("--set", pair);
  await railway(args);
}

const options = parseArguments(process.argv.slice(2));

try {
  const project = await ensureLinkedProject(options.project);
  console.log(`proje ${options.project}: ${project}`);

  const database = await ensureService(DATABASE_SERVICE, ["add", "--database", "postgres"]);
  console.log(`veritabanı: ${database}`);

  const service = await ensureService(SERVICE, ["add", "--service", SERVICE]);
  console.log(`servis ${SERVICE}: ${service}`);

  const domain = await ensureDomain();
  console.log(`alan adı: ${domain ?? "oluşturulamadı"}`);

  const current = await readVariables();
  const pending = [];

  // The database reference resolves to the private network address, where there
  // is no TLS to negotiate; `require` would fail the connection outright.
  const defaults = {
    DATABASE_URL: "${{Postgres.DATABASE_URL}}",
    DATABASE_SSL: "disable",
    NODE_ENV: "production",
    PAYMENT_PROVIDER: "fake",
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!current.get(key)) pending.push(`${key}=${value}`);
  }

  // Generated once and then left alone: rotating these would invalidate every
  // live session and every webhook signature in flight.
  if (!current.get("AUTH_SECRET")) pending.push(`AUTH_SECRET=${secret(48)}`);
  if (!current.get("PAYMENT_WEBHOOK_SECRET")) pending.push(`PAYMENT_WEBHOOK_SECRET=${secret(32)}`);
  if (domain && current.get("APP_ORIGIN") !== `https://${domain}`) {
    pending.push(`APP_ORIGIN=https://${domain}`);
  }

  if (options.check) {
    console.log(pending.length === 0 ? "değişken durumu: eksiksiz" : `eksik değişkenler: ${pending.map((p) => p.split("=")[0]).join(", ")}`);
  } else {
    await setVariables(pending);
    console.log(pending.length === 0 ? "değişkenler zaten hazır" : `girilen değişkenler: ${pending.map((p) => p.split("=")[0]).join(", ")}`);
  }

  const missing = OPERATOR_SECRETS.filter((key) => !current.get(key));
  if (missing.length > 0) {
    console.log(`\noperatör girmeli (üçüncü taraf kimlik bilgileri): ${missing.join(", ")}`);
    console.log("bunlar girilmeden e-posta ve Discord girişi kapalı kalır; site ve veritabanı çalışır.");
  }

  console.log(`\ndağıtım:  railway up --service ${SERVICE} --detach`);
  if (domain) console.log(`sağlık:   curl -s https://${domain}/api/health`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
