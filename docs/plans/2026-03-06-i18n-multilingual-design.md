# Zeus 国际化多语言界面设计

## 背景

Zeus 当前由 `apps/web`、`apps/desktop`、`apps/app-backend`、`server` 四层构成，界面文案、后端错误消息、设置提示、登录注册提示等主要以中文硬编码散落在前后端代码中。现在需要把产品升级为可扩展的国际化体系，首批上线 `zh-CN` 与 `en`，同时满足以下约束：

- 未登录时使用本地语言偏好。
- 登录后使用账号级语言配置，并跨 Web / Desktop 生效。
- 前端与后端都要支持多语言。
- 后端响应采用 `code + localized message` 双轨返回。
- 翻译资源先保存在仓库中，后续预留接入翻译平台的能力。

## 目标

- 建立覆盖 `apps/web`、`apps/app-backend`、`server` 的统一国际化协议。
- 首批上线 `zh-CN` 与 `en`，并保证新功能继续沿用统一方案。
- 将语言偏好纳入账号级配置，未登录保留本地 fallback。
- 为后续扩展 `zh-TW` 或更多语言保留稳定的数据结构与资源流水线。

## 非目标

- 本轮不处理业务内容本身的自动翻译，例如用户创建的文档正文、评论正文、聊天消息正文。
- 本轮不接入第三方翻译平台，只预留扩展点。
- 本轮不一次性清理所有历史硬编码文案，采用增量迁移。

## 选型结论

### 推荐方案

采用分层实现、统一协议的组合方案：

- 前端 `apps/web` / `apps/desktop`：`i18next + react-i18next + i18next-icu`
- TS 后端 `apps/app-backend`：`i18next + i18next-fs-backend + i18next-icu`
- Go 后端 `server`：`go-i18n`

### 不采用单一全栈库的原因

前端、Node、Go 不存在一个成熟且在三个运行时里都同样强势的国际化库。强行统一运行时库会让 Go 侧落入非主流实现，增加维护风险。更稳妥的做法是：

- 统一语言代码
- 统一 message key
- 统一参数命名与插值规范
- 统一请求头与响应协议
- 统一翻译资源源文件与生成流程

这样既保留各层生态最佳实践，又保证跨层一致性。

## 成熟开源库对比

### 方案 1：i18next + go-i18n（推荐）

优点：

- React 生态最成熟，适合现有 `apps/web`。
- Node 端复用成本低，适合 `apps/app-backend`。
- 支持命名空间、懒加载、语言检测、ICU message。
- `go-i18n` 是 Go 侧成熟主流方案。

缺点：

- Go 与 TS 不是同一个运行时库，需要资源生成与格式对齐。

### 方案 2：FormatJS / react-intl + go-i18n

优点：

- ICU message 规范成熟，适合复杂格式化。

缺点：

- 与当前项目的 Node/React 多层整合不如 `i18next` 灵活。
- 前端按页面懒加载、命名空间组织和生态配套略弱。

### 方案 3：Lingui + 各后端自行实现

优点：

- 前端开发体验不错，提取文案体验较好。

缺点：

- 更偏前端方案，不适合当前前后端统一改造目标。

## 类似 Codex 的做法参考

OpenAI 没有公开 Codex 的具体国际化实现细节，因此这里不能把内部技术细节当作事实陈述。根据 OpenAI 公开产品行为，可以合理推断其模式是：

- 首次优先使用浏览器或系统语言。
- 登录后支持账号级语言偏好。
- 多端共享语言选择规则，而不是每个端各自定义协议。

这与 Zeus 当前的多层结构高度一致，因此本设计沿用同样的原则：账号级语言配置 + 本地 fallback + 各端共享统一协议。

## 总体架构

### 1. 语言优先级

语言决策链路：

1. 显式请求头 `X-Zeus-Locale`
2. 标准请求头 `Accept-Language`
3. 已登录用户账号语言配置
4. 未登录本地缓存语言配置
5. 浏览器或系统语言检测
6. 默认回退到 `zh-CN`

说明：

