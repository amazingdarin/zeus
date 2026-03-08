import { apiFetch, loginTeamRole } from "./_helpers/team-context.mjs";

const expectedStatuses = {
  owner: 200,
  admin: 200,
  member: 200,
  viewer: 403,
};

const results = [];
for (const [role, expectedStatus] of Object.entries(expectedStatuses)) {
  const context = await loginTeamRole(role);
  const lockUrl = `${context.base}/documents/${encodeURIComponent(context.fixture.writeProbeDocId)}/lock`;
  const result = await apiFetch(lockUrl, context.token, { method: "PUT" });
  if (result.response.status !== expectedStatus) {
    throw new Error(`${role} write mismatch: expected ${expectedStatus}, got ${result.response.status}`);
  }
  if (expectedStatus === 403 && result.payload?.code !== "PROJECT_ACCESS_DENIED") {
    throw new Error(`${role} write denial mismatch: ${JSON.stringify(result.payload)}`);
  }
  if (expectedStatus === 200) {
    const unlockResult = await apiFetch(lockUrl, context.token, { method: "DELETE" });
    if (!unlockResult.response.ok) {
      throw new Error(`${role} unlock cleanup failed: ${unlockResult.response.status}`);
    }
  }
  results.push({ role, status: result.response.status });
}

console.log(JSON.stringify({ ok: true, results }, null, 2));
