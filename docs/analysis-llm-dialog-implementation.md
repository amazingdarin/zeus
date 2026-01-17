# OpenCode LLM 对话框技术实现分析

## 概述

本文档分析 OpenCode 项目中 LLM 对话框的 Web 版和桌面版的技术实现、技术选型、实现细节和特定优化。

---

## 整体架构

OpenCode 采用 **Sidecar 架构**，核心 LLM 逻辑运行在独立的服务端进程中，Web 和桌面客户端通过 HTTP/SSE 与服务端通信。

```
┌─────────────┐     HTTP/SSE      ┌──────────────────┐
│   Web App   │◄─────────────────►│                  │
│  (SolidJS)  │                   │  OpenCode Server │
└─────────────┘                   │    (Hono)        │
                                  │                  │
┌─────────────┐     HTTP/SSE      │   ┌──────────┐   │
│ Desktop App │◄─────────────────►│   │   LLM    │   │
│  (Tauri)    │                   │   │ Provider │   │
└─────────────┘                   │   └──────────┘   │
                                  └──────────────────┘
```

---

## 技术栈

### 共享组件

| 层级     | 技术           | 说明                       |
| -------- | -------------- | -------------------------- |
| UI 框架  | SolidJS        | 响应式 UI 框架，细粒度更新 |
| 状态管理 | SolidJS Store  | 支持二分查找的高效状态更新 |
| 构建工具 | Vite           | 快速开发体验               |
| 样式     | TailwindCSS v4 | 原子化 CSS                 |
| Markdown | marked + shiki | 代码高亮支持               |
| UI 组件  | @kobalte/core  | 无障碍 UI 原语             |

### Web 版特有

| 技术             | 说明                 |
| ---------------- | -------------------- |
| Browser Fetch    | 标准浏览器 Fetch API |
| localStorage     | 同步本地存储         |
| Notification API | 浏览器通知           |

### 桌面版特有

| 技术                 | 说明                  |
| -------------------- | --------------------- |
| Tauri 2.x            | Rust 原生框架         |
| tauri-plugin-http    | 绕过 CORS 的原生 HTTP |
| tauri-plugin-store   | 异步持久化存储        |
| tauri-plugin-updater | 自动更新              |
| tauri-plugin-dialog  | 原生文件对话框        |

---

## 核心数据模型

### Session（会话）

```typescript
interface Session {
  id: string
  projectID: string
  directory: string
  title: string
  version: number
  createdAt: number
  updatedAt: number
  share?: ShareInfo
  revert?: RevertState
}
```

### Message（消息）

消息采用 discriminated union 设计，区分用户消息和助手消息：

```typescript
type Message = UserMessage | AssistantMessage

interface UserMessage {
  id: string
  role: "user"
  content: string
  attachments?: Attachment[]
}

interface AssistantMessage {
  id: string
  role: "assistant"
  parts: Part[]
  model: string
  cost?: Cost
}
```

### Part（消息部分）

助手消息由多个 Part 组成，支持 12+ 种类型：

| Part 类型      | 说明         |
| -------------- | ------------ |
| TextPart       | 文本内容     |
| ToolPart       | 工具调用结果 |
| ReasoningPart  | 推理过程     |
| FilePart       | 文件引用     |
| StepStartPart  | 步骤开始标记 |
| StepFinishPart | 步骤结束标记 |
| PatchPart      | 代码补丁     |

---

## 服务端实现

### HTTP 服务器（Hono）

服务端使用 Hono 框架，提供 RESTful API：

```typescript
// packages/opencode/src/server/server.ts
const app = new Hono()

// Session CRUD
app.get("/session", listSessions)
app.post("/session", createSession)
app.get("/session/:id", getSession)
app.delete("/session/:id", deleteSession)

// Message 操作
app.get("/session/:id/message", getMessages)
app.post("/session/:id/message", sendMessage)

// 实时事件
app.get("/event", sseHandler)
app.get("/global/event", globalSseHandler)
```

