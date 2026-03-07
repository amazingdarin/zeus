import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { Pool } = require(path.join(repoRoot, "apps/app-backend/node_modules/pg"));
const ownerType = "personal";
const ownerKey = "me";

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

async function readTextIfExists(relativePath) {
  try {
    return await readFile(path.join(repoRoot, relativePath), "utf8");
  } catch {
    return null;
  }
}

function parseDatabaseUrl(raw) {
  const trimmed = String(raw || "").trim();
  return trimmed ? trimmed : null;
}

async function resolveDatabaseUrl() {
  const envLocal = await readTextIfExists("apps/app-backend/.env.local");
  const envDefault = await readTextIfExists("apps/app-backend/.env");
  const source = envLocal ?? envDefault ?? "";
  const line = source.split(/\r?\n/).find((row) => row.startsWith("DATABASE_URL="));
  return parseDatabaseUrl(line ? line.slice("DATABASE_URL=".length) : "");
}

async function apiFetch(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  return { response, payload };
}

async function login(account) {
  const { response, payload } = await apiFetch("http://127.0.0.1:8080/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: account.auth.email,
      password: account.auth.password,
      remember_me: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`login failed: ${response.status}`);
  }
  return payload;
}

function buildProjectApiBase(projectKey) {
  return `http://127.0.0.1:4870/api/projects/${ownerType}/${ownerKey}/${encodeURIComponent(projectKey)}`;
}

async function listTree(token, projectKey) {
  const { response, payload } = await apiFetch(`${buildProjectApiBase(projectKey)}/documents/tree`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`list tree failed for ${projectKey}: ${response.status}`);
  }
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function clearProject(token, projectKey) {
  const tree = await listTree(token, projectKey);
  for (const item of tree) {
    const docId = String(item?.id || "").trim();
    if (!docId) continue;
    await apiFetch(`${buildProjectApiBase(projectKey)}/documents/${encodeURIComponent(docId)}/lock`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await apiFetch(`${buildProjectApiBase(projectKey)}/documents/${encodeURIComponent(docId)}?recursive=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  await apiFetch(`${buildProjectApiBase(projectKey)}/trash`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function clearProjectMetadata(databaseUrl, userId, projectKeys) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      `DELETE FROM document_block_comment_threads
        WHERE owner_type = $1 AND owner_id = $2 AND project_key = ANY($3::text[])`,
      [ownerType, userId, projectKeys],
    );
    await pool.query(
      `DELETE FROM document_favorites
        WHERE user_id = $1 AND owner_type = $2 AND owner_id = $3 AND project_key = ANY($4::text[])`,
      [userId, ownerType, userId, projectKeys],
    );
    await pool.query(
      `DELETE FROM document_recent_edits
        WHERE user_id = $1 AND owner_type = $2 AND owner_id = $3 AND project_key = ANY($4::text[])`,
      [userId, ownerType, userId, projectKeys],
    );
  } finally {
    await pool.end();
  }
}

const account = await readJson("output/playwright/test-account.json");
const projectFixture = await readJson("tests/fixtures/document-flow/project.json");
const loginPayload = await login(account);
const token = loginPayload.access_token;
const userId = loginPayload.user?.id || account.user?.id;
const databaseUrl = await resolveDatabaseUrl();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for document-flow reset");
}

const projectKeys = [projectFixture.projectKey, projectFixture.emptyProjectKey];
for (const projectKey of projectKeys) {
  await clearProject(token, projectKey);
}
await clearProjectMetadata(databaseUrl, userId, projectKeys);

process.stdout.write(JSON.stringify({
  ok: true,
  resetProjectKeys: projectKeys,
}, null, 2) + "\n");
