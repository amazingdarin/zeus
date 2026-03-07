import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";

import { createMcpRouter } from "../src/mcp/index.ts";

async function withMcpServer(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/mcp",
    createMcpRouter({
      enabled: true,
      path: "/api/mcp",
      requireAuth: false,
      allowedOrigins: [],
      readToolsEnabled: true,
      writeToolsEnabled: false,
      maxLimit: 50,
      maxTreeNodes: 1000,
    }),
  );

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to resolve test server address");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("mcp http transport: initialize then tools/list", async (t) => {
  try {
    await withMcpServer(async (baseUrl) => {
      const initResp = await fetch(`${baseUrl}/api/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "init-1",
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
          },
        }),
      });
      assert.equal(initResp.status, 200);
      const sessionId = initResp.headers.get("mcp-session-id");
      assert.ok(sessionId, "initialize should return MCP-Session-Id header");

      const listResp = await fetch(`${baseUrl}/api/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": sessionId,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "list-1",
          method: "tools/list",
        }),
      });
      assert.equal(listResp.status, 200);
      const payload = await listResp.json() as {
        result?: {
          tools?: Array<{ name: string }>;
        };
      };
      const names = (payload.result?.tools || []).map((tool) => tool.name);
      assert.ok(names.includes("zeus.docs.get"));
      assert.ok(names.includes("zeus.docs.search"));
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("Sandbox denies opening local ports");
      return;
    }
    throw err;
  }
});

test("mcp http transport: browser-like request without origin is denied", async (t) => {
  try {
    await withMcpServer(async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/api/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-mode": "cors",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "init-1",
          method: "initialize",
          params: {},
        }),
      });
      assert.equal(resp.status, 403);
      const payload = await resp.json() as { code?: string };
      assert.equal(payload.code, "MCP_ORIGIN_REQUIRED");
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("Sandbox denies opening local ports");
      return;
    }
    throw err;
  }
});