- 对前端渲染来说，未登录优先使用本地缓存；登录后使用账号配置，并把账号配置视为最终来源。
- 对后端响应来说，如果前端已经显式发送语言头，后端直接按请求语言本地化；这样 `apps/app-backend` 不必额外依赖用户资料查询。
- 对非 Web 调用方，后端也可以仅根据 `Accept-Language` 或账号配置工作。

### 2. 响应协议

后端统一返回：

```json
{
  "code": "DOCUMENT_LOCKED",
  "message": "当前文档已锁定，无法编辑",
  "locale": "zh-CN",
  "data": {}
}
```

设计原则：

- `code` 是稳定协议，供前端逻辑判断和二次翻译。
- `message` 是当前语言下的可读文案，供非 Web 调用方直接展示。
- `locale` 便于调试与排障。
- 前端展示时优先按 `code` 查本地翻译，未命中再回退 `message`。

### 3. 资源组织

不建议让 Go 与 TS 直接共用同一份运行时资源文件。推荐采用“源文件 + 生成产物”的双层结构：

```text
locales/
  source/
    zh-CN/
      common.json
      auth.json
      document.json
      chat.json
      team.json
      settings.json
      errors.json
    en/
      common.json
      auth.json
      document.json
      chat.json
      team.json
      settings.json
      errors.json
  generated/
    web/
    app-backend/
    server/
```

原因：

- `i18next` 与 `go-i18n` 的运行时资源格式和占位符规则并不完全一致。
- 统一维护 `source`，再通过脚本生成各端可消费格式，长期更稳。
- 后续接翻译平台时，只需要把平台产出回灌到 `source` 或其上游，不必改运行时。

### 4. 命名空间与 key 规范

推荐命名空间：

- `common`
- `auth`
- `document`
- `chat`
- `team`
- `settings`
- `errors`

key 规范：

- 使用点分层级，如 `auth.login.submit`
- 错误码与前端 key 对齐，如 `errors.INVALID_CREDENTIALS`
- 插值参数统一使用命名参数，如 `{name}`、`{count}`、`{field}`

不允许：

- 把中文原文当 key
- 用自然语言长句做 key
- 同一个错误码在前后端使用不同参数名

## 数据与配置设计

### 1. 账号级语言配置

语言偏好属于账号级配置，不应继续塞在 `apps/app-backend` 的通用设置里。推荐放在 Go `server` 的用户域：

- `user.language` 新增字段
- `GET /api/auth/me` 与 `GET /api/users/me` 返回该字段
- `PUT /api/users/me` 支持更新该字段

原因：

- 登录、注册、团队、账户属于 `server` 负责域。
- 账号语言需要跨应用、跨端共享，应与用户资料放在同一可信源。

### 2. 未登录本地配置

未登录态本地存储：

- Web：`localStorage.zeus.language`
- Desktop：沿用 Web 容器本地存储即可；若未来需要系统级桥接，可再加 Tauri 持久层。

登录衔接规则：

- 若账号已有语言配置，覆盖本地。
- 若账号无语言配置但本地有配置，则登录后回写账号。
- 若两边都没有，则按浏览器或系统语言初始化。

### 3. 设置面板

在通用设置或个人设置里增加语言选择器：

- 选项：`简体中文`、`English`
- 切换后前端立即生效
- 已登录时同步写入账号配置
- 未登录时仅写本地

## 前端设计

### 1. 基础设施

新增前端 i18n runtime：

- 初始化 `i18next`
- 配置 ICU 支持
- 配置 `zh-CN` / `en` 资源加载
- 配置 fallback 语言
- 提供 `useI18nBootstrap` 负责启动期语言决策

### 2. 与现有认证链路对接

`apps/web/src/context/AuthContext.tsx` 登录成功后需要触发语言同步：

- 登录后读取用户语言
- 更新全局 i18n locale
- 必要时把本地语言回写到账号

`apps/web/src/config/api.ts` 的 `fetchWithCredentials` 统一追加：

- `X-Zeus-Locale`
- `Accept-Language`

这样所有去往 `server` 与 `apps/app-backend` 的请求都能携带当前语言。

### 3. 页面迁移顺序

优先迁移：

1. 登录 / 注册
2. 顶部与侧边导航
3. 设置页
4. 文档页核心操作
5. AI 对话页
6. 团队页

