# 文档页面多页面缓存与位置还原设计（Design）

## 背景
当前文档页是单文档展示模型（URL `/documents/:documentId` 对应一个活跃文档）。
用户希望在文档顶部栏支持“多页面缓存”（类似轻量页签），并在切换页面时恢复先前状态。

## 目标
1. 支持在文档顶部栏缓存多个文档页面（上限 8）。
2. 切换缓存页面时恢复：
   - 滚动位置
   - 光标位置（selection）
   - 未保存草稿（标题与正文）
3. 重复打开同一文档时不新增重复页签，直接切换。
4. 超出上限时按 LRU 淘汰旧页签。

## 非目标
1. 不做跨刷新恢复（仅当前会话内有效）。
2. 不做跨应用重启恢复。
3. 不在本次设计中引入后端状态存储。

## 已确认约束
1. 持久化范围：仅当前会话。
2. 缓存上限：8。
3. 还原粒度：滚动 + 光标 + 草稿。
4. 淘汰策略：LRU。
5. 重复打开行为：命中已缓存页签时直接切换，不重复开页签。

## 方案对比

### 方案 A：KeepAlive 多实例（推荐）
在 `DocumentPage` 同时维护最多 8 个 `DocumentWorkspace` 实例，非激活实例隐藏但不卸载。

优点：
1. 状态保真度最高，天然保留滚动、selection、草稿与编辑器内部状态。
2. 恢复逻辑简单，边缘问题少。

缺点：
1. 内存占用高于单实例模型。

结论：在上限 8 的前提下可接受，且最符合“恢复完整编辑上下文”的目标。

### 方案 B：快照重建
切换时完全卸载，切回时根据快照重建编辑器状态。

优点：
1. 内存占用更低。

缺点：
1. 复杂度高，selection 与插件态恢复不稳定。
2. 草稿一致性风险高。

### 方案 C：混合
部分页签 KeepAlive，部分页签快照重建。

优点：
1. 理论上平衡内存与体验。

缺点：
1. 复杂度最高，维护成本高。

## 推荐架构

### 1) 路由与激活文档
继续使用路由作为激活文档真值：
- `activeDocId` 与 URL `/documents/:documentId` 同步。
- 顶栏切换页签时通过 `navigate` 更新 URL，保留浏览器前进/后退语义。

### 2) 页签会话状态（仅内存）
在 `DocumentPage` 增加会话状态层：

```ts
type DocTab = {
  docId: string;
  title: string;
  openedAt: number;
  lastAccessAt: number;
};

type DocSnapshot = {
  scrollTop: number;
  selection: { from: number; to: number } | null;
  draftTitle: string;
  draftContent: JSONContent;
  saveStatus: "idle" | "dirty" | "saving" | "error";
};

type TabSessionState = {
  tabs: DocTab[];                         // max = 8
  activeDocId: string | null;
  snapshots: Record<string, DocSnapshot>; // key = docId
};
```

### 3) KeepAlive 渲染层
- `DocumentPage` 维护一个 workspace 映射（docId -> workspace props）。
- 当前激活页显示，其他页设置 `display: none` 或容器隐藏，不卸载组件。
- 删除页签或淘汰页签时才卸载对应 workspace。

### 4) Workspace 桥接能力
`DocumentWorkspace` 暴露桥接接口给 `DocumentPage`：
1. 获取当前快照（scroll、selection、draft）
2. 应用快照（恢复 scroll、selection、draft）
3. 安全 flush（用于关闭/淘汰前）

## 关键交互流程

### 打开文档
1. 已存在页签：切换激活。
2. 不存在且未满 8：追加页签并激活。
3. 不存在且已满 8：按 LRU 选择淘汰目标，先 flush，再替换为新页签并激活。

### 切换页签
1. 采集当前页快照。
2. 激活目标页签，更新 `lastAccessAt`。
3. 恢复目标页快照（存在则应用）。

### 关闭页签
1. 关闭前尝试 flush。
2. 清理 `tabs`、`snapshots` 与对应 keepalive workspace。
3. 若关闭的是激活页：切到最近访问页；若无则跳 `/documents`。

## 异常处理
1. flush 失败：阻止关闭/淘汰，提示错误，避免静默丢稿。
2. 文档被删除：自动从 tabs/snapshots 清理并切换到可用页。
3. 项目切换：清空当前项目所有会话态（tabs + snapshots + keepalive 映射）。
4. 草稿恢复失败：回退到服务端最新内容并提示。

## 性能与资源约束
1. 上限固定 8，避免无限增长。
2. 非激活 workspace 仅隐藏，不运行重型视图逻辑（如差异面板）。
3. 快照写入节流（建议 100-150ms）。

## 测试策略

### 单元测试
1. tabs 状态机：打开/切换/关闭/LRU 淘汰。
2. 重复打开去重。
3. 项目切换清空。

### 组件测试
1. 顶栏页签渲染与激活态。
2. 超限淘汰行为与 flush 保护。

### 端到端测试
1. A/B/C 文档切换后恢复 scroll/selection/draft。
2. 打开第 9 个文档触发 LRU。
3. 刷新页面后不恢复旧页签（会话内语义）。

## 验收标准
1. 顶栏缓存最多 8 个文档页签。
2. 切换页签可恢复滚动、光标、草稿。
3. 同文档不出现重复页签。
4. 超限按 LRU 淘汰，且不会静默丢稿。
5. 刷新后不恢复旧页签。