### SSE 事件流

实时更新通过 Server-Sent Events 推送：

```typescript
// 事件类型
type Event =
  | { type: "session.created"; properties: Session }
  | { type: "session.status"; properties: SessionStatus }
  | { type: "message.created"; properties: Message }
  | { type: "message.part.updated"; properties: { part: Part } }
  | { type: "permission.requested"; properties: Permission }
```

---

## Web 版实现

### 状态管理层级

```
GlobalSDK        →  SDK 客户端实例
    ↓
GlobalSync       →  全局数据同步（跨目录）
    ↓
Sync             →  目录级别数据同步
    ↓
Layout/Prompt    →  UI 状态（侧边栏、标签页、输入）
```

### 事件合并优化

高频事件被合并以防止 UI 卡顿：

```typescript
// packages/app/src/context/global-sdk.tsx
const key = (directory: string, payload: Event) => {
  if (payload.type === "session.status") return `session.status:${directory}:${payload.properties.sessionID}`
  if (payload.type === "message.part.updated") {
    const part = payload.properties.part
    return `message.part.updated:${directory}:${part.messageID}:${part.id}`
  }
}

// 16ms 间隔合并，约 60fps
const schedule = () => {
  if (timer) return
  const elapsed = Date.now() - last
  timer = setTimeout(flush, Math.max(0, 16 - elapsed))
}
```

### 消息列表二分查找

消息按时间排序，使用二分查找高效插入：

```typescript
// packages/app/src/context/global-sync.tsx
const insertSorted = (arr: Message[], item: Message) => {
  let low = 0
  let high = arr.length

  while (low < high) {
    const mid = (low + high) >>> 1
    if (arr[mid].createdAt < item.createdAt) low = mid + 1
    else high = mid
  }

  arr.splice(low, 0, item)
}
```

### 流式文本节流

流式文本更新限制为 100ms 间隔：

```typescript
// packages/ui/src/components/message-part.tsx
const [text, setText] = createSignal("")
const throttledText = throttle(setText, 100)

createEffect(() => {
  if (props.streaming) throttledText(props.content)
  else setText(props.content)
})
```

### Markdown 缓存

使用 LRU 缓存避免重复解析：

```typescript
// packages/ui/src/components/markdown.tsx
const cache = new LRUCache<string, string>({ max: 200 })

const parse = (content: string) => {
  const cached = cache.get(content)
  if (cached) return cached

  const html = marked.parse(content)
  cache.set(content, html)
  return html
}
```

### 自动滚动检测

智能检测用户是否手动滚动：

```typescript
// packages/ui/src/hooks/create-auto-scroll.tsx
const createAutoScroll = (options: Options) => {
  let userScrolled = false
  let lastScrollTop = 0

  const onScroll = (e: Event) => {
    const el = e.target as HTMLElement
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100

    // 用户向上滚动时禁用自动滚动
    if (el.scrollTop < lastScrollTop && !isNearBottom) {
      userScrolled = true
    }

    // 用户滚动到底部时重新启用
    if (isNearBottom) {
      userScrolled = false
    }

    lastScrollTop = el.scrollTop
  }

  const scrollToBottom = () => {
    if (!userScrolled) {
      el.scrollTop = el.scrollHeight
    }
  }

  return { onScroll, scrollToBottom }
}
```

### 增量渲染

使用 `requestIdleCallback` 分批渲染历史对话：

```typescript
// packages/app/src/pages/session.tsx
const backfillTurns = (turns: Turn[]) => {
  let index = 0

  const process = (deadline: IdleDeadline) => {
    while (index < turns.length && deadline.timeRemaining() > 0) {
      renderTurn(turns[index])
      index++
    }

    if (index < turns.length) {
      requestIdleCallback(process)
    }
  }

  requestIdleCallback(process)
}
```

---

## 桌面版实现

