import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const serverUrl = process.env.ZEUS_AUTH_SERVER_URL || "http://127.0.0.1:8080";
const appBackendUrl = process.env.ZEUS_APP_BACKEND_URL || "http://127.0.0.1:4870";
const registryRelativePath = "output/playwright/project-scope-team-accounts.json";

const TEAM_ACCOUNT_SPECS = {
  teamAdmin: {
    email: "playwright.team.admin@zeus.local",
    username: "pwteamadmin",
    displayName: "Playwright Team Admin",
    envPasswordKey: "PROJECT_SCOPE_TEAM_ADMIN_PASSWORD",
  },
  teamMember: {
    email: "playwright.team.member@zeus.local",
    username: "pwteammember",
    displayName: "Playwright Team Member",
    envPasswordKey: "PROJECT_SCOPE_TEAM_MEMBER_PASSWORD",
  },
  teamViewer: {
    email: "playwright.team.viewer@zeus.local",
    username: "pwteamviewer",
    displayName: "Playwright Team Viewer",
    envPasswordKey: "PROJECT_SCOPE_TEAM_VIEWER_PASSWORD",
  },
  teamOutsider: {
    email: "playwright.team.outsider@zeus.local",
    username: "pwteamoutsider",
    displayName: "Playwright Team Outsider",
    envPasswordKey: "PROJECT_SCOPE_TEAM_OUTSIDER_PASSWORD",
  },
};

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

async function readJsonIfExists(relativePath) {
  try {
    return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
  } catch {
    return null;
  }
}

function generatePassword() {
  return randomBytes(18).toString("base64url");
}

function resolveAccountSpec(accountKey, existingRegistry) {
  const base = TEAM_ACCOUNT_SPECS[accountKey];
  const existing = existingRegistry && typeof existingRegistry === "object"
    ? existingRegistry[accountKey]
    : null;
  return {
    ...base,
    password: String(process.env[base.envPasswordKey] || existing?.password || generatePassword()),
  };
}

async function writeJson(relativePath, value) {
  const targetPath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function apiFetch(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { response, payload, text };
}

async function tryLoginAccount(account) {
  const result = await apiFetch(`${serverUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: account.email,
      password: account.password,
      remember_me: true,
    }),
  });
  if (result.response.ok) {
    return {
      token: result.payload.access_token,
      user: result.payload.user,
    };
  }
  if ([401, 403].includes(result.response.status)) {
    return null;
  }
  throw new Error(`login failed for ${account.email}: ${result.response.status}`);
}

async function ensureAccount(accountKey, spec) {
  const existing = await tryLoginAccount(spec);
  if (existing) {
    return {
      email: spec.email,
      password: spec.password,
      userId: existing.user.id,
      token: existing.token,
      username: existing.user.username,
      displayName: existing.user.display_name,
    };
  }

  const created = await apiFetch(`${serverUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: spec.email,
      username: spec.username,
      password: spec.password,
      display_name: spec.displayName,
    }),
  });

  if (created.response.status === 201) {
    return {
      email: spec.email,
      password: spec.password,
      userId: created.payload.user.id,
      token: created.payload.access_token,
      username: created.payload.user.username,
      displayName: created.payload.user.display_name,
    };
  }

  if (created.response.status === 409) {
    const retried = await tryLoginAccount(spec);
    if (retried) {
      return {
        email: spec.email,
        password: spec.password,
        userId: retried.user.id,
        token: retried.token,
        username: retried.user.username,
        displayName: retried.user.display_name,
      };
    }
    throw new Error(
      `account ${accountKey} already exists but the committed repo no longer carries its password; provide ${spec.envPasswordKey} or restore ${registryRelativePath}`,
    );
  }

  throw new Error(`register failed for ${spec.email}: ${created.response.status}`);
}
function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function ensureTeam(primary, fixture) {
  const listed = await apiFetch(`${serverUrl}/api/teams`, {
    headers: { Authorization: `Bearer ${primary.token}` },
  });
  if (!listed.response.ok) {
    throw new Error(`list teams failed: ${listed.response.status}`);
  }

  let team = Array.isArray(listed.payload)
    ? listed.payload.find((item) => String(item?.slug || "") === fixture.ownerKey)
    : null;

  if (!team) {
    const created = await apiFetch(`${serverUrl}/api/teams`, {
      method: "POST",
      headers: authHeaders(primary.token),
      body: JSON.stringify({
        name: "Playwright Team Scope",
        slug: fixture.ownerKey,
        description: "Seeded team for project-scope harnesses.",
      }),
    });
    if (![200, 201].includes(created.response.status)) {
      throw new Error(`create team failed: ${created.response.status}`);
    }
    team = created.payload;
  }

  const fetched = await apiFetch(`${serverUrl}/api/teams/${encodeURIComponent(fixture.ownerKey)}`, {
    headers: { Authorization: `Bearer ${primary.token}` },
  });
  if (!fetched.response.ok) {
    throw new Error(`get team failed: ${fetched.response.status}`);
  }
  const current = fetched.payload;
  if (String(current?.owner_id || "") !== primary.userId) {
    throw new Error(`team ${fixture.ownerKey} is not owned by the primary automation account`);
  }
  return current;
}

