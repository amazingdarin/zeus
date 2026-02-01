/**
 * Markdown Conversion Utilities for Backend
 *
 * Simple markdown <-> JSON conversion without frontend dependencies.
 * Uses markdown-it for parsing and prosemirror-markdown for serialization.
 * Schema is defined directly using prosemirror-model for maximum compatibility.
 */

import MarkdownIt from "markdown-it";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import { Schema } from "prosemirror-model";
import type { JSONContent } from "@tiptap/core";
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownSerializer,
  type ParseSpec,
} from "prosemirror-markdown";

// ============================================================================
// Schema (defined directly using prosemirror-model)
// ============================================================================

let cachedSchema: Schema | null = null;

function getSimpleSchema(): Schema {
  if (cachedSchema) {
    return cachedSchema;
  }

  cachedSchema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: {
        content: "inline*",
        group: "block",
        parseDOM: [{ tag: "p" }],
        toDOM() {
          return ["p", 0];
        },
      },
      blockquote: {
        content: "block+",
        group: "block",
        parseDOM: [{ tag: "blockquote" }],
        toDOM() {
          return ["blockquote", 0];
        },
      },
      horizontalRule: {
        group: "block",
        parseDOM: [{ tag: "hr" }],
        toDOM() {
          return ["hr"];
        },
      },
      heading: {
        attrs: { level: { default: 1 } },
        content: "inline*",
        group: "block",
        defining: true,
        parseDOM: [
          { tag: "h1", attrs: { level: 1 } },
          { tag: "h2", attrs: { level: 2 } },
          { tag: "h3", attrs: { level: 3 } },
          { tag: "h4", attrs: { level: 4 } },
          { tag: "h5", attrs: { level: 5 } },
          { tag: "h6", attrs: { level: 6 } },
        ],
        toDOM(node) {
          return ["h" + node.attrs.level, 0];
        },
      },
      codeBlock: {
        attrs: { language: { default: "" } },
        content: "text*",
        marks: "",
        group: "block",
        code: true,
        defining: true,
        parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
        toDOM() {
          return ["pre", ["code", 0]];
        },
      },
      text: { group: "inline" },
      image: {
        inline: true,
        attrs: {
          src: {},
          alt: { default: null },
          title: { default: null },
        },
        group: "inline",
        draggable: true,
        parseDOM: [
          {
            tag: "img[src]",
            getAttrs(dom: HTMLElement) {
              return {
                src: dom.getAttribute("src"),
                title: dom.getAttribute("title"),
                alt: dom.getAttribute("alt"),
              };
            },
          },
        ],
        toDOM(node) {
          return ["img", node.attrs];
        },
      },
      hardBreak: {
        inline: true,
        group: "inline",
        selectable: false,
        parseDOM: [{ tag: "br" }],
        toDOM() {
          return ["br"];
        },
      },
      bulletList: {
        content: "listItem+",
        group: "block",
        parseDOM: [{ tag: "ul" }],
        toDOM() {
          return ["ul", 0];
        },
      },
      orderedList: {
        attrs: { order: { default: 1 } },
        content: "listItem+",
        group: "block",
        parseDOM: [
          {
            tag: "ol",
            getAttrs(dom: HTMLElement) {
              return { order: dom.hasAttribute("start") ? +dom.getAttribute("start")! : 1 };
            },
          },
        ],
        toDOM(node) {
          return node.attrs.order === 1 ? ["ol", 0] : ["ol", { start: node.attrs.order }, 0];
        },
      },
      listItem: {
        content: "paragraph block*",
        defining: true,
        parseDOM: [{ tag: "li" }],
        toDOM() {
          return ["li", 0];
        },
      },
      // Custom file_block node for embedded files
      file_block: {
        attrs: {
          asset_id: { default: null },
          file_name: { default: null },
          mime: { default: null },
          file_type: { default: null },
          office_type: { default: null },
          size: { default: null },
        },
        group: "block",
        atom: true,
        parseDOM: [{ tag: "div[data-file-block]" }],
        toDOM() {
          return ["div", { "data-file-block": "" }];
        },
      },
    },
    marks: {
      link: {
        attrs: {
          href: {},
          title: { default: null },
        },
        inclusive: false,
        parseDOM: [
          {
            tag: "a[href]",
            getAttrs(dom: HTMLElement) {
              return { href: dom.getAttribute("href"), title: dom.getAttribute("title") };
            },
          },
        ],
        toDOM(node) {
          return ["a", node.attrs, 0];
        },
      },
      bold: {
        parseDOM: [{ tag: "strong" }, { tag: "b" }],
        toDOM() {
          return ["strong", 0];
        },
      },
      italic: {
        parseDOM: [{ tag: "em" }, { tag: "i" }],
        toDOM() {
          return ["em", 0];
        },
      },
      strike: {
        parseDOM: [{ tag: "s" }, { tag: "del" }],
        toDOM() {
          return ["s", 0];
        },
      },
      code: {
        parseDOM: [{ tag: "code" }],
        toDOM() {
          return ["code", 0];
        },
      },
    },
  });

  return cachedSchema;
}

