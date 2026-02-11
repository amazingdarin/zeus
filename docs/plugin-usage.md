# Zeus 插件使用说明（v2）

本文面向两类读者：

- 使用者：安装、启停、执行插件命令
- 开发者：开发并发布符合 Zeus v2 规范的插件

当前系统仅支持 **pluginApiVersion=2**。

## Doc-Editor 第三方插件

doc-editor 插件开发与加载方案见：

- `/Users/darin/mine/code/zeus/docs/doc-editor-plugin-development.md`

## 1. 插件能力总览

插件通过 `capabilities` 声明能力，可同时声明多类能力：

- `docs.read`：读取文档/知识检索
- `docs.write`：创建、更新、移动、删除文档
- `docs.hook.before`：文档变更前拦截
- `docs.hook.after`：文档变更后异步监听
- `docs.tool.register`：文档工具（工具栏/文档头部/上下文）
- `docs.block.register`：自定义编辑器 block
- `system.command.register`：命令总线（命令面板/斜杠/API）
- `ui.menu.register`：菜单注入
- `ui.route.register`：路由页面注入
- `system.service.register`：系统服务扩展（importer/exporter/converter/analyzer）

## 2. 插件包结构

插件包为 `tgz`，解压后至少包含：

```text
manifest.json                 # 或 manifest.v2.json
frontend/index.mjs            # 可选
backend/index.mjs             # 可选
assets/*                      # 可选
```

说明：

- 有 `contributes.commands/docHooks/services` 时，必须提供 `backend.entry`。
- 前端入口由后端托管，运行时通过 `/api/plugins/v2/assets/...` 动态加载。

## 3. Manifest v2 最小示例

```json
{
  "id": "ppt-template-manager",
  "version": "0.2.0",
  "displayName": "PPT Template Manager",
  "pluginApiVersion": 2,
  "engines": {
    "zeusAppBackend": ">=0.1.0",
    "zeusWeb": ">=0.1.0"
  },
  "capabilities": [
    "system.command.register",
    "docs.tool.register",
    "ui.menu.register",
    "ui.route.register"
  ],
  "activation": {
    "commands": ["list-templates"],
    "routes": ["templates"]
  },
  "frontend": { "entry": "frontend/index.mjs" },
  "backend": { "entry": "backend/index.mjs" },
  "permissions": {
    "allowedHttpHosts": [],
    "maxExecutionMs": 8000,
    "maxHookExecutionMs": 3000
  },
  "contributes": {
    "commands": [
      {
        "id": "list-templates",
        "title": "列出 PPT 模版",
        "description": "列出可用模版",
        "slashAliases": ["/ppt-template-list"],
        "apiEnabled": true
      }
    ],
    "docTools": [
      {
        "id": "ppt-tool",
        "placement": "documentHeader",
        "commandId": "list-templates",
        "title": "PPT 模版推荐"
      }
    ],
    "menus": [
      {
        "id": "ppt-sidebar",
        "placement": "sidebar",
        "title": "PPT 模版",
        "routeId": "templates"
      }
    ],
    "routes": [
      {
        "id": "templates",
        "path": "/plugins/ppt-template-manager/templates",
        "title": "PPT 模版管理"
      }
    ]
  }
}
```

## 4. 后端配置（商店与签名）

在 `apps/app-backend/.env` 中配置：

```bash
# 二选一：本地 catalog 文件 或 远程 URL
PLUGIN_STORE_CATALOG_FILE=/abs/path/to/catalog.json
# PLUGIN_STORE_INDEX_URL=https://your-store/catalog.json

PLUGIN_STORE_TIMEOUT_MS=10000
PLUGIN_STORE_REQUIRE_SIGNATURE=false
PLUGIN_STORE_PUBLIC_KEY_PEM=

PLUGIN_MAX_EXECUTION_MS=20000
PLUGIN_WORKER_IDLE_MS=120000
PLUGIN_APP_BACKEND_VERSION=0.1.0
PLUGIN_WEB_VERSION=0.1.0
```

签名策略：

- `PLUGIN_STORE_REQUIRE_SIGNATURE=true` 时，无签名插件会被拒绝。
- 插件声明 `signature` 但未配置 `PLUGIN_STORE_PUBLIC_KEY_PEM` 时会安装失败。

