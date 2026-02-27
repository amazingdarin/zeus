# 文档块快捷键（Slash）能力设计

## 1. 背景与目标

当前文档编辑器已支持：
- 输入 `/` 打开块选择菜单
- 方向键上下选择、Enter 确认、Esc 关闭
- 鼠标点击选择块

本次新增能力：
- 在 `/` 菜单打开后，支持单字符快捷选取（示例：按 `1` 直接选中“标题1”）
- 支持在编辑中直接输入 `/1` 快速插入“标题1”
- 块快捷键可在“设置 -> 通用配置”中自定义

已确认交互约束：
- 快捷键只支持单字符
- 不允许快捷键冲突（保存时校验）
- `/1` 在任意光标位置都即时触发插入

## 2. 方案对比与结论

### 2.1 方案 A：在编辑器键盘主循环中扩展（选中）
- 复用现有 `doc-editor.tsx` 的 slash 菜单状态与键盘拦截
- 新增快捷键映射与 `/x` 解析状态机

优点：
- 改动集中，复用已有行为
- 性能开销低，无需重建扩展体系
- 风险可控，便于渐进发布

缺点：
- 需要谨慎处理输入法合成态与事务去重

### 2.2 方案 B：基于 InputRule 动态规则
- 每个快捷键注册一个 `/x` 规则

优点：
- 规则语义显式

缺点：
- 配置动态化后规则重建复杂
- 与现有 slash 菜单状态机并行，维护成本高

### 2.3 方案 C：统一 slash 查询引擎
- `/` 后全部作为查询 token，命中唯一项时自动插入

优点：
- 后续可扩展多字符别名

缺点：
- 超出当前需求，改动面大
- 对“即时 `/1`”收益不及方案 A 直接

结论：采用方案 A。

## 3. 架构与改动范围

### 3.1 编辑器层（packages/doc-editor）

主要文件：
- `packages/doc-editor/src/templates/simple/doc-editor.tsx`
- `packages/doc-editor/src/ui/block-add-menu.tsx`
- `packages/doc-editor/src/extensions/block-add-handle.ts`

职责：
- 解析并执行快捷键
- 统一走现有 `insertBuiltinBlock` 插入路径
- 在块菜单项展示快捷键提示

### 3.2 前端设置层（apps/web）

主要文件：
- `apps/web/src/components/GeneralSettingsPanel.tsx`
- `apps/web/src/api/general-settings.ts`
- `apps/web/src/components/RichTextEditor.tsx`（向 DocEditor 透传配置）

职责：
- 提供快捷键配置 UI
- 前端冲突校验与保存
- 将配置下发给编辑器

### 3.3 后端设置层（apps/app-backend）

主要文件：
- `apps/app-backend/src/router.ts`
- `apps/app-backend/src/services/general-settings-store.ts`
- `ddl/sql/migrations/009_add_document_block_shortcuts.sql`（新增）

职责：
- 存储/读取用户级快捷键配置
- 统一参数校验与默认值回退

## 4. 数据模型

## 4.1 General Settings 新字段

- 字段名（前端）：`documentBlockShortcuts`
- 字段名（API 入参）：`document_block_shortcuts`
- 类型：`Record<string, BuiltinBlockType>`
- 语义：`key = 单字符快捷键`，`value = 内置块类型`

示例：

```json
{
  "documentBlockShortcuts": {
    "1": "heading-1",
    "2": "heading-2",
    "3": "heading-3",
    "0": "paragraph",
    "4": "toggle-block"
  }
}
```

### 4.2 校验规则

- key：去空格后长度必须为 1
- value：必须属于内置块白名单
- map 内 key 不可重复（天然）
- value 也不可重复（一个块只能绑定一个快捷键）

## 5. 运行时交互状态机

### 5.1 `/` 菜单打开后的快捷选取

触发条件：
- slash 菜单打开
- 用户按下单字符快捷键，且命中映射

