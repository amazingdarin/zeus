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
    password: "Playwright#2026!Admin",
    displayName: "Playwright Team Admin",
  },
  teamMember: {
    email: "playwright.team.member@zeus.local",
    username: "pwteammember",
    password: "Playwright#2026!Member",
    displayName: "Playwright Team Member",
  },
  teamViewer: {
    email: "playwright.team.viewer@zeus.local",
    username: "pwteamviewer",
    password: "Playwright#2026!Viewer",
    displayName: "Playwright Team Viewer",
  },
  teamOutsider: {
    email: "playwright.team.outsider@zeus.local",
    username: "pwteamoutsider",
    password: "Playwright#2026!Outsider",
    displayName: "Playwright Team Outsider",
  },
};

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
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

async function ensureAccount(spec) {
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

async function ensureWriteProbeDocument(primary, fixture) {
  const base = buildProjectApiBase(fixture);
  const docId = encodeURIComponent(fixture.writeProbeDocId);
  const probe = buildWriteProbeDocument(fixture.writeProbeDocId);

  const existing = await apiFetch(`${base}/documents/${docId}`, {
    headers: { Authorization: `Bearer ${primary.token}` },
  });

  if (existing.response.status === 404) {
    const created = await apiFetch(`${base}/documents`, {
      method: "POST",
      headers: authHeaders(primary.token),
      body: JSON.stringify(probe),
    });
    if (![200, 201].includes(created.response.status)) {
      throw new Error(`create write probe document failed: ${created.response.status}`);
    }
  } else if (existing.response.ok) {
    const updated = await apiFetch(`${base}/documents/${docId}`, {
      method: "PUT",
      headers: authHeaders(primary.token),
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
    headers: { Authorization: `Bearer ${primary.token}` },
  });
  if (!unlocked.response.ok) {
    throw new Error(`unlock write probe document failed: ${unlocked.response.status}`);
  }
}

const baseAccount = await readJson("output/playwright/test-account.json");
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

for (const [accountKey, spec] of Object.entries(TEAM_ACCOUNT_SPECS)) {
  const ensured = await ensureAccount(spec);
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
await ensureWriteProbeDocument(primary, teamFixture);
await writeJson(registryRelativePath, registry);

process.stdout.write(`${JSON.stringify({
  ok: true,
  ownerKey: teamFixture.ownerKey,
  projectKey: teamFixture.projectKey,
  writeProbeDocId: teamFixture.writeProbeDocId,
  accounts: Object.keys(registry),
  registryPath: registryRelativePath,
}, null, 2)}\n`);
