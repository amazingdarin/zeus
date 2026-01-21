# DocEditor 组件化 TODO

- [x] 添加 workspace 根 `package.json`（npm workspaces）
- [x] 创建 `packages/doc-editor` 包结构与 `package.json`
- [x] 创建 `packages/doc-editor-openapi` 包结构与 `package.json`（已合并至 doc-editor）
- [x] 迁移 `frontend/src/components/DocEditor/**` 到 `packages/doc-editor/src/**`
- [x] 移除所有 `DocEditor/*` alias 引用，改为相对路径
- [x] `SimpleEditor` 重命名为 `DocEditor`，新增 `DocViewer`（无 toolbar）
- [x] 提供 `useDocEditor` hook（基于现有 `useTiptapEditor`）
- [x] 默认工具栏保留原按钮，移除 `ThemeToggle`
- [x] 新增 `styles/index.scss` 并汇总 DocEditor 样式入口
- [x] OpenAPI node/viewer 迁移至 `@zeus/doc-editor`
- [x] OpenAPI `source_type: url/json/yaml` 支持与统一解析逻辑
- [x] OpenAPI viewer 内部错误提示（加载/解析/网络失败）
- [x] OpenAPI 插件支持 `fetcher` 选项（默认 `window.fetch`）
- [x] 添加 SSR guard（window/document/matchMedia/visualViewport）
- [x] `frontend` 改为 workspace 依赖新包（`@zeus/doc-editor`）
- [x] `frontend` 替换 `RichTextEditor` → `DocEditor`、`RichTextViewer` → `DocViewer`
- [x] `frontend` 改为引入 `@zeus/doc-editor/styles`
- [ ] 验证页面：NewDocumentPage、DocumentPage、DocumentViewer 中编辑/展示模式（需手动运行确认）
