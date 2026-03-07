# Zeus 插件开发说明（v2）

本文是 Zeus `plugins-v2` 的开发步骤说明，面向插件开发者。

适用范围：
- 仅适用于 `pluginApiVersion=2`
- 目标运行时为 `apps/app-backend/src/plugins-v2/`

相关参考：
- 使用与安装 API：`docs/plugin-usage.md`
- Doc-Editor block 插件：`docs/doc-editor-plugin-development.md`
- 示例插件：`apps/app-backend/examples/plugins/ppt-plugin/`

## 开发步骤

### 1. 明确插件能力边界

先确定插件要做什么，再映射到 `capabilities`：

- 命令：`system.command.register`
- 文档前/后置 Hook：`docs.hook.before` / `docs.hook.after`
- 文档工具按钮：`docs.tool.register`
- 编辑器 block：`docs.block.register`
- 菜单/路由：`ui.menu.register` / `ui.route.register`
- 服务扩展：`system.service.register`
- 只读/写文档主机能力：`docs.read` / `docs.write`

注意：不要使用 v1 能力名（如 `doc.operation.execute`）。

### 2. 创建插件目录

最小目录建议：

```text
your-plugin/
  manifest.json
  frontend/
    index.mjs
  backend/
    index.mjs
```

规则：
- 有 `commands` / `docHooks` / `services` 时，必须有 `backend.entry`
- 有 `blocks` 时，必须有 `frontend.entry`

### 3. 编写 manifest.json

必填核心字段：
- `id`（推荐 kebab-case）
- `version`（semver）
- `displayName`
- `pluginApiVersion: 2`
- `engines.zeusAppBackend` / `engines.zeusWeb`
- `capabilities`
- `activation`
- `contributes`

示例（可直接改造）：

```json
{
  "id": "hello-plugin",
  "version": "0.1.0",
  "displayName": "Hello Plugin",
  "pluginApiVersion": 2,
  "engines": {
    "zeusAppBackend": ">=0.1.0",
    "zeusWeb": ">=0.1.0"
  },
  "capabilities": ["system.command.register", "ui.route.register"],
  "activation": {
    "commands": ["hello-plugin.say-hello"],
    "routes": ["hello"]
  },
  "frontend": { "entry": "frontend/index.mjs" },
  "backend": { "entry": "backend/index.mjs" },
  "contributes": {
    "commands": [
      {
        "id": "hello-plugin.say-hello",
        "title": "Say Hello",
        "description": "Return hello message",
        "slashAliases": ["/hello-plugin"],
        "apiEnabled": true,
        "handler": "say-hello"
      }
    ],
    "routes": [
      {
        "id": "hello",
        "path": "/plugins/hello-plugin/hello",
        "title": "Hello Page"
      }
    ]
  }
}
```

常见校验点（来自 `plugins-v2/manifest.ts`）：
- `pluginApiVersion` 必须是 `2`
- `contributes.*` 与 `capabilities` 必须对应
- `id/commandId/hookId/routeId` 必须是合法标识符
- 斜杠命令必须符合 `/xxx` 格式
- 路由必须以 `/` 开头

### 4. 编写 backend 入口（如有命令/Hook）

`backend/index.mjs` 默认导出对象，可实现：
- `executeCommand(commandId, input, ctx)`
- `runHook(hookId, input, ctx)`
- `execute(operationId, input, ctx)`（兼容调用）

最小示例：

```js
const plugin = {
  async executeCommand(commandId, input, ctx) {
    if (commandId !== "say-hello" && commandId !== "hello-plugin.say-hello") {
      throw new Error(`Unsupported command: ${commandId}`);
    }
    return {
      pluginId: ctx.pluginId,
      message: `hello, ${input?.name || "zeus"}`,
    };
  },
};

export default plugin;
```

### 4.1 Langfuse Trace（可选）

当 `LANGFUSE_ENABLED=true` 且后端已配置 Langfuse 时，插件可以通过统一的 `ctx.host.trace` API 写入 trace/span/generation。若插件在聊天/技能编排中被调用，会自动复用当前 trace；若没有 trace（例如 API 直接触发插件），系统会自动创建 `plugin.execute` trace，并包一层 `plugin.execute` span。

可用方法：
- `isEnabled()`：返回是否启用 Langfuse（未启用时不要尝试写入）。
- `startSpan(name, input?)` / `endSpan(spanId, output?, level?)`：记录插件内部步骤。
- `logGeneration(params)`：一次性记录 LLM 调用。
- `startGeneration(params)` / `endGeneration(generationId, output, usage?, level?, statusMessage?)`：用于流式或延迟结束的 LLM 调用。

建议：
- 只写入必要的 input/output/metadata，避免大段原文或敏感信息。
- 优先用 `ctx.host.trace.isEnabled()` 做轻量判断，避免无效调用。

示例：

