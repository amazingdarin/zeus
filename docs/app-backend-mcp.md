# Zeus App-Backend MCP Server (Phase 1)

本文档说明 `apps/app-backend` 新增的文档 MCP Server（HTTP Streamable）接入方式。

## Endpoint

- 默认地址：`/api/mcp`
- 环境变量：
  - `MCP_SERVER_ENABLED=false`
  - `MCP_SERVER_PATH=/api/mcp`
  - `MCP_ALLOWED_ORIGINS=`
  - `MCP_REQUIRE_AUTH=true`
  - `MCP_DOC_TOOLS_READ_ENABLED=true`
  - `MCP_DOC_TOOLS_WRITE_ENABLED=false`
  - `MCP_MAX_LIMIT=50`
  - `MCP_MAX_TREE_NODES=1000`

## Auth & Scope

- 每次 tool call 都必须显式传：
  - `owner_type`: `personal` 或 `team`
  - `owner_key`
  - `project_key`
- `MCP_REQUIRE_AUTH=true` 时，必须带 `Authorization: Bearer <access_token>`。
- 权限与 owner/project 解析复用 app-backend 现有规则（`project-scope-resolver`）。

## Supported Tools (Read-Only)

- `zeus.docs.list`
- `zeus.docs.tree`
- `zeus.docs.get`
- `zeus.docs.hierarchy`
- `zeus.docs.suggest`
- `zeus.docs.get_block`
- `zeus.docs.search`

## Tool Input Overview

所有工具共享字段：

```json
{
  "owner_type": "personal",
  "owner_key": "me",
  "project_key": "my-project"
}
```

工具附加字段：

- `zeus.docs.list`: `parent_id?`, `limit?`, `offset?`
- `zeus.docs.tree`: `max_depth?`, `max_nodes?`
- `zeus.docs.get`: `doc_id`, `include_body?`（默认 `false`）
- `zeus.docs.hierarchy`: `doc_id`
- `zeus.docs.suggest`: `q?`, `parent_id?`, `limit?`
- `zeus.docs.get_block`: `doc_id`, `block_id`
- `zeus.docs.search`: `text`, `mode?`, `limit?`, `offset?`, `doc_ids?`

## JSON-RPC Lifecycle

1. `initialize`（服务端返回 `MCP-Session-Id` 响应头）
2. `notifications/initialized`
3. `tools/list`
4. `tools/call`

## cURL Example

```bash
curl -i http://localhost:4870/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "jsonrpc":"2.0",
    "id":"init-1",
    "method":"initialize",
    "params":{"protocolVersion":"2025-06-18"}
  }'
```

取得响应头 `MCP-Session-Id` 后再调用工具：

```bash
curl -s http://localhost:4870/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -H "MCP-Session-Id: <session_id>" \
  -d '{
    "jsonrpc":"2.0",
    "id":"call-1",
    "method":"tools/call",
    "params":{
      "name":"zeus.docs.get",
      "arguments":{
        "owner_type":"personal",
        "owner_key":"me",
        "project_key":"my-project",
        "doc_id":"<doc_id>",
        "include_body":false
      }
    }
  }'
```

## Error Semantics

- 文档不存在：`NOT_FOUND`
- 权限不足：`PROJECT_ACCESS_DENIED`
- owner/project 参数非法：`INVALID_OWNER` / `INVALID_PROJECT_KEY`
- 知识检索依赖不可用：`DEPENDENCY_UNAVAILABLE`（仅 `zeus.docs.search`）
