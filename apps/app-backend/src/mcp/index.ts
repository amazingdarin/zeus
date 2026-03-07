import type { Router } from "express";

import { createMcpHttpTransport } from "./http-transport.js";
import { ZeusMcpServer } from "./server.js";
import { createDocumentTools } from "./tools/document-tools.js";
import type { McpServerConfig } from "./types.js";

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function parseInteger(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function parseOriginAllowlist(value: string | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePath(value: string | undefined, fallback: string): string {
  const raw = String(value || "").trim() || fallback;
  if (!raw.startsWith("/")) {
    return `/${raw}`;
  }
  return raw;
}

export function loadMcpServerConfig(): McpServerConfig {
  return {
    enabled: parseBoolean(process.env.MCP_SERVER_ENABLED, false),
    path: normalizePath(process.env.MCP_SERVER_PATH, "/api/mcp"),
    requireAuth: parseBoolean(process.env.MCP_REQUIRE_AUTH, true),
    allowedOrigins: parseOriginAllowlist(process.env.MCP_ALLOWED_ORIGINS),
    readToolsEnabled: parseBoolean(process.env.MCP_DOC_TOOLS_READ_ENABLED, true),
    writeToolsEnabled: parseBoolean(process.env.MCP_DOC_TOOLS_WRITE_ENABLED, false),
    maxLimit: parseInteger(process.env.MCP_MAX_LIMIT, 50, 1),
    maxTreeNodes: parseInteger(process.env.MCP_MAX_TREE_NODES, 1000, 10),
  };
}

export function createMcpRouter(config: McpServerConfig): Router {
  const tools = createDocumentTools({
    maxLimit: config.maxLimit,
    maxTreeNodes: config.maxTreeNodes,
    readToolsEnabled: config.readToolsEnabled,
    writeToolsEnabled: config.writeToolsEnabled,
  });
  const server = new ZeusMcpServer(config, tools);
  return createMcpHttpTransport(server, config);
}

export type { McpServerConfig } from "./types.js";
