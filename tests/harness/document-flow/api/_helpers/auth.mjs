import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

export async function loadHarnessContext() {
  const account = await readJson("output/playwright/test-account.json");
  const project = await readJson("tests/fixtures/document-flow/project.json");
  return {
    account,
    project,
    serverUrl: "http://127.0.0.1:8080",
    appBackendUrl: "http://127.0.0.1:4870",
  };
}

export async function login() {
  const context = await loadHarnessContext();
  const response = await fetch(`${context.serverUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: context.account.auth.email,
      password: context.account.auth.password,
      remember_me: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`login failed: ${response.status}`);
  }
  const payload = await response.json();
  return {
    ...context,
    token: payload.access_token,
    user: payload.user,
    projectRef: `${context.project.ownerType}::${context.project.ownerKey}::${context.project.projectKey}`,
  };
}

export function buildProjectApiBase(context, projectKey = context.project.projectKey) {
  return `${context.appBackendUrl}/api/projects/${context.project.ownerType}/${context.project.ownerKey}/${encodeURIComponent(projectKey)}`;
}

export async function apiFetch(url, token, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  return { response, payload };
}
