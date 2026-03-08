import { login } from "../../document-flow/api/_helpers/auth.mjs";

const context = await login();
const response = await fetch(`${context.serverUrl}/api/projects`, {
  headers: { Authorization: `Bearer ${context.token}` },
});
if (!response.ok) {
  throw new Error(`list projects failed: ${response.status}`);
}
const payload = await response.json();
const projects = Array.isArray(payload?.data?.projects) ? payload.data.projects : [];
if (projects.length === 0) {
  throw new Error('expected at least one personal project');
}
console.log(JSON.stringify({ ok: true, projectCount: projects.length }, null, 2));
