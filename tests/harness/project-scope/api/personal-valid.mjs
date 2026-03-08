import { apiFetch, buildProjectApiBase, login } from "../../document-flow/api/_helpers/auth.mjs";
import fixture from "../../../fixtures/project-scope/personal.json" with { type: "json" };

const context = await login();
const base = buildProjectApiBase(context, fixture.projectKey);
const response = await apiFetch(`${base}/documents/tree`, context.token);
if (!response.response.ok) {
  throw new Error(`personal valid scope failed: ${response.response.status}`);
}
console.log(JSON.stringify({ ok: true, ownerKey: fixture.ownerKey, projectKey: fixture.projectKey }, null, 2));
