import { apiFetch, buildProjectApiBase, login } from "./_helpers/auth.mjs";

const context = await login();
const query = new URLSearchParams({ blockId: "doc-flow-comment-block" });
const { response, payload } = await apiFetch(
  `${buildProjectApiBase(context)}/documents/doc-flow-commented/block-comments?${query.toString()}`,
  context.token,
);
if (!response.ok) {
  throw new Error(`comment harness failed: ${response.status}`);
}
const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];
if (items.length === 0) {
  throw new Error("expected at least one seeded comment thread");
}
console.log(JSON.stringify({ ok: true, threadCount: items.length }, null, 2));
