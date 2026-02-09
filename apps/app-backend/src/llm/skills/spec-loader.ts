/**
 * OpenSpec Document Format Loader
 *
 * Loads and builds compact system prompts from OpenSpec document format specifications.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to OpenSpec specs directory (relative to this file)
const SPEC_DIR = path.resolve(
  __dirname,
  "../../../../../../openspec/specs/document-format/specs",
);

// Cached compact spec
let cachedCompactSpec: string | null = null;

/**
 * Load and cache the compact document format specification
 */
export function loadDocumentSpec(): string {
  if (cachedCompactSpec) {
    return cachedCompactSpec;
  }

  cachedCompactSpec = buildCompactSpec();
  return cachedCompactSpec;
}

/**
 * Clear the cached spec (for testing or hot-reload)
 */
export function clearSpecCache(): void {
  cachedCompactSpec = null;
}

/**
 * Build a compact version of the spec for AI prompts
 * Reduces token usage while preserving essential information
 */
function buildCompactSpec(): string {
  return `## Zeus 文档格式规范 (Tiptap JSON)

### 文档结构
文档正文必须是 Tiptap JSON 格式：
\`\`\`json
{
  "type": "doc",
  "content": [/* 块级节点数组 */]
}
\`\`\`

### 支持的 Block 类型

#### paragraph (段落)
\`\`\`json
{
  "type": "paragraph",
  "attrs": { "id": "uuid", "textAlign": "left" },
  "content": [{ "type": "text", "text": "段落内容" }]
}
\`\`\`

#### heading (标题)
\`\`\`json
{
  "type": "heading",
  "attrs": { "level": 1, "id": "uuid" },
  "content": [{ "type": "text", "text": "标题文本" }]
}
\`\`\`
level: 1-6

#### bulletList (无序列表)
\`\`\`json
{
  "type": "bulletList",
  "content": [
    {
      "type": "listItem",
      "attrs": { "id": "uuid" },
      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "项目" }] }]
    }
  ]
}
\`\`\`

#### orderedList (有序列表)
与 bulletList 结构相同，type 为 "orderedList"

#### taskList (任务列表)
\`\`\`json
{
  "type": "taskList",
  "content": [
    {
      "type": "taskItem",
      "attrs": { "id": "uuid", "checked": false },
      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "任务" }] }]
    }
  ]
}
\`\`\`

#### blockquote (引用)
\`\`\`json
{
  "type": "blockquote",
  "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "引用内容" }] }]
}
\`\`\`

#### codeBlock (代码块)
\`\`\`json
{
  "type": "codeBlock",
  "attrs": { "id": "uuid", "language": "javascript" },
  "content": [{ "type": "text", "text": "console.log('hello');" }]
}
\`\`\`

#### horizontalRule (分割线)
\`\`\`json
{ "type": "horizontalRule" }
\`\`\`

#### image (图片)
\`\`\`json
{
  "type": "image",
  "attrs": { "id": "uuid", "src": "https://...", "alt": "描述", "title": "标题" }
}
\`\`\`

### 内联格式 (Marks)

Marks 应用于 text 节点：
\`\`\`json
{
  "type": "text",
  "text": "格式化文本",
  "marks": [{ "type": "bold" }, { "type": "italic" }]
}
\`\`\`

支持的 Marks：
- bold: 粗体
- italic: 斜体
- strike: 删除线
- code: 行内代码
- underline: 下划线
- link: 链接，attrs: { href: "url", target: "_blank" }
- highlight: 高亮，attrs: { color: "#fef08a" }
- superscript: 上标
- subscript: 下标

### 重要规则

1. body.type 必须是 "doc"
2. body.content 只能包含块级节点（不能直接放 text）
3. bulletList/orderedList 只能包含 listItem
4. taskList 只能包含 taskItem
5. listItem/taskItem 内部需要包含 paragraph 或其他块节点
6. 每个块节点建议包含 attrs.id（使用 UUID 格式）
7. text 节点的 marks 是可选的
8. 不要使用规范中未定义的节点类型

### 完整示例

\`\`\`json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1, "id": "h1" },
      "content": [{ "type": "text", "text": "文档标题" }]
    },
    {
      "type": "paragraph",
      "attrs": { "id": "p1" },
      "content": [
        { "type": "text", "text": "这是 " },
        { "type": "text", "text": "重要", "marks": [{ "type": "bold" }] },
        { "type": "text", "text": " 内容。" }
      ]
    },
    {
      "type": "bulletList",
      "content": [
        {
          "type": "listItem",
          "attrs": { "id": "li1" },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "第一项" }] }]
        },
        {
          "type": "listItem",
          "attrs": { "id": "li2" },
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "第二项" }] }]
        }
      ]
    }
  ]
}
\`\`\`
`;
}