原因：这些页面覆盖首批用户主路径，收益最大。

## app-backend 设计

### 1. 语言解析

`apps/app-backend` 增加 locale 解析中间件：

- 读取 `X-Zeus-Locale`
- 解析 `Accept-Language`
- 限定只允许项目支持的语言代码
- 生成 `req.locale`

### 2. 本地化服务

新增统一 `translator` 封装：

- `t(locale, key, params)`
- `resolveErrorMessage(locale, code, fallbackMessage, params)`

替换 `router.ts` 当前散落的：

```ts
error(res, "INVALID_BLOCK_SHORTCUTS", validation.message, 400)
```

改为以 `code` 为中心的输出路径：

```ts
localizedError(res, req, "INVALID_BLOCK_SHORTCUTS", 400, params)
```

### 3. 与当前设置接口关系

`/api/settings/general` 保持业务设置职责，不承载账号语言偏好。这样可以避免：

- 未登录本地设置与已登录账号设置耦合
- `apps/app-backend` 成为账号主数据源

## server 设计

### 1. 用户语言字段

在 `server` 的用户领域新增 `Language`：

- domain model
- GORM model
- repository scan / update
- API response DTO
- profile update request DTO
- DDL migration

### 2. 本地化错误响应

`server` 侧认证、用户、团队、项目等模块逐步改造为：

- 保留稳定错误码
- 根据请求语言返回本地化 `message`
- 统一封装错误响应 helper，减少每个 handler 手写英文句子

## 迁移策略

### 阶段 1：基础设施

- 接入前端 i18n runtime
- 接入 `apps/app-backend` locale middleware
- 接入 `server` 用户语言字段与读写接口
- 接入统一 locale 请求头

### 阶段 2：核心页面与设置

- 登录页
- 注册页
- 设置页语言切换
- 主导航与常用按钮

### 阶段 3：核心后端错误码

- 认证错误
- 用户资料错误
- 文档页常见错误
- 通用设置与权限错误

### 阶段 4：业务页扩展

- 文档页
- AI 对话页
- 团队页
- 其他插件页与系统页

## 错误处理与回退策略

- 前端 key 缺失：显示后端 `message`
- 后端 key 缺失：回退英文 message
- 语言代码非法：回退 `zh-CN`
- 翻译资源加载失败：前端保底使用 fallback 资源包
- 插值参数缺失：记录日志并回退 fallback 文案

## 测试策略

### 单元测试

- 前端：语言选择优先级、fallback、插值、设置同步
- app-backend：locale 解析、错误码翻译、fallback
- server：用户语言读写、错误本地化 helper

### 集成测试

- 登录前本地语言生效
- 登录后账号语言覆盖本地
- 更新账号语言后跨刷新保持
- `server` 与 `apps/app-backend` 都能按请求头返回对应语言

### Playwright

至少覆盖：

- `zh-CN` / `en` 切换
- 登录后语言同步
- 刷新后语言保持
- 关键错误提示按语言显示

## 成功标准

- 首批 `zh-CN` / `en` 在核心路径可用。
- 用户语言在登录后跨 Web / Desktop 一致。
- 前后端都输出稳定 `code + localized message`。
- 新功能新增文案不再直接硬编码中文。
- 语言资源结构可扩展到更多语言且不需要推翻协议。

## 参考来源

- `i18next` 官方文档：[https://www.i18next.com/](https://www.i18next.com/)
- `react-i18next` 官方文档：[https://react.i18next.com/](https://react.i18next.com/)
- `go-i18n` 官方仓库：[https://github.com/nicksnyder/go-i18n](https://github.com/nicksnyder/go-i18n)
- `FormatJS` 官方文档：[https://formatjs.github.io/](https://formatjs.github.io/)
- `Lingui` 官方文档：[https://lingui.dev/](https://lingui.dev/)
- OpenAI Help Center 语言设置说明：[https://help.openai.com/en/articles/8357869](https://help.openai.com/en/articles/8357869)
- OpenAI 关于 Codex 的公开介绍：[https://openai.com/index/unlocking-the-codex-harness/](https://openai.com/index/unlocking-the-codex-harness/)
