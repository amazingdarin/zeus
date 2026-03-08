import { apiFetch, buildProjectApiBase, login } from "../../document-flow/api/_helpers/auth.mjs";

const context = await login();
const base = buildProjectApiBase(context);
const writeResult = await apiFetch(`${base}/plugins/v2/ppt-plugin/local-data/file`, context.token, {
  method: 'PUT',
  body: JSON.stringify({
    path: 'harness/smoke.json',
    content: JSON.stringify({ ok: true }),
    scope: 'project',
    encoding: 'utf8',
    overwrite: true,
  }),
});
if (!writeResult.response.ok) {
  throw new Error(`plugin local-data write failed: ${writeResult.response.status}`);
}
const readResult = await apiFetch(`${base}/plugins/v2/ppt-plugin/local-data/file?path=harness%2Fsmoke.json&scope=project&encoding=utf8`, context.token);
if (!readResult.response.ok) {
  throw new Error(`plugin local-data read failed: ${readResult.response.status}`);
}
console.log(JSON.stringify({ ok: true, path: 'harness/smoke.json' }, null, 2));
