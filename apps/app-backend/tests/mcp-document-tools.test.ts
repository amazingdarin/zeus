import assert from "node:assert/strict";
import { test } from "node:test";

import { createDocumentTools } from "../src/mcp/tools/document-tools.ts";
import { McpToolExecutionError } from "../src/mcp/types.ts";

const defaultScope = {
  ownerType: "personal" as const,
  ownerKey: "me",
  ownerId: "user-1",
  projectKey: "demo",
  scopedProjectKey: "personal::user-1::demo",
  projectId: "project-1",
  canRead: true,
  canWrite: true,
};

function findTool(name: string) {
  const tools = createDocumentTools({
    maxLimit: 50,
    maxTreeNodes: 1000,
    resolveScope: async () => defaultScope,
    documentStore: {
      getChildren: async () => [],
      getFullTree: async () => [],
      get: async () => ({
        meta: {
          id: "doc-1",
          schema_version: "v1",
          title: "Doc 1",
          slug: "doc-1",
          path: "doc-1.json",
          parent_id: "root",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        body: { type: "tiptap", content: { type: "doc", content: [] } },
      }),
      getHierarchy: async () => [],
      suggest: async () => [],
      getBlockById: async () => ({
        meta: {
          id: "doc-1",
          schema_version: "v1",
          title: "Doc 1",
          slug: "doc-1",
          path: "doc-1.json",
          parent_id: "root",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        body: { type: "tiptap", content: { type: "doc", content: [] } },
      }),
    },
    knowledgeSearch: {
      search: async () => [],
    },
  });
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `Tool ${name} should exist`);
  return tool;
}

test("mcp document tools: zeus.docs.get hides body by default", async () => {
  const tool = findTool("zeus.docs.get");
  const result = await tool.execute(
    {
      owner_type: "personal",
      owner_key: "me",
      project_key: "demo",
      doc_id: "doc-1",
    },
    {
      user: {
        id: "user-1",
        email: "u@example.com",
        username: "u",
      },
      sessionId: "session-1",
      requestId: "req-1",
    },
  );

  assert.equal(result.structuredContent.meta?.id, "doc-1");
  assert.equal("body" in result.structuredContent, true);
  assert.equal(result.structuredContent.body, undefined);
});

test("mcp document tools: zeus.docs.list clamps limit to MCP_MAX_LIMIT", async () => {
  const items = Array.from({ length: 120 }, (_, index) => ({
    id: `doc-${index + 1}`,
    slug: `doc-${index + 1}`,
    title: `Doc ${index + 1}`,
    kind: "file" as const,
  }));

  const tools = createDocumentTools({
    maxLimit: 50,
    maxTreeNodes: 1000,
    resolveScope: async () => defaultScope,
    documentStore: {
      getChildren: async () => items,
      getFullTree: async () => [],
      get: async () => {
        throw new Error("not used");
      },
      getHierarchy: async () => [],
      suggest: async () => [],
      getBlockById: async () => {
        throw new Error("not used");
      },
    },
    knowledgeSearch: {
      search: async () => [],
    },
  });

  const tool = tools.find((item) => item.name === "zeus.docs.list");
  assert.ok(tool, "zeus.docs.list should exist");

  const result = await tool.execute(
    {
      owner_type: "personal",
      owner_key: "me",
      project_key: "demo",
      parent_id: "root",
      limit: 999,
      offset: 10,
    },
    {
      user: {
        id: "user-1",
        email: "u@example.com",
        username: "u",
      },
      sessionId: "session-1",
      requestId: "req-1",
    },
  );

  assert.equal(result.structuredContent.limit, 50);
  assert.equal((result.structuredContent.items as unknown[]).length, 50);
});

test("mcp document tools: zeus.docs.search maps db outage to DEPENDENCY_UNAVAILABLE", async () => {
  const tools = createDocumentTools({
    maxLimit: 50,
    maxTreeNodes: 1000,
    resolveScope: async () => defaultScope,
    documentStore: {
      getChildren: async () => [],
      getFullTree: async () => [],
      get: async () => {
        throw new Error("not used");
      },
      getHierarchy: async () => [],
      suggest: async () => [],
      getBlockById: async () => {
        throw new Error("not used");
      },
    },
    knowledgeSearch: {
      search: async () => {
        const err = new Error("connection refused") as Error & { code?: string };
        err.code = "ECONNREFUSED";
        throw err;
      },
    },
  });

  const tool = tools.find((item) => item.name === "zeus.docs.search");
  assert.ok(tool, "zeus.docs.search should exist");

  await assert.rejects(
    () =>
      tool.execute(
        {
          owner_type: "personal",
          owner_key: "me",
          project_key: "demo",
          text: "hello",
        },
        {
          user: {
            id: "user-1",
            email: "u@example.com",
            username: "u",
          },
          sessionId: "session-1",
          requestId: "req-1",
        },
      ),
    (err: unknown) =>
      err instanceof McpToolExecutionError &&
      err.code === "DEPENDENCY_UNAVAILABLE" &&
      err.status === 503,
  );
});