// ============================================================================
// Parser
// ============================================================================

let cachedParser: MarkdownParser | null = null;

function getParser(): MarkdownParser {
  if (cachedParser) {
    return cachedParser;
  }

  const schema = getSimpleSchema();
  const markdown = new MarkdownIt("commonmark", {
    html: false,
    linkify: true,
    breaks: true,
  });

  // Convert fences to code_block
  markdown.core.ruler.push("fence_to_code_block", (state) => {
    for (const token of state.tokens) {
      if (token.type === "fence") {
        token.type = "code_block";
        token.tag = "code";
      }
    }
  });

  const tokens: Record<string, ParseSpec> = {
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    list_item: { block: "listItem" },
    bullet_list: { block: "bulletList" },
    ordered_list: {
      block: "orderedList",
      getAttrs: (token: unknown) => ({
        order: Number((token as { attrGet: (name: string) => string | null }).attrGet?.("start") || 1),
      }),
    },
    heading: {
      block: "heading",
      getAttrs: (token: unknown) => ({
        level: Number((token as { tag: string }).tag?.slice(1)) || 1,
      }),
    },
    hr: { node: "horizontalRule" },
    hardbreak: { node: "hardBreak" },
    code_block: {
      block: "codeBlock",
      getAttrs: (token: unknown) => {
        const info = ((token as { info?: string }).info || "").trim();
        const language = info.split(/\s+/)[0] || "";
        return { language };
      },
    },
    image: {
      node: "image",
      getAttrs: (token: unknown) => {
        const t = token as { attrGet: (name: string) => string | null };
        return {
          src: t.attrGet?.("src") || "",
          title: t.attrGet?.("title"),
          alt: t.attrGet?.("alt"),
        };
      },
    },
    em: { mark: "italic" },
    strong: { mark: "bold" },
    s: { mark: "strike" },
    del: { mark: "strike" },
    link: {
      mark: "link",
      getAttrs: (token: unknown) => {
        const t = token as { attrGet: (name: string) => string | null };
        return {
          href: t.attrGet?.("href"),
          title: t.attrGet?.("title"),
        };
      },
    },
    code_inline: { mark: "code" },
  };

  cachedParser = new MarkdownParser(schema, markdown, tokens);
  return cachedParser;
}

// ============================================================================
// Serializer
// ============================================================================

let cachedSerializer: MarkdownSerializer | null = null;

