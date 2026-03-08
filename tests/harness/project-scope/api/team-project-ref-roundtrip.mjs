import fixture from "../../../fixtures/project-scope/team.json" with { type: "json" };

const projectRef = `${fixture.ownerType}::${fixture.ownerKey}::${fixture.projectKey}`;
const encoded = projectRef.split("::").join("/");
const expected = `${fixture.ownerType}/${fixture.ownerKey}/${fixture.projectKey}`;
if (encoded !== expected) {
  throw new Error(`team projectRef roundtrip mismatch: ${encoded} !== ${expected}`);
}

console.log(JSON.stringify({ ok: true, projectRef, encoded }, null, 2));
