# Zeus Slash Command & Chat Input 规范

> 用途：
> - 作为 Zeus 前端 LLM 对话框（ChatDock）的统一交互规范
> - 作为 Codex 自动编码的硬性约束
> - 约束 Slash Command / Prompt / MCP Tool 的语义边界

---

## 1. 设计目标（Design Goals）

Zeus 的对话框不是普通聊天窗口，而是一个统一的系统控制台（Conversational Console），需要同时支持：

- 自然语言对话（LLM）
- 显式系统操作（MCP Tool）
- 输入辅助与引用（文档 / 仓库 / Diff）
- Prompt 上下文约束（改变本次对话的工作模式）

本规范用于防止 Slash Command 语义混乱，确保：

- Codex 不会误用命令类型
- 前端状态机清晰、可扩展
- LLM 永远不会越权修改系统状态

---

## 2. 核心结论（必须遵守）

Slash Command 分为三类，且语义严格不同：

| 类型 | 本质 |
|---|---|
| 输入框响应型（Input-Responsive） | 辅助输入，生成 Token |
| Prompt 选择型（Prompt-Context） | 设置本次对话的上下文状态 |
| 操作型（Operation） | 执行系统行为 |

注意：

- Prompt 型不是操作型
- Prompt 不是一条消息
- Prompt 是输入状态的一部分

---

## 3. Slash Command 类型规范

### 3.1 输入框响应型 Slash Command（Input-Responsive）

#### 定位

仅用于增强输入体验，不执行任何系统操作，不产生对话消息。

#### 语法

```
/in:<namespace>.<action>:
```

- 必须以 `:` 结尾
- 进入特殊输入模式（Sub Input Mode）

#### 行为特征

| 维度 | 规则 |
|---|---|
| 是否实时响应 | 是 |
| 是否需要 Enter | 否 |
| 是否调用 MCP Tool | 否（仅用于搜索 / suggest） |
| 是否产生对话消息 | 否 |
| 作用范围 | 当前输入框 |

#### 示例

```
/in:docs.search: 研发文档
```

行为流程：

1. 输入框进入输入子模式
2. 实时搜索文档
3. 下拉展示候选项
4. 用户选择后回填：
   ```
   {{doc:docID}}
   ```
5. 返回 normal 输入模式

---

### 3.2 Prompt 选择型 Slash Command（Prompt-Context）

#### 核心定义（非常重要）

Prompt 是本次对话的工作模式 / 上下文约束，而不是命令。

作用：

- 改变发送给 LLM 的 Prompt 结构
- 与用户输入文本组合
- 不直接执行任何操作

#### 语法

```
/p:<prompt_key>
```

- 不需要 `:` 结尾
- 选择后立即生效（状态层面）
- 不需要 Enter

#### 行为特征

| 维度 | 规则 |
|---|---|
| 是否实时生效 | 是 |
| 是否进入 LLM | 否（直到用户发送） |
| 是否产生对话消息 | 否 |
| 是否可编辑 | 是 |
| 是否可撤销 | 是 |

#### UI 表现（强制建议）

选择 Prompt 后，必须在输入框上方显示 Prompt 缩略（Chip）：

```
[📌 KB Refactor Prompt  ✕ ]
```

- Prompt Chip 表示当前对话状态
- 用户可随时移除（✕）

#### Prompt 的系统模型

```ts
type ActivePrompt = {
  key: string;
  title: string;
  template: string;
};
```

Prompt 不属于输入文本，而是 InputState 的一部分。

#### 发送给 LLM 的组合规则（必须遵守）

最终 Prompt 构造顺序：

1. System Prompt
2. Active Prompt（如存在）
3. Conversation Context
4. User Input

Prompt 模板不得直接插入 rawText。

---

### 3.3 操作型 Slash Command（Operation）

#### 定位

显式执行系统行为的命令。

#### 语法

```
/op:<namespace>.<action>
```

- 不以 `:` 结尾
- 必须通过 Enter 或确认执行

#### 行为特征

| 维度 | 规则 |
|---|---|
| 是否需要 Enter | 是 |
| 是否调用 MCP Tool | 是 |
| 是否产生对话消息 | 是 |
| 是否可撤销 | 取决于操作 |
| 风险等级 | 中 / 高 |

#### 示例

```
/op:docs.list
```

行为：

1. 用户按 Enter
2. 后端调用 MCP Tool
3. 返回结构化 ChatMessage（列表 / 数量等）

---

## 4. 三类 Slash Command 对比表（速查）

| 维度 | 输入框响应型 | Prompt 选择型 | 操作型 |
|---|---|---|---|
| 是否实时 | 是 | 是 | 否 |
| 是否 Enter | 否 | 否 | 是 |
| 是否调用 Tool | 否 | 否 | 是 |
| 是否影响输入 | 回填 Token | 改变上下文 | 否 |
| 是否产生消息 | 否 | 否 | 是 |

---

## 5. useReducer 输入状态机约束（必须遵守）

### 5.1 InputState 必须包含

```ts
interface InputState {
  rawText: string;
  caret: number;
  mode: InputMode;
  activePrompt?: ActivePrompt;
}
```

### 5.2 Prompt 相关 Action 规范

```ts
| { type: "SELECT_PROMPT"; prompt: ActivePrompt }
| { type: "REMOVE_PROMPT" }
```

- SELECT_PROMPT：设置 activePrompt
- REMOVE_PROMPT：移除 Prompt
- 不得修改 rawText

---

## 6. Codex 编码硬性约束（必须写进 Prompt）

```
注意：
Zeus 的 Slash Command 分为三类：

1. 输入框响应型（/in:*:）
   - 仅用于输入辅助
   - 不产生对话消息
   - 不执行系统操作

2. Prompt 选择型（/p:*）
   - 设置对话上下文状态
   - 显示 Prompt Chip
   - 与用户输入组合发送给 LLM

3. 操作型（/op:*）
   - 必须 Enter 执行
   - 调用 MCP Tool
   - 返回 ChatMessage

禁止混用三种行为模型。
```

---

## 7. 设计哲学（给未来维护者）

Slash Command 不是功能，而是输入层协议：

- /in: 解决“怎么输入”
- /p: 决定“以什么方式思考”
- /op: 执行“系统能做的事”

协议清晰，Codex 不会写错，LLM 不会越权，UI 不会失控。
