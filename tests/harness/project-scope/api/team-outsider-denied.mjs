import { apiFetch, loginTeamRole } from "./_helpers/team-context.mjs";

const context = await loginTeamRole("outsider");
const readResult = await apiFetch(`${context.base}/documents/tree`, context.token);
if (readResult.response.status !== 403 || readResult.payload?.code !== "PROJECT_ACCESS_DENIED") {
  throw new Error(`outsider read denial mismatch: ${readResult.response.status} ${JSON.stringify(readResult.payload)}`);
}

const writeResult = await apiFetch(
  `${context.base}/documents/${encodeURIComponent(context.fixture.writeProbeDocId)}/lock`,
  context.token,
  { method: "PUT" },
);
if (writeResult.response.status !== 403 || writeResult.payload?.code !== "PROJECT_ACCESS_DENIED") {
  throw new Error(`outsider write denial mismatch: ${writeResult.response.status} ${JSON.stringify(writeResult.payload)}`);
}

console.log(JSON.stringify({
  ok: true,
  readStatus: readResult.response.status,
  writeStatus: writeResult.response.status,
}, null, 2));
