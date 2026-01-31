/**
 * Markdown Conversion Utilities for Backend
 *
 * Simple markdown <-> JSON conversion without frontend dependencies.
 * Uses markdown-it for parsing and prosemirror-markdown for serialization.
 */

import MarkdownIt from "markdown-it";
import type { Node as ProsemirrorNode, Schema } from "prosemirror-model";
import { getSchema } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownSerializer,
  type ParseSpec,
} from "prosemirror-markdown";

// ============================================================================
// Schema (simplified - no SCSS-dependent extensions)
// ============================================================================

const SIMPLE_EXTENSIONS = [
  StarterKit,
  Image,
];

let cachedSchema: Schema | null = null;

function getSimpleSchema(): Schema {
  if (!cachedSchema) {
    cachedSchema = getSchema(SIMPLE_EXTENSIONS);
  }
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
 */
export function tiptapJsonToMarkdown(json: JSONContent): string {
  const schema = getSimpleSchema();
  const serializer = getSerializer();
  const node = schema.nodeFromJSON(json);
  return serializer.serialize(node);
}

/**
 * Convert Markdown to Tiptap JSON content
 */
export function markdownToTiptapJson(markdown: string): JSONContent {
  const parser = getParser();
  const doc = parser.parse(markdown);
  return doc.toJSON() as JSONContent;
}
