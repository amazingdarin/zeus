# 文档导出 Word（.docx）功能设计

## 1. 背景与目标

当前文档导出已支持：
- Markdown（`.md`）
- Zeus 原生文档（`.zeus.json`）

本设计新增：
- Word 文档导出（`.docx`）

已确认范围：
- 导出范围：仅当前文档（不包含子文档合并）
- 保真级别：常用高保真（标题/段落/列表/表格/代码块/图片）
- 交互入口：复用现有“导出文档”弹窗，增加 Word 格式选项

## 2. 设计原则

- **稳定优先**：由后端统一生成 docx，前端仅发起导出与下载
- **可读优先**：保证语义结构高保真，不追求像素级视觉一致
- **渐进增强**：对复杂/未知节点做降级输出，不因单点失败中断导出
- **易扩展**：为后续模板化（页眉页脚、企业样式）预留扩展位

## 3. 方案选择

### 3.1 备选方案

1. 前端生成 docx  
2. 后端生成 docx（选中）  
3. HTML 中转 + 外部工具（pandoc/libreoffice）

### 3.2 选型结论

选择方案 2：后端生成 docx。

原因：
- 避免前端包体继续膨胀
- 图片拉取、鉴权与资源访问在后端更可控
- 内容映射逻辑集中，便于测试与迭代
- 不依赖系统级二进制，部署/运维成本低

## 4. 整体架构

### 4.1 前端（apps/web）

- `DocumentPage` 导出弹窗新增 `Word (.docx)` 选项
- 用户点击导出后调用新 API
- 收到 blob 后触发下载，文件名基于文档标题

### 4.2 后端（apps/app-backend）

新增导出接口：
- `POST /api/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/export-docx`

导出流程：
1. 权限校验（复用 project scope）
2. 读取文档（当前文档）
3. 将 Tiptap JSON 映射为 docx 结构
4. 生成二进制并返回下载响应

## 5. 数据流与接口设计

### 5.1 API

- Method: `POST`
- Path: `/api/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/export-docx`
- Request body: 第一版为空（后续可扩展 options）

### 5.2 成功响应

- `200 OK`
- Header:
  - `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  - `Content-Disposition: attachment; filename="<safe-title>.docx"`
- Body: docx 二进制

### 5.3 失败响应

- `403` 无访问权限
- `404` 文档不存在
- `422` 文档为空/不可导出
- `500` 导出过程异常

返回结构遵循现有错误响应规范（`code + message`）。

## 6. 内容映射策略（高保真）

### 6.1 块级节点

- `heading(1-6)` -> Word Heading 1-6
- `paragraph` -> 普通段落
- `bulletList/orderedList/listItem` -> 无序/有序列表（保留嵌套层级）
- `table/tableRow/tableCell/tableHeader` -> Word 表格
- `codeBlock` -> 等宽字体 + 背景/边框样式（语言作为辅助文本）
- `blockquote` -> 缩进 + 左边框样式
- `horizontalRule` -> 分隔线段落

### 6.2 行内样式

- `bold/italic/underline/strike/code` -> 对应 run 样式
- `link` -> 超链接
- 文本色/高亮（若存在）-> 尽可能映射到 run 样式

### 6.3 图片

- 对 `image/imageUpload`：
  - 优先拉取并嵌入二进制
  - 失败时降级为占位文本（含 URL）
- 尺寸按页面宽度约束缩放，避免溢出

### 6.4 不支持节点降级

- 不支持节点不抛致命错误
- 输出“可读占位块”（节点名 + 文本摘要/简化结构）
- 记录 `unsupported_node_types` 日志用于后续补齐

## 7. 关键实现点

### 7.1 前端改动（apps/web）

- `DocumentPage`：
  - `ExportFormat` 增加 `"word"`
  - `handleExportSubmit` 增加 Word 分支
  - 下载方式：`apiFetch -> blob -> a.download`

- 新增或扩展 API 客户端（建议）：
  - `apps/web/src/api/documents.ts` 增加 `exportDocumentDocx(...)`
  - 避免页面组件中直接拼装请求细节

### 7.2 后端改动（apps/app-backend）

- `router.ts` 注册新路由
- 新增服务模块（建议路径）：
  - `src/services/export-docx.ts`
  - `src/services/export-docx-mapper.ts`
  - `src/services/export-docx-styles.ts`

职责拆分：
- `export-docx.ts`: orchestration（读文档、调用 mapper、打包输出）
- `mapper`: Tiptap -> docx 节点转换
- `styles`: 标题/代码块/引用等样式定义集中管理

## 8. 错误处理与稳定性

- 节点级容错：单个节点映射失败不影响整体导出
- 图片级容错：资源拉取失败降级文本
- 超时保护：导出任务设置合理超时（建议 15~30 秒）
- 日志字段：
  - `projectKey`
  - `docId`
  - `durationMs`
  - `unsupportedNodeTypes`
  - `imageFetchFailedCount`

## 9. 测试设计

### 9.1 单元测试（服务层）

- 覆盖 heading/paragraph/list/table/codeBlock/image
- 覆盖 unsupported node 降级
- 覆盖空文档与异常路径

### 9.2 路由测试

- 权限失败（403）
- 文档不存在（404）
- 成功返回二进制 + header 正确
- 异常场景返回规范错误码

### 9.3 前端测试

- 导出弹窗出现 Word 选项
- 选择 Word 后调用正确 API 分支
- 下载文件名后缀为 `.docx`

### 9.4 手工验收样例

- 含标题、列表、表格、代码块、图片、引用块的真实文档
- 在 Word 客户端打开后：
  - 层级清晰
  - 样式可读
  - 图片可见
  - 无明显结构错乱

## 10. 非目标（第一版不做）

- 多文档合并导出
- 批量导出 zip
- 模板化品牌样式（页眉页脚、水印、企业封面）
- 对复杂插件块做 1:1 视觉复刻

## 11. 验收标准

- 导出弹窗可选择 Word 格式
- 可稳定下载 `.docx` 文件
- 常用结构（标题/段落/列表/表格/代码块/图片）在 Word 中可读
- 导出失败时前端有明确错误提示，不出现页面卡死或闪烁

