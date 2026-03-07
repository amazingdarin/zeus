# Zeus 文档格式设计

## 整体架构

Zeus 文档采用分层结构设计：

```
Document
├── meta          # 文档元数据
│   ├── id        # 唯一标识符
│   ├── title     # 标题
│   ├── parent_id # 父文档 ID
│   └── ...       # 其他元数据
└── body          # 文档正文
    └── content   # Tiptap JSON 内容
        └── nodes # 节点树
```

## 存储结构

文档以 JSON 文件形式存储在文件系统中：

```
{REPO_ROOT}/{projectKey}/docs/
├── api-guide.json           # 文档内容
├── api-guide/               # 子文档目录
│   ├── authentication.json
│   └── .index               # 排序索引
└── .index
```

## 节点类型分类

### 1. 基础节点（StarterKit）

来自 Tiptap StarterKit 的核心节点：

| 节点 | 说明 | 支持 Block ID |
|------|------|---------------|
| `doc` | 文档根节点 | ❌ |
| `paragraph` | 段落 | ✅ |
| `heading` | 标题 (1-6 级) | ✅ |
| `text` | 文本节点 | ❌ |
| `bulletList` | 无序列表 | ❌ |
| `orderedList` | 有序列表 | ❌ |
| `listItem` | 列表项 | ✅ |
| `taskList` | 任务列表 | ❌ |
| `taskItem` | 任务项 | ✅ |
| `blockquote` | 引用块 | ✅ |
| `hardBreak` | 硬换行 | ❌ |

### 2. 自定义节点

Zeus 扩展的自定义节点：

| 节点 | 说明 | 原子节点 |
|------|------|----------|
| `codeBlock` | 代码块（支持多渲染器） | ❌ |
| `horizontalRule` | 水平分隔线 | ✅ |
| `image` | 图片 | ✅ |
| `imageUpload` | 图片上传占位符 | ✅ |
| `link_preview` | 链接预览卡片 | ✅ |
| `file_block` | 文件附件块 | ✅ |
| `mindmap` | 脑图（ECharts tree） | ✅ |

### 3. 内联 Marks

应用于文本的格式标记：

| Mark | 说明 | 属性 |
|------|------|------|
| `bold` | 粗体 | 无 |
| `italic` | 斜体 | 无 |
| `strike` | 删除线 | 无 |
| `code` | 行内代码 | 无 |
| `underline` | 下划线 | 无 |
| `link` | 链接 | `href`, `target` |
| `highlight` | 高亮 | `color` |
| `superscript` | 上标 | 无 |
| `subscript` | 下标 | 无 |

## Block ID 机制

Zeus 为特定节点自动生成唯一 ID，用于块级引用和追踪：

**支持 Block ID 的节点类型：**
- `paragraph`
- `heading`
- `codeBlock`
- `listItem`
- `taskItem`
- `blockquote`

**ID 生成规则：**
- 使用 `crypto.randomUUID()` 生成
- 回退方案：`bid_` + 随机字符串 + 时间戳

## 内容约束

### 嵌套规则

1. `doc` 只能包含块级节点
2. `paragraph` 只能包含内联内容（text + marks）
3. `heading` 只能包含内联内容
4. `bulletList`/`orderedList` 只能包含 `listItem`
5. `taskList` 只能包含 `taskItem`
6. `blockquote` 可包含任意块级节点
7. `codeBlock` 只能包含纯文本

### 原子节点

以下节点是原子节点（atom），不能包含子内容：
- `horizontalRule`
- `image`
- `imageUpload`
- `link_preview`
- `file_block`
- `mindmap`

## 文本对齐

支持的对齐方式（仅 `heading` 和 `paragraph`）：
- `left` - 左对齐（默认）
- `center` - 居中
- `right` - 右对齐
- `justify` - 两端对齐
