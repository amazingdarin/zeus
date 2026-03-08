import { apiFetch, login } from "../../document-flow/api/_helpers/auth.mjs";

const context = await login();
const installResult = await apiFetch(`${context.appBackendUrl}/api/plugins/v2/me/install`, context.token, {
  method: "POST",
  body: JSON.stringify({ pluginId: 'ppt-plugin' }),
});
if (!installResult.response.ok && installResult.response.status !== 409) {
  throw new Error(`plugin install failed: ${installResult.response.status}`);
}
console.log(JSON.stringify({ ok: true, pluginId: 'ppt-plugin', status: installResult.response.status }, null, 2));
