import assert from "node:assert/strict";
import { test } from "node:test";

import { ZeusMcpServer } from "../src/mcp/server.ts";
import { McpToolExecutionError, type McpToolDefinition } from "../src/mcp/types.ts";

const user = {
  id: "user-1",
  email: "u@example.com",
  username: "u",
};

const config = {
  enabled: true,
  path: "/api/mcp",
  requireAuth: true,
  allowedOrigins: [],
  readToolsEnabled: true,
  writeToolsEnabled: false,
  maxLimit: 50,
  maxTreeNodes: 1000,
};

test("mcp server: initialize creates session and tools/list requires session", async () => {
  const tools: McpToolDefinition[] = [
    {
      name: "zeus.docs.list",
      description: "list",
      readOnly: true,
      enabled: true,
      inputSchema: { type: "object", properties: {}, required: [] },
      execute: async () => ({
        structuredContent: { ok: true },
        text: "ok",
      }),
    },
  ];
  const server = new ZeusMcpServer(config, tools);

  const missingSessionResp = await server.handleRequest(
    {
      jsonrpc: "2.0",
      id: "list-1",
      method: "tools/list",
    },
    {
      user,
      sessionId: undefined,
      setSessionId: () => {},
    },
  );
  assert.ok(missingSessionResp && "error" in missingSessionResp);
  assert.equal(missingSessionResp.error.code, -32001);

  let sessionId = "";
  const initResp = await server.handleRequest(
    {
      jsonrpc: "2.0",
      id: "init-1",
      method: "initialize",
      params: {},
    },
    {
      user,
      sessionId: undefined,
      setSessionId: (nextSessionId) => {
        sessionId = nextSessionId;
      },
    },
  );
  assert.ok(initResp && "result" in initResp);
  assert.ok(sessionId.length > 0);
  assert.equal(server.hasSession(sessionId), true);

  const listResp = await server.handleRequest(
    {
      jsonrpc: "2.0",
      id: "list-2",
      method: "tools/list",
    },
    {
      user,
      sessionId,
      setSessionId: () => {},
    },
  );
  assert.ok(listResp && "result" in listResp);
  const toolNames = (listResp.result as { tools: Array<{ name: string }> }).tools.map((item) => item.name);
  assert.deepEqual(toolNames, ["zeus.docs.list"]);
});

test("mcp server: tools/call maps tool execution errors to isError payload", async () => {
  const tools: McpToolDefinition[] = [
    {
      name: "zeus.docs.search",
      description: "search",
      readOnly: true,
      enabled: true,
      inputSchema: { type: "object", properties: {}, required: [] },
      execute: async () => {
        throw new McpToolExecutionError("DEPENDENCY_UNAVAILABLE", "search unavailable", 503);
      },
    },
  ];
  const server = new ZeusMcpServer(config, tools);

  let sessionId = "";
  await server.handleRequest(
    {
      jsonrpc: "2.0",
      id: "init-1",
      method: "initialize",
      params: {},
    },
    {
      user,
      sessionId: undefined,
      setSessionId: (nextSessionId) => {
        sessionId = nextSessionId;
      },
    },
  );

  const callResp = await server.handleRequest(
    {
      jsonrpc: "2.0",
      id: "call-1",
      method: "tools/call",
      params: {
        name: "zeus.docs.search",
        arguments: {},
      },
    },
    {
      user,
      sessionId,
      setSessionId: () => {},
    },
  );
  assert.ok(callResp && "result" in callResp);
  const result = callResp.result as {
    isError: boolean;
    structuredContent: { code: string };
  };
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "DEPENDENCY_UNAVAILABLE");
});
