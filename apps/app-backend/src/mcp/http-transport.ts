import { Router, type Request, type Response } from "express";

import { McpAuthError, resolveMcpUser } from "./auth.js";
import { ZeusMcpServer } from "./server.js";
import type { JsonRpcResponse, McpServerConfig } from "./types.js";

function isBrowserLikeRequest(req: Request): boolean {
  const secFetchMode = String(req.header("sec-fetch-mode") || "").trim();
  if (secFetchMode) return true;
  const userAgent = String(req.header("user-agent") || "");
  return /mozilla/i.test(userAgent);
}

function isOriginAllowed(origin: string, allowlist: string[]): boolean {
  if (allowlist.includes("*")) return true;
  return allowlist.includes(origin);
}

function enforceOriginPolicy(req: Request, res: Response, allowlist: string[]): boolean {
  const origin = String(req.header("origin") || "").trim();
  const browserLike = isBrowserLikeRequest(req);

  if (!origin) {
    if (browserLike) {
      res.status(403).json({
        code: "MCP_ORIGIN_REQUIRED",
        message: "Browser requests must include Origin header",
      });
      return false;
    }
    return true;
  }

  if (!isOriginAllowed(origin, allowlist)) {
    res.status(403).json({
      code: "MCP_ORIGIN_NOT_ALLOWED",
      message: "Origin is not allowed for MCP endpoint",
    });
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Session-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return true;
}

function sendJsonRpcAuthError(res: Response, err: McpAuthError): void {
  res.status(err.status).json({
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32000,
      message: err.message,
      data: {
        code: err.code,
        status: err.status,
      },
    },
  });
}

async function runSingleRequest(
  server: ZeusMcpServer,
  rawRequest: unknown,
  req: Request,
  sessionId: string | undefined,
  requireAuth: boolean,
): Promise<{ response: JsonRpcResponse | null; sessionIdToSet?: string }> {
  const user = resolveMcpUser(req, requireAuth);
  let generatedSessionId: string | undefined;
  const response = await server.handleRequest(rawRequest, {
    user,
    sessionId,
    setSessionId: (nextSessionId) => {
      generatedSessionId = nextSessionId;
    },
  });
  return { response, sessionIdToSet: generatedSessionId };
}

export function createMcpHttpTransport(
  server: ZeusMcpServer,
  config: McpServerConfig,
): Router {
  const router = Router();

  router.options("/", (req, res) => {
    if (!enforceOriginPolicy(req, res, config.allowedOrigins)) {
      return;
    }
    res.status(204).end();
  });

  router.get("/", (req, res) => {
    if (!enforceOriginPolicy(req, res, config.allowedOrigins)) {
      return;
    }

    const accept = String(req.header("accept") || "");
    if (!accept.includes("text/event-stream")) {
      res.status(200).json({
        code: "OK",
        message: "Use POST for JSON-RPC requests. Use SSE GET with MCP-Session-Id for stream channel.",
      });
      return;
    }

    let userId = "";
    try {
      const user = resolveMcpUser(req, config.requireAuth);
      userId = user.id;
    } catch (err) {
      if (err instanceof McpAuthError) {
        sendJsonRpcAuthError(res, err);
        return;
      }
      const message = err instanceof Error ? err.message : "Authentication failed";
      res.status(401).json({ code: "UNAUTHORIZED", message });
      return;
    }

    const sessionId = String(req.header("mcp-session-id") || "").trim();
    if (!sessionId) {
      res.status(400).json({
        code: "MCP_SESSION_REQUIRED",
        message: "MCP-Session-Id header is required for SSE stream",
      });
      return;
    }
    if (!server.canUseSession(sessionId, userId)) {
      res.status(404).json({
        code: "MCP_SESSION_NOT_FOUND",
        message: "MCP session not found",
      });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write(
      `event: ready\ndata: ${JSON.stringify({ sessionId, userId, ts: new Date().toISOString() })}\n\n`,
    );

    const timer = setInterval(() => {
      res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    }, 15000);

    req.on("close", () => {
      clearInterval(timer);
      res.end();
    });
  });

  router.post("/", async (req, res) => {
    if (!enforceOriginPolicy(req, res, config.allowedOrigins)) {
      return;
    }

    let body: unknown = req.body;
    if (!body) {
      body = {};
    }

    const existingSessionId = String(req.header("mcp-session-id") || "").trim() || undefined;

    try {
      if (Array.isArray(body)) {
        const responses: JsonRpcResponse[] = [];
        let sessionIdToSet: string | undefined;
        let currentSessionId = existingSessionId;

        for (const item of body) {
          const result = await runSingleRequest(server, item, req, currentSessionId, config.requireAuth);
          if (result.sessionIdToSet) {
            sessionIdToSet = result.sessionIdToSet;
            currentSessionId = result.sessionIdToSet;
          }
          if (result.response) {
            responses.push(result.response);
          }
        }

        if (sessionIdToSet) {
          res.setHeader("MCP-Session-Id", sessionIdToSet);
        }

        if (responses.length === 0) {
          res.status(202).end();
          return;
        }
        res.status(200).json(responses);
        return;
      }

      const result = await runSingleRequest(server, body, req, existingSessionId, config.requireAuth);
      if (result.sessionIdToSet) {
        res.setHeader("MCP-Session-Id", result.sessionIdToSet);
      }
      if (!result.response) {
        res.status(202).end();
        return;
      }
      res.status(200).json(result.response);
    } catch (err) {
      if (err instanceof McpAuthError) {
        sendJsonRpcAuthError(res, err);
        return;
      }
      const message = err instanceof Error ? err.message : "MCP request failed";
      res.status(500).json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message,
        },
      });
    }
  });

  return router;
}
