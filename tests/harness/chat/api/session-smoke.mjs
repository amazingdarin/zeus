import { apiFetch, buildProjectApiBase, login } from "../../document-flow/api/_helpers/auth.mjs";

const context = await login();
const base = buildProjectApiBase(context);
const listed = await apiFetch(`${base}/chat/sessions?limit=10&offset=0`, context.token);
if (!listed.response.ok) {
  throw new Error(`list chat sessions failed: ${listed.response.status}`);
}
const title = `Harness Chat Session ${Date.now()}`;
const created = await apiFetch(`${base}/chat/sessions`, context.token, {
  method: "POST",
  body: JSON.stringify({ title }),
});
if (!created.response.ok) {
  throw new Error(`create chat session failed: ${created.response.status}`);
}
console.log(JSON.stringify({ ok: true, createdTitle: title }, null, 2));
