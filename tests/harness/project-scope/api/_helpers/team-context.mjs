import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const serverUrl = "http://127.0.0.1:8080";
const appBackendUrl = "http://127.0.0.1:4870";

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

export async function loadTeamHarnessContext() {
  const fixture = await readJson("tests/fixtures/project-scope/team.json");
  const accountRegistry = await readJson("output/playwright/project-scope-team-accounts.json");
  return {
    fixture,
    accountRegistry,
    serverUrl,
    appBackendUrl,
  };
}

export function buildTeamProjectApiBase(context) {
  return `${context.appBackendUrl}/api/projects/team/${context.fixture.ownerKey}/${encodeURIComponent(context.fixture.projectKey)}`;
}

export async function loginTeamAccountKey(accountKey) {
  const context = await loadTeamHarnessContext();
  const account = context.accountRegistry?.[accountKey];
  if (!account) {
    throw new Error(`missing team account registry entry: ${accountKey}`);
  }
  const response = await fetch(`${context.serverUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: account.email,
      password: account.password,
      remember_me: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`team account login failed for ${accountKey}: ${response.status}`);
  }
  const payload = await response.json();
  return {
    ...context,
    account,
    accountKey,
    token: payload.access_token,
    user: payload.user,
    base: buildTeamProjectApiBase(context),
  };
}

export async function loginTeamRole(role) {
  const context = await loadTeamHarnessContext();
  const accountKey = context.fixture.roles?.[role]?.accountKey;
  if (!accountKey) {
    throw new Error(`missing accountKey for team role: ${role}`);
  }
  return loginTeamAccountKey(accountKey);
}
