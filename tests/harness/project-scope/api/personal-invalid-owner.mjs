import { login } from "../../document-flow/api/_helpers/auth.mjs";
import fixture from "../../../fixtures/project-scope/personal.json" with { type: "json" };

const context = await login();
const response = await fetch(`${context.appBackendUrl}/api/projects/personal/${fixture.invalidOwnerKey}/${fixture.projectKey}/documents/tree`, {
  headers: { Authorization: `Bearer ${context.token}` },
});
if (![400, 403].includes(response.status)) {
  throw new Error(`expected invalid owner to fail with 400/403, got ${response.status}`);
}
console.log(JSON.stringify({ ok: true, status: response.status, invalidOwnerKey: fixture.invalidOwnerKey }, null, 2));
