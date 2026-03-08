import { apiFetch, buildProjectApiBase, login } from "./_helpers/auth.mjs";

const context = await login();
const { response, payload } = await apiFetch(
  `${buildProjectApiBase(context)}/documents/doc-flow-locked`,
  context.token,
);
if (!response.ok) {
  throw new Error(`lock harness failed: ${response.status}`);
}
const lock = payload?.data?.meta?.extra?.lock ?? null;
if (!lock?.locked) {
  throw new Error(`expected locked document, got: ${JSON.stringify(lock)}`);
}
console.log(JSON.stringify({ ok: true, lockedBy: lock.lockedBy }, null, 2));
