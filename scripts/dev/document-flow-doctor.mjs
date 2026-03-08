import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const jsonOnly = args.has("--json");

async function readTextIfExists(relativePath) {
  try {
    return await readFile(path.join(repoRoot, relativePath), "utf8");
  } catch {
    return null;
  }
}

function parseDatabaseUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return {
      raw: trimmed,
      host: url.hostname,
      port: url.port || (url.protocol === "postgres:" ? "5432" : ""),
      database: url.pathname.replace(/^\//, ""),
      user: decodeURIComponent(url.username || ""),
    };
  } catch {
    return { raw: trimmed, error: "invalid DATABASE_URL" };
  }
}

async function loadAppBackendDatabase() {
  const envLocal = await readTextIfExists("apps/app-backend/.env.local");
  const envDefault = await readTextIfExists("apps/app-backend/.env");
  const source = envLocal ?? envDefault ?? "";
  const line = source.split(/\r?\n/).find((row) => row.startsWith("DATABASE_URL="));
  return parseDatabaseUrl(line ? line.slice("DATABASE_URL=".length) : "");
}

async function loadServerDatabase() {
  const configLocal = await readTextIfExists("server/config.local.yaml");
  const configDefault = await readTextIfExists("server/config.yaml");
  const source = configLocal ?? configDefault ?? "";
  if (!source.trim()) return null;
  try {
    const parsed = YAML.parse(source) ?? {};
    const postgres = parsed.postgres ?? {};
    return {
      host: String(postgres.host || "").trim(),
      port: String(postgres.port || "").trim(),
      database: String(postgres.database || "").trim(),
      user: String(postgres.user || "").trim(),
    };
  } catch {
    return { error: "invalid server config" };
  }
}

const healthcheckTimeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 6000);

async function checkHttp(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(healthcheckTimeoutMs) ? healthcheckTimeoutMs : 6000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      url,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadTestAccount() {
  const text = await readTextIfExists("output/playwright/test-account.json");
  if (!text) {
    return { ok: false, exists: false };
  }
  try {
    const parsed = JSON.parse(text);
    return {
      ok: Boolean(parsed?.auth?.email && parsed?.auth?.password),
      exists: true,
      email: parsed?.auth?.email ?? null,
      baseUrl: parsed?.baseUrl ?? null,
    };
  } catch {
    return { ok: false, exists: true, error: "invalid JSON" };
  }
}

const [serverHttp, appBackendHttp, webHttp, appBackendDb, serverDb, testAccount] = await Promise.all([
  checkHttp("http://127.0.0.1:8080/api/system"),
  checkHttp("http://127.0.0.1:4870/api/settings/general"),
  checkHttp("http://127.0.0.1:1420"),
  loadAppBackendDatabase(),
  loadServerDatabase(),
  loadTestAccount(),
]);

const postgresAligned = Boolean(
  appBackendDb
  && serverDb
  && !appBackendDb.error
  && !serverDb.error
  && appBackendDb.host === serverDb.host
  && String(appBackendDb.port) === String(serverDb.port)
  && appBackendDb.database === serverDb.database,
);

const report = {
  server: serverHttp,
  appBackend: appBackendHttp,
  web: webHttp,
  postgres: {
    ok: postgresAligned,
    appBackend: appBackendDb,
    server: serverDb,
  },
  testAccount,
};

if (jsonOnly) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

for (const [key, value] of Object.entries(report)) {
  process.stdout.write(`${key}: ${JSON.stringify(value)}\n`);
}
