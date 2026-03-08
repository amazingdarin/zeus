import { login } from "../../document-flow/api/_helpers/auth.mjs";

const context = await login();
const response = await fetch(`${context.serverUrl}/api/auth/me`, {
  headers: { Authorization: `Bearer ${context.token}` },
});
if (!response.ok) {
  throw new Error(`auth me failed: ${response.status}`);
}
const payload = await response.json();
console.log(JSON.stringify({ ok: true, userId: payload?.id ?? payload?.user?.id ?? null }, null, 2));