function getSerializer(): MarkdownSerializer {
  if (cachedSerializer) {
    return cachedSerializer;
  }

  const baseNodes = defaultMarkdownSerializer.nodes as Record<string, unknown>;
  const baseMarks = defaultMarkdownSerializer.marks as Record<string, unknown>;

  cachedSerializer = new MarkdownSerializer(
    {
      paragraph: baseNodes.paragraph,
      blockquote: baseNodes.blockquote,
      heading: baseNodes.heading,
      bulletList: baseNodes.bullet_list,
      orderedList: baseNodes.ordered_list,
      listItem: baseNodes.list_item,
      horizontalRule: baseNodes.horizontal_rule,
      hardBreak: baseNodes.hard_break,
      image: baseNodes.image,
      text: baseNodes.text ?? ((state: { text: (text: string) => void }, node: { text: string }) => state.text(node.text)),
      codeBlock: (state: { write: (text: string) => void; text: (text: string, escape: boolean) => void; ensureNewLine: () => void; closeBlock: (node: ProsemirrorNode) => void }, node: ProsemirrorNode) => {
        const language = (node.attrs.language as string) || "";
        state.write(`\`\`\`${language}\n`);
        state.text(node.textContent, false);
        state.ensureNewLine();
        state.write("```");
        state.closeBlock(node);
      },
      // file_block: serialize as a file fence block
      file_block: (state: { write: (text: string) => void; closeBlock: (node: ProsemirrorNode) => void }, node: ProsemirrorNode) => {
        const attrs = node.attrs as Record<string, unknown>;
        const attrParts: string[] = [];
        if (attrs.asset_id) attrParts.push(`asset_id="${attrs.asset_id}"`);
        if (attrs.file_name) attrParts.push(`file_name="${attrs.file_name}"`);
        if (attrs.mime) attrParts.push(`mime="${attrs.mime}"`);
        if (attrs.file_type) attrParts.push(`file_type="${attrs.file_type}"`);
        if (attrs.office_type) attrParts.push(`office_type="${attrs.office_type}"`);
        if (typeof attrs.size === "number") attrParts.push(`size=${attrs.size}`);
        const attrStr = attrParts.length > 0 ? ` {${attrParts.join(" ")}}` : "";
        state.write(`\`\`\`file${attrStr}\n`);
        state.write("```");
        state.closeBlock(node);
      },
    } as Record<string, unknown>,
    {
      bold: baseMarks.strong,
      italic: baseMarks.em,
      strike: baseMarks.del,
      code: baseMarks.code,
      link: baseMarks.link,
    } as Record<string, unknown>,
  );

  return cachedSerializer;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Convert Tiptap JSON content to Markdown
 * Falls back to plain text extraction if schema conversion fails
 */
export function tiptapJsonToMarkdown(json: JSONContent): string {
  try {
    const schema = getSimpleSchema();
    const serializer = getSerializer();
    const node = schema.nodeFromJSON(json);
    return serializer.serialize(node);
  } catch (err) {
    // Fallback: extract plain text from JSON
    console.warn("[markdown] Schema conversion failed, falling back to text extraction:", err);
    return extractTextFromJson(json);
  }
}

/**
 * Extract plain text from Tiptap JSON (fallback for unsupported nodes)
 */
function extractTextFromJson(node: JSONContent, depth = 0): string {
  if (!node) return "";

  const parts: string[] = [];

  // Helper to safely get content array
  const getContentArray = (n: JSONContent): JSONContent[] => {
    if (Array.isArray(n.content)) return n.content;
    return [];
  };

  // Handle text nodes
  if (node.type === "text" && node.text) {
    return node.text;
  }

  // Handle specific block types
  if (node.type === "heading") {
    const level = (node.attrs?.level as number) || 1;
    const prefix = "#".repeat(level) + " ";
    const text = getContentArray(node).map((c) => extractTextFromJson(c, depth)).join("");
    parts.push(prefix + text);
  } else if (node.type === "paragraph") {
    const text = getContentArray(node).map((c) => extractTextFromJson(c, depth)).join("");
    parts.push(text);
  } else if (node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList") {
    const items = getContentArray(node);
    items.forEach((item, idx) => {
      const prefix = node.type === "orderedList" ? `${idx + 1}. ` : "- ";
      const text = extractTextFromJson(item, depth + 1);
      parts.push(prefix + text.trim());
    });
  } else if (node.type === "listItem" || node.type === "taskItem") {
    const text = getContentArray(node).map((c) => extractTextFromJson(c, depth)).join("\n");
    parts.push(text);
  } else if (node.type === "codeBlock") {
    const lang = (node.attrs?.language as string) || "";
    const text = getContentArray(node).map((c) => extractTextFromJson(c, depth)).join("");
    parts.push("```" + lang + "\n" + text + "\n```");
  } else if (node.type === "blockquote") {
    const text = getContentArray(node).map((c) => extractTextFromJson(c, depth)).join("\n");
    parts.push(text.split("\n").map((line) => "> " + line).join("\n"));
  } else if (node.type === "horizontalRule") {
    parts.push("---");
  } else if (node.type === "image") {
    const src = node.attrs?.src || "";
    const alt = node.attrs?.alt || "";
    parts.push(`![${alt}](${src})`);
  } else if (node.type === "hardBreak") {
    parts.push("\n");
  } else {
    // Generic handler for other nodes with content
    const contentArr = getContentArray(node);
    if (contentArr.length > 0) {
      const text = contentArr.map((c) => extractTextFromJson(c, depth)).join("\n");
      parts.push(text);
    }
  }

  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Convert Markdown to Tiptap JSON content
 */
export function markdownToTiptapJson(markdown: string): JSONContent {
  const parser = getParser();
  const doc = parser.parse(markdown);
  return doc.toJSON() as JSONContent;
}