/**
 * Build system prompt for document creation skill
 */
export function buildCreateDocumentPrompt(): string {
  const spec = loadDocumentSpec();
  return `你是 Zeus 文档助手，负责创建结构化文档。

${spec}

## 你的任务

根据用户的描述创建文档内容。请直接输出 Tiptap JSON 格式的文档正文（body 部分）。

## 输出要求

1. 严格按照上述规范输出 Tiptap JSON 格式
2. 为每个块节点生成唯一的 id（使用简短的 UUID 格式，如 "abc123"）
3. 不要输出规范中未定义的节点类型
4. 确保列表结构正确嵌套
5. 代码块需要指定 language 属性
6. 只输出 JSON，不要添加其他说明文字
7. 确保 JSON 格式正确，可以被直接解析`;
}

/**
 * Build system prompt for document editing skill
 */
export function buildEditDocumentPrompt(): string {
  const spec = loadDocumentSpec();
  return `你是 Zeus 文档助手，负责编辑和修改文档。

${spec}

## 你的任务

根据用户的修改要求，在原始文档基础上进行修改。请输出修改后的完整文档正文（body 部分）。

## 输出要求

1. 保留未修改部分的原始 id
2. 为新增的块节点生成唯一的 id
3. 严格按照规范输出 Tiptap JSON 格式
4. 只输出 JSON，不要添加其他说明文字
5. 确保 JSON 格式正确，可以被直接解析`;
}

/**
 * Build system prompt for PPT-style deck generation skill
 */
export function buildPptOptimizeDocumentPrompt(): string {
  const spec = loadDocumentSpec();
  return `你是 Zeus 文档助手。你的任务：把“源文档”改写为“类 PPT 演示稿”格式，并输出 Zeus 支持的 Tiptap JSON 文档正文（body）。

${spec}

重要：只输出 JSON（一个对象，必须是 {"type":"doc","content":[...]} 结构），不要输出任何解释文字，不要用 \`\`\` 包裹。

## 类 PPT 结构规则（强制）
1. 每一页必须以 Heading 1 开始：{"type":"heading","attrs":{"level":1,...},...}
2. 页与页之间用 horizontalRule 分隔。规则：每页内容结束后输出一个 {"type":"horizontalRule",...}；最后一页可以不输出分割线。
3. 除了每页开头的那个 Heading 1，页内不要再出现 level=1 的 heading（避免分页歧义）。
4. 优先使用：table / bulletList / orderedList / chart（仅在有明确数字对比时）。
5. 避免长段落：尽量把内容拆成要点或表格。单段落尽量 <= 80 字；单页要点尽量 <= 6 条；单页表格行数尽量 <= 8 行。
6. 不要编造源文档没有的事实、数字或结论；不确定就用“待补充/未知”占位。

## 封面页规则（第 1 页，强制）
- 只允许包含：1 个 Heading 1（整套演示稿标题） + 关键信息区块（推荐用 table 展示：报告人/时间/版本/项目等）。
- 封面页不要包含任何正文要点（不要 bulletList/orderedList/taskList，不要 codeBlock，不要长段落）。
- 关键信息不足时，使用占位符（例如“报告人：待填写”）。

## 表格使用要求（强烈建议）
当你要表达“对比、清单、状态、步骤、指标”时，优先用 table：
- table -> tableRow -> tableHeader/tableCell -> paragraph -> text
- tableHeader/tableCell 推荐带 attrs：{"colspan":1,"rowspan":1,"colwidth":null}

## 图标/符号要求（强烈建议）
在要点前添加易读的符号前缀（例如：📌 ✅ ⚠️ 🧩 ⏱️ 💡），用于强调类别（重点/结果/风险/组件/时间/建议）。

你的输出应当让人一眼像在看演示稿：标题清晰、信息密度高、结构分块明显。`;
}

/**
 * Try to load raw spec file (for debugging/advanced use)
 */
export function loadRawSpec(filename: string): string | null {
  try {
    const filePath = path.join(SPEC_DIR, filename);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
  } catch {
    // Ignore errors
  }
  return null;
}
