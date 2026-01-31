# Marks（内联样式）规范

## 概述

Marks 是应用于 `text` 节点的格式标记，用于实现粗体、斜体、链接等内联样式。

## Mark 结构

```typescript
interface TiptapMark {
  type: string              // Mark 类型
  attrs?: Record<string, any>  // Mark 属性（可选）
}
```

## 支持的 Marks

---

## bold

粗体文本。

### 属性

无属性。

### 示例

```json
{
  "type": "text",
  "text": "粗体文本",
  "marks": [{ "type": "bold" }]
}
```

---

## italic

斜体文本。

### 属性

无属性。

### 示例

```json
{
  "type": "text",
  "text": "斜体文本",
  "marks": [{ "type": "italic" }]
}
```

---

## strike

删除线文本。

### 属性

无属性。

### 示例

```json
{
  "type": "text",
  "text": "已删除的文本",
  "marks": [{ "type": "strike" }]
}
```

---

## code

行内代码。

### 属性

无属性。

### 示例

```json
{
  "type": "text",
  "text": "console.log()",
  "marks": [{ "type": "code" }]
}
```

---

## underline

下划线文本。

### 属性

无属性。

### 示例

```json
{
  "type": "text",
  "text": "下划线文本",
  "marks": [{ "type": "underline" }]
}
```

---

## link

超链接。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `href` | `string` | 是 | - | 链接 URL |
| `target` | `string` | 否 | `"_blank"` | 打开方式 |
| `rel` | `string` | 否 | `"noopener noreferrer nofollow"` | 关系属性 |
| `class` | `string` | 否 | `null` | CSS 类名 |

### 示例

```json
{
  "type": "text",
  "text": "访问官网",
  "marks": [
    {
      "type": "link",
      "attrs": {
        "href": "https://example.com",
        "target": "_blank"
      }
    }
  ]
}
```

---

## highlight

文本高亮。

### 属性

| 属性 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `color` | `string` | 否 | - | 高亮颜色（CSS 颜色值） |

### 常用颜色

- `#fef08a` - 黄色
- `#bbf7d0` - 绿色
- `#bfdbfe` - 蓝色
- `#fecaca` - 红色
- `#e9d5ff` - 紫色
- `#fed7aa` - 橙色

### 示例

```json
{
  "type": "text",
  "text": "高亮文本",
  "marks": [
    {
      "type": "highlight",
      "attrs": { "color": "#fef08a" }
    }
  ]
}
```

---

## superscript

上标文本。

### 属性

无属性。

### 示例

```json
{
  "type": "text",
  "text": "2",
  "marks": [{ "type": "superscript" }]
}
```

上下文示例：

```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "E = mc" },
    {
      "type": "text",
      "text": "2",
      "marks": [{ "type": "superscript" }]
    }
  ]
}
```

---

## subscript

下标文本。

### 属性

无属性。

### 示例

```json
{
  "type": "text",
  "text": "2",
  "marks": [{ "type": "subscript" }]
}
```

上下文示例：

```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "H" },
    {
      "type": "text",
      "text": "2",
      "marks": [{ "type": "subscript" }]
    },
    { "type": "text", "text": "O" }
  ]
}
```

---

## Mark 组合

多个 Marks 可以组合应用于同一个 text 节点：

### 粗斜体

```json
{
  "type": "text",
  "text": "粗斜体文本",
  "marks": [
    { "type": "bold" },
    { "type": "italic" }
  ]
}
```

### 粗体链接

```json
{
  "type": "text",
  "text": "重要链接",
  "marks": [
    { "type": "bold" },
    {
      "type": "link",
      "attrs": { "href": "https://example.com" }
    }
  ]
}
```

### 高亮代码

```json
{
  "type": "text",
  "text": "关键代码",
  "marks": [
    { "type": "code" },
    {
      "type": "highlight",
      "attrs": { "color": "#fef08a" }
    }
  ]
}
```

---

## 组合规则

1. **可自由组合**：大多数 Marks 可以相互组合
2. **互斥规则**：
   - `superscript` 和 `subscript` 不应同时使用
3. **推荐做法**：
   - 链接文本可以添加其他样式（粗体、斜体等）
   - 代码标记通常单独使用
4. **Marks 顺序**：Marks 数组的顺序不影响渲染结果

---

## 完整段落示例

```json
{
  "type": "paragraph",
  "attrs": { "id": "example-para" },
  "content": [
    { "type": "text", "text": "这是一段包含 " },
    {
      "type": "text",
      "text": "粗体",
      "marks": [{ "type": "bold" }]
    },
    { "type": "text", "text": "、" },
    {
      "type": "text",
      "text": "斜体",
      "marks": [{ "type": "italic" }]
    },
    { "type": "text", "text": "、" },
    {
      "type": "text",
      "text": "删除线",
      "marks": [{ "type": "strike" }]
    },
    { "type": "text", "text": " 和 " },
    {
      "type": "text",
      "text": "链接",
      "marks": [
        {
          "type": "link",
          "attrs": { "href": "https://example.com" }
        }
      ]
    },
    { "type": "text", "text": " 的富文本段落。" }
  ]
}
```
