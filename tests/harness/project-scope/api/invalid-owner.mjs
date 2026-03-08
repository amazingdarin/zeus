import { login } from "../../document-flow/api/_helpers/auth.mjs";

const context = await login();
const response = await fetch(`${context.appBackendUrl}/api/projects/personal/not-me/any-project/documents/tree`, {
  headers: { Authorization: `Bearer ${context.token}` },
});
if (response.status !== 400) {
  throw new Error(`expected invalid owner to return 400, got ${response.status}`);
}
console.log(JSON.stringify({ ok: true, status: response.status }, null, 2));
