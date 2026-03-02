# LLM 对话三模式统一设计

日期：2026-03-02  
状态：已确认（可进入实施计划）

## 1. 目标

将现有对话能力统一为 3 种模式，并保持交互一致：

1. AI 助手对话页面（已有，保留 `/chat`）。
2. 右侧侧边栏对话页面（替换当前全局底部对话栏）。
3. 弹出框对话页面（新增，可在任意位置唤起，支持文档块位置感知与调用方注入）。

## 2. 已确认决策

1. 会话模型采用“混合模式”：
   - `/chat` 使用完整持久会话池。
   - 右侧栏与弹窗默认使用临时会话。
   - 支持将临时会话一键转存到 `/chat` 持久会话。
2. 弹窗支持由文档块触发并感知当前位置。
3. 本期以最小后端改造优先，优先复用现有 `chat/runs` 能力。

## 3. 方案对比

### 方案 A：单引擎 + 多壳层（采用）

将聊天能力拆为统一核心能力与三种 UI 壳层：

1. 核心：会话与发送流式逻辑（复用并扩展 `useChatLogic`）。
2. 壳层：`ChatPageShell`、`ChatRightDockShell`、`ChatPopupShell`。
3. Runtime：全局 `ChatRuntimeProvider` 管理模式切换与临时会话。

优点：
1. 三模式行为一致，长期维护成本低。
2. 对后续入口扩展（插件、快捷键、块菜单）更友好。

缺点：
1. 首期需要做中等规模重构。

### 方案 B：在 ChatPanel 上做多模式分支

优点：上线快。  
缺点：组件复杂度快速膨胀，后续可维护性差。

### 方案 C：一次性引入全局聊天状态管理重构

优点：状态最清晰。  
缺点：一次改造过大，交付风险高。

结论：采用方案 A。

## 4. 架构设计

## 4.1 Chat Runtime 层

新增 `ChatRuntimeProvider`（挂在 `AppShell` 内部），统一维护：

1. 模式状态：`page | right-dock | popup | hidden`。
2. 右栏状态：展开/折叠、宽度、路由记忆。
3. 弹窗状态：open/source/context/tempSessionId。
4. 临时会话缓存与 TTL。
5. 项目维度会话命名空间。

对外暴露统一接口（示例）：

1. `openRightDock(context?)`
2. `openPopup(context)`
3. `closePopup(options?)`
4. `transferTransientToChat(sessionId)`
5. `gotoChat(sessionId?)`

## 4.2 三个壳层

1. `ChatPageShell`：现有 `/chat`，保留完整会话侧栏与历史管理。
2. `ChatRightDockShell`：替换底部栏，挂在页面右侧内容区。
3. `ChatPopupShell`：全局弹层，支持任意入口唤起。

三者复用统一消息区与输入区子组件，避免重复实现。

## 4.3 现有组件迁移策略

1. 逐步下线 `ChatPanel` 的底部固定布局。
2. 抽离 `ChatPanel`/`ChatPage` 的重复展示逻辑为通用 `ChatConversationView`、`ChatInputBar`。
3. 保留 `useChatLogic` 作为传输核心，新增 `useChatSessionOrchestrator` 处理混合会话策略。

## 5. 上下文注入协议

定义统一 `ChatInvocationContext`，供文档块、页面、插件调用：

1. `source`: `doc-block | doc-page | global | plugin`
2. `projectRef`
3. `document`: `{ docId, title?, blockId?, blockPath?, selectionText? }`
4. `scope`: `{ documentScope?, forceDocScope? }`
5. `prefill`: `{ text?, command? }`
6. `meta`: `{ trigger, timestamp }`

用途：

1. 右侧栏：注入页面级 doc 上下文。
2. 弹窗：注入块级上下文（docId + blockId + 选中文本）。

## 6. 数据流与 API 策略

## 6.1 首期最小改造

复用现有 `POST /chat/runs` 字段：

1. `session_id`
2. `document_scope`
3. `attachments`
4. `deep_search`

块级上下文（source/blockId/selection）首期通过结构化前缀拼接到 message（系统上下文）传入，不强制新增后端字段。

## 6.2 会话策略

1. `/chat`：持久会话（现有 `chat_sessions`）。
2. 右侧栏/弹窗：临时会话（前端内存 + 可选 localStorage TTL 缓存）。
3. 转存：临时会话消息转入新建持久会话，完成后跳转 `/chat` 并激活该会话。

## 7. 交互规格

## 7.1 右侧栏

1. 固定在右侧内容区，不覆盖左侧菜单与文档树。
2. 默认宽度 380px，可拖拽范围 320-520px。
3. 支持折叠与路由记忆。
4. 在 `/chat` 路由自动隐藏，避免双重聊天 UI。

## 7.2 弹窗

1. 支持任意位置唤起。
2. 显示来源与上下文提示（如“当前文档块”）。
3. 关闭默认不清空会话，提供“关闭并清空”动作。
4. 同源（同文档/同块）短时间内可复用最近临时会话。

## 7.3 文档块入口

在 DocEditor `/` 菜单新增 `AI 对话` 入口：

1. 触发后抛出当前 `docId/blockId/selection`。
2. `DocumentPage` 调用 `openPopup(context)` 打开弹窗。

## 8. 错误处理

1. SSE 断开：提示并允许重试，保留已生成内容。
2. 上下文缺失：降级为普通对话并提示。
3. 转存失败：保留临时会话，允许再次转存。
4. 组件卸载：先关闭流连接再卸载，避免悬挂连接。

## 9. 测试策略

## 9.1 单元/集成

1. Runtime 模式切换与状态恢复。
2. 混合会话分流与转存。
3. 弹窗上下文注入与降级逻辑。

## 9.2 Playwright 回归

1. 非 `/chat` 页面展示右侧栏，底部栏不再出现。
2. 文档块触发弹窗并带上下文标签。
3. 右侧栏/弹窗临时会话转存到 `/chat`。
4. 跨项目切换后会话隔离。

## 10. 分阶段实施

1. Phase A：底部栏替换为右侧栏（不改后端）。
2. Phase B：上线弹窗模式与文档块触发。
3. Phase C：完成转存链路、TTL 恢复与完整回归测试。

## 11. 风险与回滚

1. 风险：三模式共享逻辑耦合升高。  
   处置：先做展示层抽离，再接入 Runtime。
2. 风险：文档编辑器入口改动引发回归。  
   处置：只新增入口与回调，不改既有插块路径。
3. 回滚：
   - 保留 `/chat` 不变。
   - 右栏/弹窗由 feature flag 控制可快速关闭。

## 12. 结论

采用“单引擎 + 多壳层 + 混合会话模型”，可在不大幅改造后端的前提下，实现三种对话模式一致化，并满足文档块级上下文感知与后续扩展需求。