## 5. 商店目录（catalog.json）格式

```json
{
  "plugins": [
    {
      "pluginId": "ppt-template-manager",
      "displayName": "PPT Template Manager",
      "versions": [
        {
          "version": "0.2.0",
          "packageUrl": "/abs/path/ppt-template-manager-0.2.0.tgz",
          "manifest": { "...": "manifest.v2 content" },
          "publishedAt": "2026-02-11T00:00:00Z"
        }
      ]
    }
  ]
}
```

`packageUrl` 支持：

- 本地绝对路径
- `file://...`
- `http://...` / `https://...`

## 6. 用户侧操作（API）

以下均为 app-backend API（需携带登录态或 `Authorization`）。

### 6.1 浏览商店

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:4870/api/plugins/v2/store?q=ppt"
```

### 6.2 安装插件

```bash
curl -X POST "http://localhost:4870/api/plugins/v2/me/install" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"pluginId":"ppt-template-manager","version":"0.2.0"}'
```

### 6.3 启停插件

```bash
curl -X PATCH "http://localhost:4870/api/plugins/v2/me/ppt-template-manager" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}'
```

### 6.4 卸载插件

```bash
curl -X DELETE "http://localhost:4870/api/plugins/v2/me/ppt-template-manager" \
  -H "Authorization: Bearer <TOKEN>"
```

### 6.5 执行插件命令（项目作用域）

```bash
curl -X POST \
  "http://localhost:4870/api/projects/personal/me/test/plugin-commands/list-templates/execute" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"doc_id":"optional-doc-id","__source":"api"}'
```

`__source` 可选：`api | palette | tool`。

## 7. 前端运行时行为

前端启动后会自动拉取：

- `/api/plugins/v2/me/runtime`：插件运行时清单
- `/api/plugins/v2/me/commands`：命令注册表

并做以下处理：

- 动态 `import(frontendEntryUrl)` 加载前端插件模块
- 注入侧边栏菜单、文档头菜单、页面路由
- 注入编辑器工具与 block 扩展
- 加载失败自动降级，不阻塞核心页面

## 8. Hook 行为（before / after）

支持事件：

- `document.create`
- `document.update`
- `document.delete`
- `document.move`
- `document.import`
- `document.optimize`

执行规则：

- before：按 `priority DESC + pluginId ASC` 串行执行
- before 支持 `allow | mutate | reject`
- after：异步执行，不阻塞主流程
- hook 异常默认 `fail-open`，主链路继续，写审计日志

## 9. 冲突与校验规则

安装时会校验：

- 插件签名与完整性（sha256）
- `pluginApiVersion` 与 `engines`
- capability 与贡献点一致性
- 命令 ID 冲突
- 斜杠别名冲突（含内置命令）
- 路由冲突

常见失败原因：

- `Unsupported pluginApiVersion`：仍在用 v1 manifest
- `contributes ... but does not declare capability`：缺 capability 声明
- `Plugin command id conflicts ...`：命令 ID 重复
- `Plugin slash alias conflicts ...`：斜杠命令重复

## 10. 开发插件（最小骨架）

### 10.1 backend/index.mjs

```js
export default {
  async executeCommand(commandId, input, ctx) {
    if (commandId === "list-templates") {
      return { items: [{ id: "default", name: "默认模板" }] };
    }
    throw new Error(`Unknown command: ${commandId}`);
  },

  async runHook(hookId, input, ctx) {
    if (hookId === "guard-update") {
      return { decision: "allow" };
    }
    return { decision: "allow" };
  }
};
```

### 10.2 frontend/index.mjs

```js
export default {
  register(ctx) {
    return {
      menus: [
        {
          id: "ppt-sidebar",
          placement: "sidebar",
          title: "PPT 模版",
          action: "list-templates"
        }
      ],
      routes: [
        {
          id: "templates",
          path: "/plugins/ppt-template-manager/templates"
        }
      ]
    };
  }
};
```

## 11. 本地数据落地位置

插件安装与用户数据位于：

```text
${ZEUS_DATA_ROOT}/users/{userId}/.plugin/
```

详见：`docs/user-data-directory.md`