async function listMembers(primary, fixture) {
  const result = await apiFetch(`${serverUrl}/api/teams/${encodeURIComponent(fixture.ownerKey)}/members`, {
    headers: { Authorization: `Bearer ${primary.token}` },
  });
  if (!result.response.ok) {
    throw new Error(`list team members failed: ${result.response.status}`);
  }
  return Array.isArray(result.payload) ? result.payload : [];
}

async function ensureMemberRole(primary, fixture, userId, role, membersByUserId) {
  const current = membersByUserId.get(userId);
  if (!current) {
    const created = await apiFetch(`${serverUrl}/api/teams/${encodeURIComponent(fixture.ownerKey)}/members`, {
      method: "POST",
      headers: authHeaders(primary.token),
      body: JSON.stringify({ user_id: userId, role }),
    });
    if (![200, 201].includes(created.response.status)) {
      throw new Error(`add ${role} member failed: ${created.response.status}`);
    }
    return;
  }
  if (String(current.role || "") === role) {
    return;
  }
  const updated = await apiFetch(`${serverUrl}/api/teams/${encodeURIComponent(fixture.ownerKey)}/members/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: authHeaders(primary.token),
    body: JSON.stringify({ role }),
  });
  if (!updated.response.ok) {
    throw new Error(`update ${role} member failed: ${updated.response.status}`);
  }
}

async function ensureOutsiderRemoved(primary, fixture, userId, membersByUserId) {
  if (!membersByUserId.has(userId)) {
    return;
  }
  const removed = await apiFetch(`${serverUrl}/api/teams/${encodeURIComponent(fixture.ownerKey)}/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${primary.token}` },
  });
  if (!removed.response.ok) {
    throw new Error(`remove outsider failed: ${removed.response.status}`);
  }
}

async function ensureProject(primary, fixture) {
  const listed = await apiFetch(`${serverUrl}/api/projects`, {
    headers: { Authorization: `Bearer ${primary.token}` },
  });
  if (!listed.response.ok) {
    throw new Error(`list projects failed: ${listed.response.status}`);
  }
  const projects = Array.isArray(listed.payload?.data?.projects) ? listed.payload.data.projects : [];
  const existing = projects.find((project) => {
    const key = String(project?.key || project?.project_key || "");
    const ownerType = String(project?.owner_type || project?.ownerType || "");
    const ownerKey = String(project?.owner_key || project?.ownerKey || "");
    return key === fixture.projectKey && ownerType === fixture.ownerType && ownerKey === fixture.ownerKey;
  });
  if (existing) {
    return existing;
  }

  const created = await apiFetch(`${serverUrl}/api/projects`, {
    method: "POST",
    headers: authHeaders(primary.token),
    body: JSON.stringify({
      key: fixture.projectKey,
      name: "Playwright Team Doc Flow",
      description: "Seeded team project for project-scope harnesses.",
      owner_type: fixture.ownerType,
      owner_key: fixture.ownerKey,
    }),
  });
  if (![200, 201].includes(created.response.status)) {
    throw new Error(`create team project failed: ${created.response.status}`);
  }
  return created.payload?.data ?? null;
}

function buildProjectApiBase(fixture) {
  return `${appBackendUrl}/api/projects/team/${fixture.ownerKey}/${encodeURIComponent(fixture.projectKey)}`;
}

function buildWriteProbeDocument(docId) {
  return {
    meta: {
      id: docId,
      title: "Team Scope Lock Probe",
      parent_id: "root",
    },
    body: {
      type: "tiptap",
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { id: `${docId}-heading`, level: 1 },
            content: [{ type: "text", text: "Team Scope Lock Probe" }],
          },
          {
            type: "paragraph",
            attrs: { id: `${docId}-paragraph` },
            content: [{ type: "text", text: "Seeded document used by the project-scope team write matrix." }],
          },
        ],
      },
    },
  };
}

async function ensureWriteProbeDocument(session, fixture) {
  const base = buildProjectApiBase(fixture);
  const docId = encodeURIComponent(fixture.writeProbeDocId);
  const probe = buildWriteProbeDocument(fixture.writeProbeDocId);

  const existing = await apiFetch(`${base}/documents/${docId}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });

  if (existing.response.status === 404) {
    const created = await apiFetch(`${base}/documents`, {
      method: "POST",
      headers: authHeaders(session.token),
      body: JSON.stringify(probe),
    });
    if (![200, 201].includes(created.response.status)) {
      throw new Error(`create write probe document failed: ${created.response.status}`);
    }
  } else if (existing.response.ok) {
    const updated = await apiFetch(`${base}/documents/${docId}`, {
      method: "PUT",
      headers: authHeaders(session.token),
      body: JSON.stringify(probe),
    });
    if (!updated.response.ok) {
      throw new Error(`update write probe document failed: ${updated.response.status}`);
    }
  } else {
    throw new Error(`load write probe document failed: ${existing.response.status}`);
  }

  const unlocked = await apiFetch(`${base}/documents/${docId}/lock`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!unlocked.response.ok) {
    throw new Error(`unlock write probe document failed: ${unlocked.response.status}`);
  }
}

