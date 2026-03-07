import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const ownerType = "personal";
const ownerKey = "me";

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
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

async function ensureProject(token, key, name) {
  const { response, payload } = await apiFetch("http://127.0.0.1:8080/api/projects", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`list projects failed: ${response.status}`);
  }
  const projects = Array.isArray(payload?.data?.projects) ? payload.data.projects : [];
  const exists = projects.some((project) => String(project?.key || "").trim() === key);
  if (exists) {
    return;
  }
  const created = await apiFetch("http://127.0.0.1:8080/api/projects", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key, name, owner_type: ownerType, owner_key: ownerKey }),
  });
  if (!created.response.ok) {
    throw new Error(`create project failed: ${created.response.status}`);
  }
}

async function listTree(token, projectKey) {
  const { response, payload } = await apiFetch(`${buildProjectApiBase(projectKey)}/documents/tree`, {
    headers: { Authorization: `Bearer ${token}` },
  });
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

async function getDocument(token, projectKey, docId) {
  const { response, payload } = await apiFetch(`${buildProjectApiBase(projectKey)}/documents/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`get document failed for ${docId}: ${response.status}`);
  }
  return payload?.data ?? null;
}

async function upsertDocument(token, projectKey, fixture) {
  const docId = String(fixture?.meta?.id || "").trim();
  const existing = await getDocument(token, projectKey, docId);
  const url = existing
    ? `${buildProjectApiBase(projectKey)}/documents/${encodeURIComponent(docId)}`
    : `${buildProjectApiBase(projectKey)}/documents`;
  const method = existing ? "PUT" : "POST";
  const { response } = await apiFetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fixture),
  });
  if (!response.ok) {
    throw new Error(`${method} document failed for ${docId}: ${response.status}`);
  }
}

async function unlockDocument(token, projectKey, docId) {
  await apiFetch(`${buildProjectApiBase(projectKey)}/documents/${encodeURIComponent(docId)}/lock`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function lockDocument(token, projectKey, docId) {
  const { response } = await apiFetch(`${buildProjectApiBase(projectKey)}/documents/${encodeURIComponent(docId)}/lock`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`lock document failed for ${docId}: ${response.status}`);
  }
}

async function ensureCommentThread(token, projectKey, commentFixture) {
  const query = new URLSearchParams({ blockId: commentFixture.blockId });
  const { response, payload } = await apiFetch(
    `${buildProjectApiBase(projectKey)}/documents/${encodeURIComponent(commentFixture.docId)}/block-comments?${query.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`list block comments failed: ${response.status}`);
  }
  const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];
  if (items.length > 0) {
    return;
  }
  const created = await apiFetch(
    `${buildProjectApiBase(projectKey)}/documents/${encodeURIComponent(commentFixture.docId)}/block-comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        blockId: commentFixture.blockId,
        content: commentFixture.content,
      }),
    },
  );
  if (!created.response.ok) {
    throw new Error(`create block comment failed: ${created.response.status}`);
  }
}

const account = await readJson("output/playwright/test-account.json");
const projectFixture = await readJson("tests/fixtures/document-flow/project.json");
const rootDoc = await readJson("tests/fixtures/document-flow/documents/root.json");
const lockedDoc = await readJson("tests/fixtures/document-flow/documents/locked.json");
const commentedDoc = await readJson("tests/fixtures/document-flow/documents/commented.json");
const commentFixture = await readJson("tests/fixtures/document-flow/comment-thread.json");

const loginPayload = await login(account);
const token = loginPayload.access_token;

await ensureProject(token, projectFixture.projectKey, projectFixture.projectName);
await ensureProject(token, projectFixture.emptyProjectKey, projectFixture.emptyProjectName);
await clearProject(token, projectFixture.emptyProjectKey);

await upsertDocument(token, projectFixture.projectKey, rootDoc);
await upsertDocument(token, projectFixture.projectKey, lockedDoc);
await upsertDocument(token, projectFixture.projectKey, commentedDoc);
await unlockDocument(token, projectFixture.projectKey, rootDoc.meta.id);
await unlockDocument(token, projectFixture.projectKey, commentedDoc.meta.id);
await ensureCommentThread(token, projectFixture.projectKey, commentFixture);
await lockDocument(token, projectFixture.projectKey, lockedDoc.meta.id);

process.stdout.write(JSON.stringify({
  ok: true,
  seededProjectKey: projectFixture.projectKey,
  emptyProjectKey: projectFixture.emptyProjectKey,
  documents: [rootDoc.meta.id, lockedDoc.meta.id, commentedDoc.meta.id],
  commentBlockId: commentFixture.blockId,
}, null, 2) + "\n");
