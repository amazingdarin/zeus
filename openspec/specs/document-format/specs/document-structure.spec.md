# 文档结构规范

## 概述

本规范定义了 Zeus 文档的整体 JSON 结构，包括元数据和正文内容。

## 文档文件结构

每个文档存储为独立的 JSON 文件，包含以下顶级字段：

```json
{
  "id": "string",           // 文档唯一标识符
  "title": "string",        // 文档标题
  "parent_id": "string?",   // 父文档 ID（可选）
  "body": {                 // 文档正文
    "type": "doc",
    "content": []           // Tiptap 节点数组
  },
  "created_at": "string",   // 创建时间 (ISO 8601)
  "updated_at": "string"    // 更新时间 (ISO 8601)
}
```

## 字段说明

### `id`

- **类型**: `string`
- **必需**: 是
- **说明**: 文档的唯一标识符
- **格式**: UUID 或短 ID
- **示例**: `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`

### `title`

- **类型**: `string`
- **必需**: 是
- **说明**: 文档标题，显示在导航树和标题栏
- **约束**: 最大 200 字符
- **示例**: `"API 使用指南"`

### `parent_id`

- **类型**: `string | null`
- **必需**: 否
- **说明**: 父文档的 ID，用于构建文档层级
- **默认**: `null`（顶级文档）
- **示例**: `"parent-doc-id"`

### `body`

- **类型**: `TiptapDocument`
- **必需**: 是
- **说明**: 文档正文，遵循 Tiptap JSON 格式

```typescript
interface TiptapDocument {
  type: "doc"
  content: TiptapNode[]
}
```

### `created_at`

- **类型**: `string`
- **必需**: 是
- **格式**: ISO 8601 日期时间
- **示例**: `"2024-01-15T10:30:00.000Z"`

### `updated_at`

- **类型**: `string`
- **必需**: 是
- **格式**: ISO 8601 日期时间
- **示例**: `"2024-01-15T14:45:00.000Z"`

## Tiptap 节点结构

### 基础节点接口

```typescript
interface TiptapNode {
  type: string              // 节点类型
  attrs?: Record<string, any>  // 节点属性
  content?: TiptapNode[]    // 子节点（块级节点）
  text?: string             // 文本内容（text 节点）
  marks?: TiptapMark[]      // 格式标记（text 节点）
}

interface TiptapMark {
  type: string              // Mark 类型
  attrs?: Record<string, any>  // Mark 属性
}
```

### 节点类型枚举

```typescript
type BlockNodeType =
  | "paragraph"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "listItem"
  | "taskList"
  | "taskItem"
  | "blockquote"
  | "codeBlock"
  | "horizontalRule"
  | "image"
  | "imageUpload"
  | "link_preview"
  | "file_block"
  | "table"
  | "tableRow"
  | "tableHeader"
  | "tableCell"
  | "chart"           // ECharts 图表（块级）

type InlineNodeType = 
  | "text" 
  | "hardBreak"
  | "math"            // 数学公式（内联/块级）
  | "music"           // 乐谱（内联/块级）

type MarkType =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "underline"
  | "link"
  | "highlight"
  | "superscript"
  | "subscript"
```

## 完整文档示例

```json
{
  "id": "doc-001",
  "title": "快速入门指南",
  "parent_id": null,
  "body": {
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": { "level": 1, "id": "abc123" },
        "content": [
          { "type": "text", "text": "快速入门" }
        ]
      },
      {
        "type": "paragraph",
        "attrs": { "id": "def456" },
        "content": [
          { "type": "text", "text": "欢迎使用 " },
          {
            "type": "text",
            "text": "Zeus",
            "marks": [{ "type": "bold" }]
          },
          { "type": "text", "text": " 文档管理系统。" }
        ]
      }
    ]
  },
  "created_at": "2024-01-15T10:30:00.000Z",
  "updated_at": "2024-01-15T14:45:00.000Z"
}
```

## 空文档

新建文档的默认内容：

```json
{
  "type": "doc",
  "content": [
    {
      "type": "paragraph"
    }
  ]
}
```

## 验证规则

1. `body.type` 必须为 `"doc"`
2. `body.content` 必须是数组
3. `body.content` 只能包含块级节点
4. 每个节点的 `type` 必须是有效的节点类型
5. 支持 Block ID 的节点应包含 `attrs.id`