const baseAccount = await readJson("output/playwright/test-account.json");
const existingRegistry = await readJsonIfExists(registryRelativePath);
const teamFixture = await readJson("tests/fixtures/project-scope/team.json");

const primaryLogin = await tryLoginAccount({
  email: baseAccount.auth.email,
  password: baseAccount.auth.password,
});
if (!primaryLogin) {
  throw new Error(`primary automation account login failed for ${baseAccount.auth.email}`);
}

const registry = {
  primary: {
    email: baseAccount.auth.email,
    password: baseAccount.auth.password,
    userId: primaryLogin.user.id,
  },
};

for (const accountKey of Object.keys(TEAM_ACCOUNT_SPECS)) {
  const spec = resolveAccountSpec(accountKey, existingRegistry);
  const ensured = await ensureAccount(accountKey, spec);
  registry[accountKey] = {
    email: ensured.email,
    password: ensured.password,
    userId: ensured.userId,
  };
}

const primary = {
  token: primaryLogin.token,
  userId: primaryLogin.user.id,
};

await ensureTeam(primary, teamFixture);
const members = await listMembers(primary, teamFixture);
const membersByUserId = new Map(members.map((member) => [String(member.user_id || member.userId || ""), member]));
await ensureMemberRole(primary, teamFixture, registry.teamAdmin.userId, "admin", membersByUserId);
await ensureMemberRole(primary, teamFixture, registry.teamMember.userId, "member", membersByUserId);
await ensureMemberRole(primary, teamFixture, registry.teamViewer.userId, "viewer", membersByUserId);
await ensureOutsiderRemoved(primary, teamFixture, registry.teamOutsider.userId, membersByUserId);
await ensureProject(primary, teamFixture);
for (const accountKey of ["primary", "teamAdmin", "teamMember"]) {
  const session = await tryLoginAccount({
    email: registry[accountKey].email,
    password: registry[accountKey].password,
  });
  if (!session) {
    throw new Error(`seed login failed for ${accountKey}`);
  }
  await ensureWriteProbeDocument({ token: session.token }, teamFixture);
}
await writeJson(registryRelativePath, registry);

process.stdout.write(`${JSON.stringify({
  ok: true,
  ownerKey: teamFixture.ownerKey,
  projectKey: teamFixture.projectKey,
  writeProbeDocId: teamFixture.writeProbeDocId,
  accounts: Object.keys(registry),
  registryPath: registryRelativePath,
}, null, 2)}\n`);
