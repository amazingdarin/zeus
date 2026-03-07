# Block 类型规范

## 概述

本规范定义了 Zeus 文档编辑器支持的所有 Block 类型及其属性。

## 文本类块通用样式属性

以下属性适用于文本类块：

- `paragraph`、`heading`、`blockquote`
- `bulletList`、`orderedList`、`taskList`
- `listItem`、`taskItem`
- `tableCell`、`tableHeader`

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `backgroundColor` | `string` | 否 | `null` | 块背景色（仅支持预设 token，如 `var(--tt-color-highlight-blue)`） |
| `textColor` | `string` | 否 | `null` | 块级文本颜色（仅支持预设 token，如 `var(--tt-color-text-red)`） |

示例：

```json
{
  "type": "paragraph",
  "attrs": {
    "id": "p-uuid-color",
    "backgroundColor": "var(--tt-color-highlight-yellow)",
    "textColor": "var(--tt-color-text-blue)"
  },
  "content": [
    { "type": "text", "text": "带块样式的段落" }
  ]
}
```

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
| `id` | `string` | 否 | 自动生成 | Block ID（代码执行能力依赖该字段定位目标块） |
| `language` | `string` | 否 | `null` | 编程语言 |
| `renderer` | `string` | 否 | `"auto"` | 渲染器 ID |
| `preview` | `boolean` | 否 | `false` | 是否预览模式 |
| `view_mode` | `"text" \| "preview" \| "split"` | 否 | `"text"` | 显示模式 |
| `collapsed` | `boolean` | 否 | `false` | 是否折叠 |

### 内容

只能包含纯文本节点（无 marks）。

### 常用语言值

`javascript`, `typescript`, `python`, `go`, `rust`, `java`, `json`, `yaml`, `markdown`, `sql`, `bash`, `html`, `css`

### 代码执行约束

- 可执行语言白名单：`python`、`javascript`、`typescript`、`bash`
- 执行请求必须携带当前块 `id`、`language`、`code`
- 执行状态（如运行中、最近状态、最近 runId）为运行时 UI 状态，不写回文档 JSON

### 示例

```json
{
  "type": "codeBlock",
  "attrs": {
    "id": "cb-uuid-001",
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

---

## math

数学公式节点，使用 KaTeX 渲染。支持内联和块级两种模式。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `latex` | `string` | 是 | `""` | LaTeX 公式内容 |
| `display` | `boolean` | 否 | `false` | 是否为块级显示模式 |

### 内容

无内容（原子节点）。

### 输入规则

- 内联公式：`$公式$`
- 块级公式：`$$公式$$`

### 快捷键

- `Cmd/Ctrl+Shift+m`：插入内联公式
- `Cmd/Ctrl+Shift+M`：插入块级公式

### 示例

内联公式：

```json
{
  "type": "math",
  "attrs": {
    "latex": "E = mc^2",
    "display": false
  }
}
```

块级公式：

```json
{
  "type": "math",
  "attrs": {
    "latex": "\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}",
    "display": true
  }
}
```

---

## music

乐谱节点，使用 ABC Notation 格式，通过 abcjs 渲染。支持内联和块级两种模式。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `abc` | `string` | 是 | `""` | ABC Notation 乐谱内容 |
| `display` | `boolean` | 否 | `false` | 是否为块级显示模式 |

### 内容

无内容（原子节点）。

### 输入规则

- 内联乐谱：`~abc:乐谱~`
- 块级乐谱：在 Markdown 中使用 ` ```abc ` 代码块

### 快捷键

- `Cmd/Ctrl+Shift+u`：插入内联乐谱
- `Cmd/Ctrl+Shift+U`：插入块级乐谱

### 示例

内联乐谱：

```json
{
  "type": "music",
  "attrs": {
    "abc": "CDEF GABc",
    "display": false
  }
}
```

块级乐谱：

```json
{
  "type": "music",
  "attrs": {
    "abc": "X:1\nT:示例曲目\nM:4/4\nK:C\nCDEF GABc|c2 B2 A2 G2|",
    "display": true
  }
}
```

---

## chart

