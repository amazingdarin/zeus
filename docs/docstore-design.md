# DocStore Refactoring Design (2026-01-18)

## 1. 架构概览 (Architecture Overview)

我们将 Knowledge Base 拆分为两个高内聚的模块（模块化单体架构）：

1.  **DocStore (文档引擎)**：负责 I/O、文件结构、Git 操作。它只管“文件”。
2.  **Brain (知识引擎)**：负责 RAG、向量索引、语义搜索。它只管“理解”。

> **存储结构变更**：原来的多文件结构（meta.json + content.json）已被**完全废弃**。
> 现在每个文档对应**一个物理文件**（`.json` 或 `.md`），包含完整的 Meta 和 Body。

## 2. 文件系统布局 (File System Layout)

采用 **"文件 + 同名目录"** 的结构，既支持无限层级，又保持文件系统可读性。

```text
ProjectA/
└── docs/
    ├── .index                  # 排序文件: ["intro", "api", "guides"]
    ├── intro.md                # Markdown 文档
    ├── api.json                # JSON 文档 (Tiptap)
    ├── api/                    # api.json 的子文档目录 (Companion Directory)
    │   ├── .index              # 子目录排序: ["auth", "users"]
    │   ├── auth.json
    │   └── users.json
    └── guides.json
```

*   **Filename = Slug**：文件名（去除后缀）即 Slug。
*   **同名目录**：如果 `api.json` 有子文档，它们必须存放在 `api/` 目录下。
*   **隐藏索引**：`.index` 文件记录当前目录下的文档排序。

## 3. 数据模型 (Data Model)

### JSON 存储格式 (`slug.json`)

```json
{
  "meta": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "schema_version": 1,
    "slug": "api",
    "path": "docs/api",
    "title": "API Documentation",
    "parent_id": "root",
    "created_at": "2024-01-01T00:00:00Z"
  },
  "body": {
    "type": "tiptap",
    "content": { ...tiptap_json_object... }
  }
}
```

### Go 结构体 (`server/internal/domain/docstore`)

```go
type Document struct {
    Meta DocumentMeta `json:"meta"`
    Body DocumentBody `json:"body"`
}

type DocumentMeta struct {
    ID            string    `json:"id"`
    SchemaVersion int       `json:"schema_version"` // 默认 1
    Title         string    `json:"title"`
    Slug          string    `json:"slug"`      // 必须与文件名一致 (System Source of Truth)
    Path          string    `json:"path"`      // 逻辑路径 (e.g. "docs/api/v1")
    ParentID      string    `json:"parent_id"` // 逻辑父节点引用
    CreatedAt     time.Time `json:"created_at"`
    UpdatedAt     time.Time `json:"updated_at"`
    Extra         map[string]any `json:"extra,omitempty"`
}

type DocumentBody struct {
    Type    string      `json:"type"`    // "tiptap" | "markdown"
    // 多态字段：
    // - Type="tiptap": 存储 JSON 对象 (*TiptapDoc)
    // - Type="markdown": 存储 字符串 (string)
    Content interface{} `json:"content"`
}
```

## 4. 核心逻辑：ID 中心化与冲突处理

系统内部通过 **UUID** 交互，而不是路径。

### Slug 冲突处理 (Collision Strategy)
由于文件系统（尤其是 Mac/Windows）可能不区分大小写，或者存在命名冲突：
1.  **标准化**：所有 Slug 强制转为 **kebab-case**（小写，连字符）。
    *   `Api Doc` -> `api-doc`
2.  **自动规避**：如果目标 Slug 已存在（检查 `index` 或文件系统），自动追加数字后缀。
    *   `api-doc` -> `api-doc-1` -> `api-doc-2`

### 关键操作逻辑

| 操作 | 逻辑描述 |
| :--- | :--- |
| **Get(ID)** | 查内存索引 -> 获取路径 -> 读取物理文件。 |
| **Save(Doc)** | 1. 若 ID 已存在：覆盖更新。<br>2. **重命名检测**：如果 `doc.Meta.Slug` 与当前文件名不一致，执行 `os.Rename`（包括同名目录）。<br>3. 若 ID 不存在：在父目录下创建新文件。 |
| **Delete(ID)** | 删除文件 **以及** 同名目录（递归删除）。从索引中移除。 |

## 5. Service 接口定义

```go
type Service interface {
    // --- 核心 CRUD (基于 ID) ---
    Get(ctx context.Context, projectID, docID string) (*Document, error)
    Save(ctx context.Context, projectID string, doc *Document) error
    Delete(ctx context.Context, projectID, docID string) error

    // --- 结构调整 (合并 Move/Reorder) ---
    // Move 将文档移动到新的父节点下的指定位置
    // 参数:
    //   targetParentID: 
    //     - 如果与 doc.ParentID 相同，则仅调整顺序 (Reorder)
    //     - 如果不同，则执行跨目录移动 (Reparent)
    //   targetIndex:
    //     - 0: 插到最前面
    //     - -1 或 >len: 追加到最后
    //     - 其他值: 插到指定索引处
    Move(ctx context.Context, projectID, docID, targetParentID string, targetIndex int) error

    // --- 视图查询 ---
    // 懒加载：获取指定父节点下的直接子节点列表
    GetChildren(ctx context.Context, projectID, parentID string) ([]TreeItem, error)
}
```
