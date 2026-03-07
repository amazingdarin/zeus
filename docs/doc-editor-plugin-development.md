# Zeus Doc-Editor 第三方插件开发说明（v2）

本文描述 Zeus 的 doc-editor 插件开发与加载模式。目标是支持第三方团队独立开发 block/tool 插件，并通过插件市场按用户启停后动态加载。

## 1. 关键原则

- doc-editor 插件必须作为独立插件包发布，不再依赖宿主硬编码开关。
- 插件启用后才加载其前端入口（`frontend.entry`），未启用不加载。
- 前端入口应是可直接在浏览器 `import()` 的 ESM。
- 插件运行通过 `register(ctx)` 接收宿主 `docEditor SDK`，避免直接依赖宿主源码路径。

## 2. 插件包目录约定

```text
{pluginId}/{version}/
  manifest.json
  frontend/
    index.mjs
  backend/
    index.mjs          # 可选
  assets/              # 可选
```

对于纯 doc-editor block 插件，最小要求：

- `manifest.json`
- `frontend/index.mjs`

## 3. Manifest 最小示例（doc-editor block）

```json
{
  "id": "music-plugin",
  "version": "0.1.0",
  "displayName": "Music Plugin",
  "pluginApiVersion": 2,
  "engines": {
    "zeusAppBackend": ">=0.1.0",
    "zeusWeb": ">=0.1.0"
  },
  "capabilities": ["docs.block.register"],
  "activation": {
    "commands": [],
    "routes": [],
    "tools": [],
    "documentEvents": []
  },
  "frontend": {
    "entry": "frontend/index.mjs"
  },
  "contributes": {
    "blocks": [
      {
        "blockType": "music"
      }
    ]
  }
}
```

说明：

- 当声明 `contributes.blocks` 时，必须提供 `frontend.entry`。
- `frontend.entry` 会由 app-backend 通过 `/api/plugins/v2/assets/...` 托管并动态加载。

## 4. WebPluginContext.docEditor SDK

前端插件 `register(ctx)` 可以使用 `ctx.docEditor`：

- `ctx.docEditor.builtins.list()`：查看宿主提供的内置模块名。
- `ctx.docEditor.loadBuiltinModule(name)`：按需加载宿主内置模块。
- `ctx.docEditor.resolveAssetUrl(path)`：将相对资源路径解析为插件资产 URL。
- `ctx.docEditor.loadStyle(path)`：按需加载插件 CSS（自动去重）。
- `ctx.docEditor.react`：React 桥接（`createElement`、`Fragment`）。
- `ctx.docEditor.tiptap`：Tiptap 桥接（Node/Mark/Extension/InputRule/mergeAttributes/ReactNodeViewRenderer）。

## 5. music-plugin 示例

`frontend/index.mjs` 示例：

```js
const plugin = {
  async register(ctx) {
    const sdk = ctx && ctx.docEditor ? ctx.docEditor : null;
    if (!sdk) return {};

    const builtin = await sdk.loadBuiltinModule("music");
    const createMusicBlockContribution = builtin.createMusicBlockContribution;
    if (typeof createMusicBlockContribution !== "function") return {};

    return {
      blocks: [createMusicBlockContribution(sdk.react.createElement)],
    };
  },
};

export default plugin;
```

## 6. 发布与加载流程

1. 第三方打包 `manifest.json + frontend/index.mjs(+assets)`。
2. 包上传到商店或放到本地 `data/plugins/{pluginId}/{version}`。
3. 用户在“插件市场”安装并启用。
4. 前端启动时拉取 `/api/plugins/v2/me/runtime`，对启用插件执行动态 `import(frontendEntryUrl)`。
5. `register(ctx)` 返回 `blocks/menus/routes/docTools` 后注入运行时注册中心。

## 7. 对第三方开发者的建议

- 避免在插件入口中写裸模块依赖（如直接 `import "@zeus/doc-editor"`），优先用 `ctx.docEditor` 获取宿主能力。
- 如需样式文件，放在插件包内并通过 `ctx.docEditor.loadStyle("assets/xxx.css")` 加载。
- 为命令、路由、blockType 使用命名空间前缀，降低冲突概率。