图表节点，使用 ECharts 渲染。支持简化模式（向导式）和高级模式（JSON 编辑）。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `options` | `string` | 否 | `""` | ECharts 配置 JSON 字符串 |
| `chartType` | `"bar" \| "line" \| "pie" \| "scatter" \| "radar" \| "funnel"` | 否 | `"bar"` | 图表类型 |
| `simpleData` | `string` | 否 | 默认数据 | 简化模式的数据 JSON |
| `mode` | `"simple" \| "advanced"` | 否 | `"simple"` | 编辑模式 |
| `width` | `number` | 否 | `100` | 宽度百分比 |
| `height` | `number` | 否 | `300` | 高度像素值 |

### 内容

无内容（原子节点）。

### 图表类型

- `bar`：柱状图
- `line`：折线图
- `pie`：饼图
- `scatter`：散点图
- `radar`：雷达图
- `funnel`：漏斗图

### 输入规则

- ` ```chart `：插入默认柱状图

### 快捷键

- `Cmd/Ctrl+Shift+c`：插入柱状图

### simpleData 格式

简化模式数据遵循以下结构：

```json
{
  "labels": ["类别A", "类别B", "类别C"],
  "datasets": [
    { "name": "系列1", "values": [120, 200, 150] },
    { "name": "系列2", "values": [80, 120, 90] }
  ]
}
```

### 示例

简化模式柱状图：

```json
{
  "type": "chart",
  "attrs": {
    "chartType": "bar",
    "mode": "simple",
    "simpleData": "{\"labels\":[\"A\",\"B\",\"C\"],\"datasets\":[{\"name\":\"数据\",\"values\":[120,200,150]}]}",
    "options": "",
    "width": 100,
    "height": 300
  }
}
```

高级模式（自定义 ECharts 配置）：

```json
{
  "type": "chart",
  "attrs": {
    "chartType": "bar",
    "mode": "advanced",
    "simpleData": "",
    "options": "{\"xAxis\":{\"type\":\"category\",\"data\":[\"Mon\",\"Tue\",\"Wed\"]},\"yAxis\":{\"type\":\"value\"},\"series\":[{\"data\":[120,200,150],\"type\":\"bar\"}]}",
    "width": 100,
    "height": 400
  }
}
```

---

## mindmap

脑图节点，使用 ECharts tree 渲染。支持大纲模式（树形编辑）和文本模式（缩进文本编辑）。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `data` | `string` | 否 | 默认树数据 | 脑图树结构 JSON 字符串 |
| `mode` | `"outline" \| "text"` | 否 | `"outline"` | 编辑模式 |
| `layout` | `"LR" \| "TB" \| "radial"` | 否 | `"LR"` | 布局方向 |
| `height` | `number` | 否 | `400` | 高度像素值 |

### 内容

无内容（原子节点）。

### 布局方向

- `LR`：水平布局（从左到右）
- `TB`：垂直布局（从上到下）
- `radial`：辐射布局

### 输入规则

- `` ```mindmap ``：插入默认脑图

### data 格式

脑图数据遵循递归树结构：

```json
{
  "name": "中心主题",
  "children": [
    {
      "name": "分支 1",
      "children": [
        { "name": "子项 1.1" },
        { "name": "子项 1.2" }
      ]
    },
    { "name": "分支 2" }
  ]
}
```

### 示例

默认脑图：

```json
{
  "type": "mindmap",
  "attrs": {
    "data": "{\"name\":\"中心主题\",\"children\":[{\"name\":\"分支 1\",\"children\":[{\"name\":\"子项 1.1\"},{\"name\":\"子项 1.2\"}]},{\"name\":\"分支 2\",\"children\":[{\"name\":\"子项 2.1\"}]},{\"name\":\"分支 3\"}]}",
    "mode": "outline",
    "layout": "LR",
    "height": 400
  }
}
```

辐射布局脑图：

```json
{
  "type": "mindmap",
  "attrs": {
    "data": "{\"name\":\"项目规划\",\"children\":[{\"name\":\"前端\"},{\"name\":\"后端\"},{\"name\":\"测试\"},{\"name\":\"部署\"}]}",
    "mode": "outline",
    "layout": "radial",
    "height": 400
  }
}
```