### Platform 抽象

通过 Platform 接口实现跨平台：

```typescript
// packages/app/src/context/platform.tsx
type Platform = {
  platform: "web" | "desktop"
  os?: "macos" | "windows" | "linux"

  openLink(url: string): void
  restart(): Promise<void>
  notify(title: string, description?: string): Promise<void>
  openDirectoryPickerDialog?(): Promise<string | null>
  storage?: (name?: string) => SyncStorage | AsyncStorage
  fetch?: typeof fetch
}
```

### Sidecar 进程管理

桌面版启动独立的服务端进程：

```rust
// packages/desktop/src-tauri/src/lib.rs
fn spawn_sidecar(app: &AppHandle, port: u32, password: &str) -> CommandChild {
    let (mut rx, child) = cli::create_command(app, format!("serve --port {port}"))
        .env("OPENCODE_SERVER_PASSWORD", password)
        .spawn()
        .expect("Failed to spawn opencode")

    // 异步读取日志
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => print!("{}", String::from_utf8_lossy(&line)),
                CommandEvent::Stderr(line) => eprint!("{}", String::from_utf8_lossy(&line)),
                _ => {}
            }
        }
    })

    child
}
```

### 原生 HTTP 请求

使用 Tauri HTTP 插件绕过 CORS：

```typescript
// packages/desktop/src/index.tsx
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"

const createPlatform = (password: Accessor<string | null>): Platform => ({
  fetch: (input, init) => {
    const pw = password()
    const headers = new Headers(init?.headers)

    if (pw) {
      headers.append("Authorization", `Basic ${btoa(`opencode:${pw}`)}`)
    }

    return tauriFetch(input, { ...init, headers })
  },
})
```

### 存储写入防抖

桌面存储写入进行 250ms 防抖：

```typescript
// packages/desktop/src/index.tsx
const WRITE_DEBOUNCE_MS = 250

const createStorage = (name: string) => {
  let timer: number | undefined
  const pending = new Map<string, string>()

  const flush = async () => {
    const store = await getStore(name)
    for (const [key, value] of pending) {
      await store.set(key, value)
    }
    pending.clear()
    await store.save()
  }

  return {
    setItem: async (key: string, value: string) => {
      pending.set(key, value)

      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, WRITE_DEBOUNCE_MS)
    },
  }
}
```

### Windows 进程清理

使用 Job Object 确保子进程随主进程退出：

```rust
// packages/desktop/src-tauri/src/job_object.rs
pub struct JobObject(HANDLE)

impl JobObject {
    pub fn new() -> Result<Self> {
        unsafe {
            let job = CreateJobObjectW(None, None)?
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default()
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info)?
            Ok(Self(job))
        }
    }

    pub fn assign_pid(&self, pid: u32) -> Result<()> {
        unsafe {
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)?
            AssignProcessToJobObject(self.0, process)?
            Ok(())
        }
    }
}
```

### 单实例检测

防止多个实例同时运行：

```rust
// packages/desktop/src-tauri/src/lib.rs
.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus()
        let _ = window.unminimize()
    }
}))
```

### 标题栏适配

根据操作系统调整标题栏：

```typescript
// packages/app/src/components/titlebar.tsx
const Titlebar = () => {
  const platform = usePlatform()
  const mac = () => platform.platform === "desktop" && platform.os === "macos"
  const reserve = () => platform.platform === "desktop" &&
    (platform.os === "windows" || platform.os === "linux")

  return (
    <header class="h-10 bg-background-base flex items-center">
      <Show when={mac()}>
        {/* macOS 红绿灯按钮空间 */}
        <div class="w-[72px] shrink-0" data-tauri-drag-region />
      </Show>

      {/* 内容区域 */}

      <Show when={reserve()}>
        {/* Windows/Linux 窗口按钮空间 */}
        <div class="w-[120px] shrink-0" data-tauri-drag-region />
      </Show>
    </header>
  )
}
```