执行动作：
1. `preventDefault + stopPropagation`
2. 调用 `selectBuiltinBlockFromMenu(mappedType, "slash")`
3. 关闭 slash 菜单并保持当前插入后光标行为

### 5.2 输入 `/x` 的即时插入

触发条件：
- 文档 update 周期内，光标前最近两个字符匹配 `"/" + key`
- `key` 命中映射
- 非输入法合成态

执行动作（单事务）：
1. 删除 `/x` 两个字符
2. 插入映射块（复用 `insertBuiltinBlock`）
3. 关闭菜单状态并更新左侧块控制锚点

去重策略：
- 记录最近一次处理的位置和版本戳，避免同一次更新被重复处理

### 5.3 Esc 行为

- 菜单打开时：Esc 只关闭菜单，不修改文档
- `/x` 已即时插入后：Esc 不回滚，使用撤销（Cmd/Ctrl+Z）

## 6. 设置页设计

入口：
- `设置 -> 通用配置 -> 文档块快捷键`

表单结构：
- 每个块一行：`块名称 + 单字符输入框`
- 提供 `恢复默认` 按钮

交互规则：
- 输入框仅接受单字符（保存前统一 trim）
- 冲突时显示错误并禁止保存
- 允许空值（表示该块不绑定快捷键）

登录约束：
- 延续现有 general settings 规则：未登录允许查看，不允许保存

## 7. API 与存储设计

### 7.1 GET `/api/settings/general`

返回新增：
- `documentBlockShortcuts`

### 7.2 PUT `/api/settings/general`

请求可选新增：
- `document_block_shortcuts`

失败返回：
- `400 INVALID_BLOCK_SHORTCUTS`（字符非法、块类型非法、冲突）

### 7.3 数据库迁移

表：`user_general_settings`
- 新增列：`document_block_shortcuts JSONB NOT NULL DEFAULT '{}'::jsonb`

读取策略：
- DB 空值或非法值 -> sanitize 后回退默认配置

## 8. 兼容性与风险控制

- 旧前端 + 新后端：忽略新字段，不受影响
- 新前端 + 旧后端：缺字段时使用默认快捷键
- 非法配置不会导致编辑器崩溃，运行时自动降级为默认映射

主要风险：
- IME 组合输入误触发
- `/x` 与普通文本输入冲突（本版本按需求选择“任意位置即触发”）

缓解：
- `event.isComposing` 防护
- 插入逻辑统一事务，支持标准撤销

## 9. 测试方案

### 9.1 doc-editor 单元测试

新增测试文件：
- `packages/doc-editor/tests/block-shortcut.test.ts`

覆盖点：
- `/` 菜单打开后按快捷键选中
- `/x` 即时插入与字符删除
- Esc 关闭行为
- isComposing 时不触发
- 非法配置回退默认

### 9.2 app-backend 单元测试

修改：
- `apps/app-backend/tests/general-settings-store.test.ts`

新增：
- `apps/app-backend/tests/general-settings-shortcuts-validation.test.ts`

覆盖点：
- 新字段读写
- 非法 key/value 拒绝
- sanitize 与默认值回退

### 9.3 web 侧测试

新增：
- `apps/web/tests/general-settings-shortcuts.test.ts`

覆盖点：
- 单字符输入校验
- 冲突校验阻止保存
- 恢复默认后 payload 正确

## 10. 上线与回滚

上线顺序：
1. 先发后端（向前兼容）
2. 再发前端与编辑器包

回滚策略：
- 回滚前端即可隐藏新入口
- 后端保留字段不影响旧版本
- 必要时后端忽略 `document_block_shortcuts` 入参实现软回滚

## 11. 验收标准

- `/` 菜单打开后可通过单字符快速选块
- 支持输入 `/1` 直接插入“标题1”
- 快捷键可在设置中配置并持久化
- 冲突配置无法保存，提示明确
- 编辑器在 IME、Esc、撤销等关键场景无闪烁、无崩溃
