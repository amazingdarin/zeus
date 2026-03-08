import { apiFetch, loginTeamRole } from "./_helpers/team-context.mjs";

const results = [];
for (const role of ["owner", "admin", "member", "viewer"]) {
  const context = await loginTeamRole(role);
  const result = await apiFetch(`${context.base}/documents/tree`, context.token);
  if (!result.response.ok) {
    throw new Error(`${role} read failed: ${result.response.status}`);
  }
  results.push({ role, status: result.response.status });
}

console.log(JSON.stringify({ ok: true, results }, null, 2));