---

## 性能优化总结

| 优化项        | Web 版 | 桌面版 | 说明                   |
| ------------- | ------ | ------ | ---------------------- |
| 事件合并      | ✅     | ✅     | 16ms 间隔，~60fps      |
| 文本节流      | ✅     | ✅     | 流式文本 100ms 间隔    |
| Markdown 缓存 | ✅     | ✅     | LRU 缓存 200 条        |
| 二分查找      | ✅     | ✅     | 消息列表高效插入       |
| 增量渲染      | ✅     | ✅     | requestIdleCallback    |
| 存储防抖      | ❌     | ✅     | 250ms 防抖写入         |
| 会话预取      | ✅     | ✅     | 预加载会话消息         |
| 会话裁剪      | ✅     | ✅     | 最多保留 50 个会话状态 |

---

## 关键文件参考

### Web 版

| 文件                                           | 说明                     |
| ---------------------------------------------- | ------------------------ |
| `packages/app/src/pages/session.tsx`           | 主会话页面（~1715 行）   |
| `packages/app/src/context/global-sdk.tsx`      | SDK 客户端和事件流       |
| `packages/app/src/context/global-sync.tsx`     | 全局数据同步（~595 行）  |
| `packages/app/src/context/sync.tsx`            | 目录级数据同步           |
| `packages/app/src/components/prompt-input.tsx` | 富文本输入框             |
| `packages/ui/src/components/session-turn.tsx`  | 对话轮次渲染（~696 行）  |
| `packages/ui/src/components/message-part.tsx`  | 消息部分渲染（~1360 行） |
| `packages/ui/src/components/markdown.tsx`      | Markdown 渲染            |
| `packages/ui/src/hooks/create-auto-scroll.tsx` | 自动滚动 Hook            |

### 桌面版

| 文件                                           | 说明                     |
| ---------------------------------------------- | ------------------------ |
| `packages/desktop/src/index.tsx`               | 入口文件和 Platform 实现 |
| `packages/desktop/src-tauri/src/lib.rs`        | Rust 主模块              |
| `packages/desktop/src-tauri/src/cli.rs`        | CLI 启动和安装           |
| `packages/desktop/src-tauri/src/job_object.rs` | Windows 进程管理         |
| `packages/desktop/src-tauri/tauri.conf.json`   | Tauri 配置               |

### 服务端

| 文件                                          | 说明                    |
| --------------------------------------------- | ----------------------- |
| `packages/opencode/src/server/server.ts`      | HTTP 服务器（~2900 行） |
| `packages/opencode/src/session/index.ts`      | Session 管理            |
| `packages/opencode/src/session/message-v2.ts` | 消息数据模型            |
| `packages/opencode/src/session/processor.ts`  | LLM 流处理              |
| `packages/opencode/src/bus/index.ts`          | 事件总线                |

### SDK

| 文件                                   | 说明                  |
| -------------------------------------- | --------------------- |
| `packages/sdk/js/src/gen/types.gen.ts` | 自动生成的类型定义    |
| `packages/sdk/js/src/gen/sdk.gen.ts`   | 自动生成的 SDK 客户端 |
| `packages/sdk/js/src/client.ts`        | 客户端工厂函数        |

---

## 总结

OpenCode 的 LLM 对话框实现展示了现代混合架构的最佳实践：

1. **Sidecar 架构** - 将重计算（LLM 通信、文件操作）放在独立进程
2. **Platform 抽象** - 同一套 SolidJS 代码运行在 Web 和桌面
3. **细粒度优化** - 事件合并、文本节流、缓存等多层优化
4. **原生集成** - 桌面版充分利用 Tauri 插件生态
5. **跨平台适配** - 针对 macOS、Windows、Linux 的特定处理

这种架构既保证了代码复用，又能针对不同平台进行深度优化，是构建跨平台 AI 应用的优秀参考。