```js
const plugin = {
  async executeCommand(commandId, input, ctx) {
    if (await ctx.host.trace.isEnabled()) {
      const span = await ctx.host.trace.startSpan("plugin.step", { commandId });
      const gen = await ctx.host.trace.startGeneration({
        name: "plugin.llm",
        model: "gpt-4o-mini",
        provider: "openai",
        input: { prompt: input.prompt },
      });
      const output = "example output";
      await ctx.host.trace.endGeneration(gen?.generationId || "", output, {
        promptTokens: 120,
        completionTokens: 60,
        totalTokens: 180,
      });
      await ctx.host.trace.endSpan(span?.spanId || "", { status: "ok" });
    }
    return { ok: true };
  },
};
```

### 5. 编写 frontend 入口（如有 route/menu/block/tool）

`frontend/index.mjs` 导出 `register(ctx)` 并返回贡献点：

```js
const plugin = {
  async register() {
    return {
      routes: [
        {
          id: "hello",
          path: "/plugins/hello-plugin/hello",
          title: "Hello Page",
          render: () => "Hello Plugin Loaded",
        },
      ],
    };
  },
};

export default plugin;
```

Doc-Editor 扩展请按 `docs/doc-editor-plugin-development.md` 使用 `ctx.docEditor` SDK。

### 5.1 Web Trace（可选）

前端插件也可通过 `ctx.trace` 写入 Langfuse。该接口与后端 `ctx.host.trace` 方法一致，适用于在前端直接调用模型或需要记录 UI 侧的推理过程。

注意：
- 当前 Web Trace 会独立创建 trace（不绑定聊天/技能的 traceId）。
- 建议仍把模型调用放在后端插件中，以便复用主 trace 与服务端密钥。

示例：

```js
const plugin = {
  async register(ctx) {
    if (await ctx.trace.isEnabled()) {
      const span = await ctx.trace.startSpan("web.step", { action: "click" });
      await ctx.trace.logGeneration({
        name: "web.llm",
        model: "gpt-4o-mini",
        provider: "openai",
        input: { prompt: "..." },
        output: "response",
      });
      await ctx.trace.endSpan(span?.spanId || "", { status: "ok" });
    }
    return { routes: [] };
  },
};
```

### 6. 打包 tgz

在插件目录执行：

```bash
tar -czf ../dist/hello-plugin-0.1.0.tgz manifest.json frontend backend
```

可参考：
- `apps/app-backend/examples/plugins/ppt-plugin/README.md`

### 7. 配置插件商店并安装

在 `apps/app-backend/.env` 配置其一：

```bash
PLUGIN_STORE_CATALOG_FILE=/abs/path/to/catalog.json
# 或
# PLUGIN_STORE_INDEX_URL=https://your-store/catalog.json
```

`catalog.json` 需包含 `pluginId/version/packageUrl/manifest`。

说明（当前实现）：
- `plugins-v2/store-client` 会优先扫描本地目录 `data/plugins/*/*/manifest.json` 生成商店列表。
- 只有当本地目录没有可用插件时，才会回退到 `PLUGIN_STORE_CATALOG_FILE/PLUGIN_STORE_INDEX_URL`。
- 因此本地开发阶段建议把插件放到 `data/plugins/{pluginId}/{version}/`，再用 catalog 做远程/离线分发。

### 8. 验证安装与执行

1) 浏览商店

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:4870/api/plugins/v2/store?q=hello"
```

2) 安装插件

```bash
curl -X POST "http://localhost:4870/api/plugins/v2/me/install" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"pluginId":"hello-plugin","version":"0.1.0"}'
```

3) 查看运行时

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:4870/api/plugins/v2/me/runtime"
```

4) 执行命令（项目作用域）

```bash
curl -X POST \
  "http://localhost:4870/api/projects/personal/me/test/plugin-commands/hello-plugin.say-hello/execute" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"world","__source":"api"}'
```

## 9. 题组 block 最佳实践（Edu 场景）

当你要做“一个题干 + 多个子题”的教育场景时，建议：

- 使用单个 block 承载题组（如 `blockType=edu_question_set`），而不是每题一个独立 block
- attrs 中显式带 `schemaVersion`，并在渲染前做 normalize
- 编辑态与展示态通过 `editor.isEditable` 分支：
  - 编辑态：允许编辑标准答案
  - 展示态：隐藏答案，仅显示题干和题目
- 选择题提前预留 `single/multiple` 两种模式
- 填空题用结构化空位 `blanks[]`，避免把答案编码在纯文本里
- 约束上限（题目数、选项数、空位数），避免 NodeView 过重

## 调试清单

- 报错 `Unsupported pluginApiVersion`：manifest 不是 v2
- 报错 capability 不匹配：`capabilities` 缺少对应项
- 报错 backend/front entry 缺失：检查 `contributes` 与入口文件是否匹配
- 命令冲突：检查 `command.id` 和 `slashAliases`
- 路由冲突：检查 `contributes.routes.path`
