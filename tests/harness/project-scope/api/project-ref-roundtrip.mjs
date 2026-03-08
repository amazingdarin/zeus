import fixture from "../../../fixtures/project-scope/personal.json" with { type: "json" };

const projectRef = `${fixture.ownerType}::${fixture.ownerKey}::${fixture.projectKey}`;
const parts = projectRef.split('::');
if (parts.length !== 3) {
  throw new Error(`invalid project ref shape: ${projectRef}`);
}
const encoded = `${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`;
if (encoded !== `${fixture.ownerType}/${fixture.ownerKey}/${fixture.projectKey}`) {
  throw new Error(`encoded project ref mismatch: ${encoded}`);
}
console.log(JSON.stringify({ ok: true, projectRef, encoded }, null, 2));
