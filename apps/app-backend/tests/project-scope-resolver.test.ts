import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ProjectScopeResolverError,
  createProjectScopeResolver,
} from "../src/middleware/project-scope-resolver.ts";

test("project-scope-resolver: resolves personal owner scope", async () => {
  const resolveScope = createProjectScopeResolver({
    queryFn: async (sql) => {
      if (sql.includes("FROM project")) {
        return { rows: [{ id: "project-1" }] };
      }
      return { rows: [] };
    },
  });

  const scope = await resolveScope({
    userId: "user-1",
    ownerType: "personal",
    ownerKey: "me",
    projectKey: "demo",
    method: "GET",
  });

  assert.equal(scope.ownerType, "personal");
  assert.equal(scope.ownerId, "user-1");
  assert.equal(scope.ownerKey, "me");
  assert.equal(scope.scopedProjectKey, "personal::user-1::demo");
  assert.equal(scope.projectId, "project-1");
  assert.equal(scope.canWrite, true);
});

test("project-scope-resolver: denies write for team viewer role", async () => {
  const resolveScope = createProjectScopeResolver({
    queryFn: async (sql) => {
      if (sql.includes("FROM team")) {
        return {
          rows: [{ id: "team-1", slug: "alpha", role: "viewer" }],
        };
      }
      if (sql.includes("FROM project")) {
        return { rows: [{ id: "project-1" }] };
      }
      return { rows: [] };
    },
  });

  await assert.rejects(
    () =>
      resolveScope({
        userId: "user-1",
        ownerType: "team",
        ownerKey: "alpha",
        projectKey: "demo",
        method: "POST",
      }),
    (err: unknown) =>
      err instanceof ProjectScopeResolverError &&
      err.code === "PROJECT_ACCESS_DENIED" &&
      err.status === 403,
  );
});

test("project-scope-resolver: validates owner_type", async () => {
  const resolveScope = createProjectScopeResolver({
    queryFn: async () => ({ rows: [] }),
  });

  await assert.rejects(
    () =>
      resolveScope({
        userId: "user-1",
        ownerType: "org",
        ownerKey: "oops",
        projectKey: "demo",
      }),
    (err: unknown) =>
      err instanceof ProjectScopeResolverError &&
      err.code === "INVALID_OWNER" &&
      err.status === 400,
  );
});
