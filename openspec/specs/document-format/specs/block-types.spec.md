# Block 类型规范

## 概述

本规范定义了 Zeus 文档编辑器支持的所有 Block 类型及其属性。

---

## paragraph

段落节点，最基础的文本容器。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | `string` | 否 | 自动生成 | Block ID |
| `textAlign` | `"left" \| "center" \| "right" \| "justify"` | 否 | `"left"` | 文本对齐 |

### 内容

只能包含内联内容：`text` 节点及其 marks。

### 示例

```json
{
  "type": "paragraph",
  "attrs": {
    "id": "p-uuid-001",
    "textAlign": "left"
  },
  "content": [
    { "type": "text", "text": "这是一个段落。" }
  ]
}
```

---

## heading

标题节点，支持 1-6 级。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `level` | `1 \| 2 \| 3 \| 4 \| 5 \| 6` | 是 | - | 标题级别 |
| `id` | `string` | 否 | 自动生成 | Block ID |
| `textAlign` | `"left" \| "center" \| "right" \| "justify"` | 否 | `"left"` | 文本对齐 |

### 内容

只能包含内联内容。

### 示例

```json
{
  "type": "heading",
  "attrs": {
    "level": 2,
    "id": "h-uuid-001"
  },
  "content": [
    { "type": "text", "text": "二级标题" }
  ]
}
```

---

## bulletList

无序列表容器。

### 属性

无特殊属性。

### 内容

只能包含 `listItem` 节点。

### 示例

```json
{
  "type": "bulletList",
  "content": [
    {
      "type": "listItem",
      "attrs": { "id": "li-001" },
      "content": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "列表项一" }]
        }
      ]
    },
    {
      "type": "listItem",
      "attrs": { "id": "li-002" },
      "content": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "列表项二" }]
        }
      ]
    }
  ]
}
```

---

## orderedList

有序列表容器。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `start` | `number` | 否 | `1` | 起始编号 |

### 内容

只能包含 `listItem` 节点。

### 示例

```json
{
  "type": "orderedList",
  "attrs": { "start": 1 },
  "content": [
    {
      "type": "listItem",
      "attrs": { "id": "li-003" },
      "content": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "第一步" }]
        }
      ]
    }
  ]
}
```

---

## listItem

列表项节点。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | `string` | 否 | 自动生成 | Block ID |

### 内容

可包含任意块级节点，通常包含 `paragraph`。

### 示例

```json
{
  "type": "listItem",
  "attrs": { "id": "li-uuid-001" },
  "content": [
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "列表项内容" }]
    }
  ]
}
```

---

## taskList

任务列表容器。

### 属性

无特殊属性。

### 内容

只能包含 `taskItem` 节点。

### 示例

```json
{
  "type": "taskList",
  "content": [
    {
      "type": "taskItem",
      "attrs": { "id": "ti-001", "checked": false },
      "content": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "待办事项" }]
        }
      ]
    }
  ]
}
```

---

## taskItem

任务项节点，带复选框。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | `string` | 否 | 自动生成 | Block ID |
| `checked` | `boolean` | 否 | `false` | 是否已完成 |

### 内容

可包含任意块级节点（支持嵌套）。

### 示例

```json
{
  "type": "taskItem",
  "attrs": {
    "id": "ti-uuid-001",
    "checked": true
  },
  "content": [
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "已完成的任务" }]
    }
  ]
}
```

---

## blockquote

引用块节点。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | `string` | 否 | 自动生成 | Block ID |

### 内容

可包含任意块级节点。

### 示例

```json
{
  "type": "blockquote",
  "attrs": { "id": "bq-uuid-001" },
  "content": [
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "这是一段引用文字。" }]
    }
  ]
}
```

---

## codeBlock

代码块节点，支持语法高亮和多种渲染模式。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `language` | `string` | 否 | `null` | 编程语言 |
| `renderer` | `string` | 否 | `"auto"` | 渲染器 ID |
| `preview` | `boolean` | 否 | `false` | 是否预览模式 |
| `view_mode` | `"text" \| "preview"` | 否 | `"text"` | 显示模式 |
| `collapsed` | `boolean` | 否 | `false` | 是否折叠 |

### 内容

只能包含纯文本节点（无 marks）。

### 常用语言值

`javascript`, `typescript`, `python`, `go`, `rust`, `java`, `json`, `yaml`, `markdown`, `sql`, `bash`, `html`, `css`

### 示例

```json
{
  "type": "codeBlock",
  "attrs": {
    "language": "typescript",
    "renderer": "auto",
    "preview": false,
    "view_mode": "text",
    "collapsed": false
  },
  "content": [
    { "type": "text", "text": "const greeting = \"Hello, World!\";\nconsole.log(greeting);" }
  ]
}
```

---

## horizontalRule

水平分隔线，原子节点。

### 属性

无属性。

### 内容

无内容（原子节点）。

### 示例

```json
{
  "type": "horizontalRule"
}
```

---

## image

图片节点，原子节点。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `src` | `string` | 是 | - | 图片 URL |
| `alt` | `string` | 否 | `""` | 替代文本 |
| `title` | `string` | 否 | `""` | 标题 |
| `width` | `number` | 否 | - | 宽度 |
| `height` | `number` | 否 | - | 高度 |

### 内容

无内容（原子节点）。

### 示例

```json
{
  "type": "image",
  "attrs": {
    "src": "https://example.com/image.png",
    "alt": "示例图片",
    "title": "这是一张示例图片"
  }
}
```

---

## imageUpload

