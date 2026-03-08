import { apiFetch, login } from "../../document-flow/api/_helpers/auth.mjs";

const context = await login();
const runtime = await apiFetch(`${context.appBackendUrl}/api/plugins/v2/me/runtime`, context.token);
if (!runtime.response.ok) {
  throw new Error(`plugin runtime failed: ${runtime.response.status}`);
}
const plugins = Array.isArray(runtime.payload?.data?.plugins) ? runtime.payload.data.plugins : [];
if (plugins.length === 0) {
  throw new Error('expected at least one runtime plugin');
}
console.log(JSON.stringify({ ok: true, pluginCount: plugins.length }, null, 2));
