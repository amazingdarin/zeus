import { apiFetch, buildProjectApiBase, login } from "./_helpers/auth.mjs";

const context = await login();
const { response, payload } = await apiFetch(`${buildProjectApiBase(context)}/documents/tree`, context.token);
if (!response.ok) {
  throw new Error(`document tree failed: ${response.status}`);
}
const items = Array.isArray(payload?.data) ? payload.data : [];
const root = items.find((item) => item?.id === "doc-flow-root");
if (!root) {
  throw new Error(`doc-flow-root not found in tree: ${JSON.stringify(items)}`);
}
console.log(JSON.stringify({ ok: true, rootTitle: root.title, childCount: Array.isArray(root.children) ? root.children.length : 0 }, null, 2));
