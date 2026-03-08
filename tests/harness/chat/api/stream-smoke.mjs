import { apiFetch, buildProjectApiBase, login } from "../../document-flow/api/_helpers/auth.mjs";

const context = await login();
const response = await apiFetch(`${buildProjectApiBase(context)}/chat/sessions?limit=1&offset=0`, context.token);
if (!response.response.ok) {
  throw new Error(`chat stream readiness failed via sessions list: ${response.response.status}`);
}
console.log(JSON.stringify({ ok: true, ready: true }, null, 2));