图片上传占位符节点，原子节点。用于编辑模式下的图片上传交互。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `accept` | `string` | 否 | `"image/*"` | 接受的文件类型 |
| `limit` | `number` | 否 | `1` | 最大文件数 |
| `maxSize` | `number` | 否 | `0` | 最大文件大小（字节） |

### 内容

无内容（原子节点）。

### 说明

此节点通常在上传完成后会被替换为 `image` 节点。

### 示例

```json
{
  "type": "imageUpload",
  "attrs": {
    "accept": "image/*",
    "limit": 1,
    "maxSize": 10485760
  }
}
```

---

## link_preview

链接预览卡片节点，原子节点。展示 URL 的 Open Graph 预览信息。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | `string` | 是 | `""` | 链接 URL |
| `title` | `string` | 否 | `""` | 页面标题 |
| `description` | `string` | 否 | `""` | 页面描述 |
| `image` | `string` | 否 | `""` | 预览图片 URL |
| `site_name` | `string` | 否 | `""` | 网站名称 |
| `fetched_at` | `string` | 否 | `""` | 抓取时间 |
| `status` | `"idle" \| "loading" \| "success" \| "error"` | 否 | `"idle"` | 抓取状态 |
| `error_message` | `string` | 否 | `""` | 错误信息 |

### 内容

无内容（原子节点）。

### 示例

```json
{
  "type": "link_preview",
  "attrs": {
    "url": "https://github.com/tiptap/tiptap",
    "title": "Tiptap - The headless editor framework for web artisans",
    "description": "A headless, framework-agnostic and extendable rich text editor.",
    "image": "https://tiptap.dev/og-image.png",
    "site_name": "GitHub",
    "status": "success"
  }
}
```

---

## file_block

文件附件块节点，原子节点。用于嵌入文件附件。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `asset_id` | `string` | 是 | `""` | 资源 ID |
| `file_name` | `string` | 是 | `""` | 文件名 |
| `mime` | `string` | 否 | `""` | MIME 类型 |
| `size` | `number` | 否 | `0` | 文件大小（字节） |
| `file_type` | `"office" \| "text" \| "unknown"` | 否 | `""` | 文件类型分类 |
| `office_type` | `"docx" \| "xlsx" \| "pptx" \| "pdf"` | 否 | `""` | Office 文件类型 |

### 内容

无内容（原子节点）。

### 示例

```json
{
  "type": "file_block",
  "attrs": {
    "asset_id": "asset-uuid-001",
    "file_name": "report.pdf",
    "mime": "application/pdf",
    "size": 1048576,
    "file_type": "office",
    "office_type": "pdf"
  }
}
```

---

## hardBreak

硬换行节点，在段落内强制换行。

### 属性

无属性。

### 内容

无内容。

### 示例

在段落内使用：

```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "第一行" },
    { "type": "hardBreak" },
    { "type": "text", "text": "第二行" }
  ]
}
```

---

## text

文本节点，承载实际文字内容。

### 属性

无属性。

### 特殊字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `text` | `string` | 是 | 文本内容 |
| `marks` | `Mark[]` | 否 | 格式标记数组 |

### 示例

```json
{
  "type": "text",
  "text": "普通文本"
}
```

带格式：

```json
{
  "type": "text",
  "text": "粗体文本",
  "marks": [{ "type": "bold" }]
}
```

---

## table

表格容器节点，包含表格行。

### 属性

无特殊属性。

### 内容

只能包含 `tableRow` 节点。

### 示例

```json
{
  "type": "table",
  "content": [
    {
      "type": "tableRow",
      "content": [
        {
          "type": "tableHeader",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Header 1" }] }]
        },
        {
          "type": "tableHeader",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Header 2" }] }]
        }
      ]
    },
    {
      "type": "tableRow",
      "content": [
        {
          "type": "tableCell",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Cell 1" }] }]
        },
        {
          "type": "tableCell",
          "attrs": { "colspan": 1, "rowspan": 1 },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Cell 2" }] }]
        }
      ]
    }
  ]
}
```

---

## tableRow

表格行节点。

### 属性

无特殊属性。

### 内容

只能包含 `tableHeader` 或 `tableCell` 节点。

### 示例

```json
{
  "type": "tableRow",
  "content": [
    {
      "type": "tableCell",
      "attrs": { "colspan": 1, "rowspan": 1 },
      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Cell" }] }]
    }
  ]
}
```

---

## tableHeader

表头单元格节点，用于表格第一行或第一列。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `colspan` | `number` | 否 | `1` | 列跨度 |
| `rowspan` | `number` | 否 | `1` | 行跨度 |
| `colwidth` | `number[] \| null` | 否 | `null` | 列宽数组 |

### 内容

可包含任意块级节点，通常包含 `paragraph`。

### 示例

```json
{
  "type": "tableHeader",
  "attrs": {
    "colspan": 2,
    "rowspan": 1,
    "colwidth": null
  },
  "content": [
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "Merged Header" }]
    }
  ]
}
```

---

## tableCell

表格普通单元格节点。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `colspan` | `number` | 否 | `1` | 列跨度 |
| `rowspan` | `number` | 否 | `1` | 行跨度 |
| `colwidth` | `number[] \| null` | 否 | `null` | 列宽数组 |

### 内容

可包含任意块级节点，通常包含 `paragraph`。

### 示例

```json
{
  "type": "tableCell",
  "attrs": {
    "colspan": 1,
    "rowspan": 1,
    "colwidth": null
  },
  "content": [
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "Cell content" }]
    }
  ]
}
```
