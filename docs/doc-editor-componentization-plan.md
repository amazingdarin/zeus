# DocEditor 组件化方案

## 背景与目标

当前 DocEditor 位于前端工程内部，强依赖本地路径别名与业务实现（OpenAPI、API 封装、全局样式）。本次改造目标是将 DocEditor 拆分为 monorepo 内可复用的组件库，并满足以下要求：

- npm workspaces 管理，多包复用
- DocEditor 开箱即用，默认保留完整工具栏（移除 ThemeToggle）
- 读写模式统一为 DocEditor，通过 `mode="edit" | "view"` 切换
- 提供 `DocViewer` 轻量包装（无工具栏）
- 提供 `useDocEditor` hook，便于调用方保存/复制等操作
- OpenAPI 功能拆为可选插件，并支持 `url/json/yaml` 三种输入方式
- OpenAPI 解析/加载错误在 Viewer 内部展示友好提示，不向外抛回调
- 显式样式导入，不自动注入
- 支持 SSR（所有 window/document 访问做安全保护）

## 组件边界与包结构

### 根目录（workspace）

- 根目录仅保留后端代码与 workspace 定义
  - `workspaces: ["frontend"]`

### 组件库包

- `packages/doc-editor`（核心包）
  - 对外暴露 `DocEditor`、`DocViewer`、`useDocEditor`、基础 primitives/hooks/utils/extensions
  - 样式入口：`@zeus/doc-editor/styles`

### OpenAPI 功能

- OpenAPI nodes/extensions + viewer 合并进 `packages/doc-editor`
  - 对外入口：`@zeus/doc-editor`
  - 支持 `source_type: "url" | "json" | "yaml"`
  - 支持 `fetcher` 自定义请求（默认 `window.fetch`）

## 对外 API 设计

### Core

```ts
export type DocEditorMode = "edit" | "view"

export type DocEditorProps = {
  mode?: DocEditorMode
  content?: JSONContent | null
  onChange?: (content: JSONContent) => void
  extensions?: Extension[]
  toolbar?: ReactNode | false
  onReady?: (editor: Editor) => void
}

export function DocEditor(props: DocEditorProps): JSX.Element
export function DocViewer(props: Omit<DocEditorProps, "mode">): JSX.Element

export function useDocEditor(): {
  editor: Editor | null
  editorState?: Editor["state"]
  canCommand?: Editor["can"]
}
```

### OpenAPI 插件

```ts
export type OpenApiSourceType = "url" | "json" | "yaml"

export type OpenApiNodeAttrs = {
  source_type: OpenApiSourceType
  source: string
  renderer?: "swagger" | "redoc" | string
}

export type OpenApiPluginOptions = {
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>
}

export function OpenApiPlugin(options?: OpenApiPluginOptions): Extension[]
```

## 样式策略

- 将 `DocEditor/styles/_variables.scss` 与 `_keyframe-animations.scss` 作为核心样式入口
- 在 `packages/doc-editor/src/styles/index.scss` 汇总所有组件样式
- 使用方显式引入：

```ts
import "@zeus/doc-editor/styles"
```

## SSR 兼容策略

- 所有 `window`/`document` 访问添加 guard
- `DocEditor` 文件保留 `"use client"`
- OpenAPI viewer 使用 `lazy + Suspense`

## 迁移影响点

- `apps/web` 侧的 `DocEditor` 相关 alias 移除
- `RichTextEditor` → `DocEditor`，`RichTextViewer` → `DocViewer`
- 样式引用由 `App.css` 内部路径改为 `@zeus/doc-editor/styles`
- OpenAPI 相关逻辑迁移后通过插件引入
- 前端代码全部归拢至 `apps/web`，自研组件归拢至 `packages`

## 风险与注意事项

- 需要清理 `DocEditor/*` alias 与路径引用
- OpenAPI 的旧 `projectKey + storage://` 逻辑需改为 `url/json/yaml` 统一输入
- SSR 下组件中存在 `matchMedia`/`visualViewport` 调用，需加保护
