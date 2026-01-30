import MarkdownIt from "markdown-it"
import type { Extensions } from "@tiptap/core"
import { getSchema } from "@tiptap/core"
import type { JSONContent } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import { Image } from "@tiptap/extension-image"
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownSerializer,
  type ParseSpec,
} from "prosemirror-markdown"

import { CodeBlockNode } from "../nodes/code-block-node/code-block-node-extension"
import { FileBlockNode } from "../nodes/file-block-node/file-block-node-extension"
import { HorizontalRule } from "../nodes/horizontal-rule-node/horizontal-rule-node-extension"

export type MarkdownConversionOptions = {
  extensions?: Extensions
}

type FenceInfo = {
  language: string
  attrs: Record<string, unknown>
}

const DEFAULT_EXTENSIONS: Extensions = [
  StarterKit.configure({
    horizontalRule: false,
    codeBlock: false,
  }),
  HorizontalRule,
  CodeBlockNode,
  Image,
  FileBlockNode,
]

const ATTR_PAIR_REGEX = /([a-zA-Z0-9_-]+)\s*=\s*("[^"]*"|'[^']*'|[^,\s}]+)/g

export const markdownToTiptapJson = (
  markdown: string,
  options: MarkdownConversionOptions = {},
): JSONContent => {
  const schema = createMarkdownSchema(options.extensions)
  const parser = createMarkdownParser(schema)
  const content = parser.parse(markdown)
  return content.toJSON() as JSONContent
}

export const tiptapJsonToMarkdown = (
  json: JSONContent,
  options: MarkdownConversionOptions = {},
): string => {
  const schema = createMarkdownSchema(options.extensions)
  const serializer = createMarkdownSerializer(schema)
  const node = schema.nodeFromJSON(json)
  return serializer.serialize(node)
}

const createMarkdownSchema = (extensions?: Extensions) => {
  return getSchema([...(extensions ?? DEFAULT_EXTENSIONS)])
}

const createMarkdownParser = (schema: ReturnType<typeof createMarkdownSchema>) => {
  const markdown = new MarkdownIt("commonmark", {
    html: false,
    linkify: true,
    breaks: true,
  })

  markdown.core.ruler.push("file_block_fence", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "fence") {
        continue
      }
      const { language } = parseFenceInfo(token.info || "")
      if (language === "file") {
        token.type = "file_block"
        token.tag = "div"
        continue
      }
      token.type = "code_block"
      token.tag = "code"
    }
  })

  const tokens: Record<string, ParseSpec> = {
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    list_item: { block: "listItem" },
    bullet_list: { block: "bulletList" },
    ordered_list: {
      block: "orderedList",
      getAttrs: (token: any) => ({
        order: Number(token.attrGet("start") || 1),
      }),
    },
    heading: {
      block: "heading",
      getAttrs: (token: any) => ({
        level: Number(token.tag.slice(1)) || 1,
      }),
    },
    hr: { node: "horizontalRule" },
    hardbreak: { node: "hardBreak" },
    code_block: {
      block: "codeBlock",
      getAttrs: (token: any) => {
        const { language, attrs } = parseFenceInfo(token.info || "")
        return buildCodeBlockAttrs(language, attrs)
      },
    },
    file_block: {
      node: "file_block",
      noCloseToken: true,
      getAttrs: (token: any) => {
        const { attrs } = parseFenceInfo(token.info || "")
        return buildFileBlockAttrs(attrs)
      },
    },
    image: {
      node: "image",
      getAttrs: (token: any) => ({
        src: token.attrGet("src") || "",
        title: token.attrGet("title"),
        alt: token.attrGet("alt"),
      }),
    },
    em: { mark: "italic" },
    strong: { mark: "bold" },
    s: { mark: "strike" },
    del: { mark: "strike" },
    link: {
      mark: "link",
      getAttrs: (token: any) => ({
        href: token.attrGet("href"),
        title: token.attrGet("title"),
      }),
    },
    code_inline: { mark: "code" },
  }

  return new MarkdownParser(schema, markdown, tokens)
}

const createMarkdownSerializer = (_schema: ReturnType<typeof createMarkdownSchema>) => {
  const baseNodes = defaultMarkdownSerializer.nodes as Record<string, any>
  const baseMarks = defaultMarkdownSerializer.marks as Record<string, any>

  return new MarkdownSerializer(
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
      text: baseNodes.text ?? ((state: any, node: any) => state.text(node.text)),
      codeBlock: (state: any, node: any) => {
        const language = (node.attrs.language as string) || ""
        const attrs = buildCodeBlockAttrString(node.attrs)
        const info = `${language}${attrs ? ` ${attrs}` : ""}`.trim()
        state.write(`\`\`\`${info}\n`)
        state.text(node.textContent, false)
        state.ensureNewLine()
        state.write("```")
        state.closeBlock(node)
      },
      file_block: (state: any, node: any) => {
        const attrs = buildFileBlockAttrString(node.attrs)
        const info = `file${attrs ? ` ${attrs}` : ""}`
        state.write(`\`\`\`${info}\n`)
        state.write("```")
        state.closeBlock(node)
      },
    },
    {
      bold: baseMarks.strong,
      italic: baseMarks.em,
      strike: baseMarks.del,
      code: baseMarks.code,
      link: baseMarks.link,
    },
  )
}

const parseFenceInfo = (info: string): FenceInfo => {
  const trimmed = info.trim()
  if (!trimmed) {
    return { language: "", attrs: {} }
  }
  const match = /^([^\s{]+)?\s*(?:\{(.*)\})?$/.exec(trimmed)
  const language = match?.[1]?.trim() ?? ""
  const attrsText = match?.[2]?.trim() ?? ""
  return { language, attrs: parseAttrs(attrsText) }
}

const parseAttrs = (input: string): Record<string, unknown> => {
  if (!input) {
    return {}
  }
  const attrs: Record<string, unknown> = {}
  let match: RegExpExecArray | null
  while ((match = ATTR_PAIR_REGEX.exec(input))) {
    const key = match[1]
    const rawValue = match[2]
    attrs[key] = coerceAttrValue(rawValue)
  }
  return attrs
}

const coerceAttrValue = (value: string): unknown => {
  const trimmed = value.trim()
  const unquoted = trimmed.replace(/^['"]|['"]$/g, "")
  if (unquoted === "true") {
    return true
  }
  if (unquoted === "false") {
    return false
  }
  if (/^-?\d+$/.test(unquoted)) {
    return Number(unquoted)
  }
  return unquoted
}

const buildCodeBlockAttrs = (language: string, attrs: Record<string, unknown>) => {
  const result: Record<string, unknown> = {}
  if (language) {
    result.language = language
  }
  if (typeof attrs.renderer === "string" && attrs.renderer) {
    result.renderer = attrs.renderer
  }
  const viewMode =
    typeof attrs.view_mode === "string"
      ? attrs.view_mode
      : typeof attrs.view === "string"
        ? attrs.view
        : ""
  if (viewMode) {
    result.view_mode = viewMode
    result.preview = viewMode !== "text"
  }
  if (typeof attrs.collapsed === "boolean") {
    result.collapsed = attrs.collapsed
  }
  if (typeof attrs.preview === "boolean" && result.view_mode == null) {
    result.preview = attrs.preview
  }
  return result
}

const buildFileBlockAttrs = (attrs: Record<string, unknown>) => {
  const result: Record<string, unknown> = {}
  if (typeof attrs.asset_id === "string") {
    result.asset_id = attrs.asset_id
  }
  if (typeof attrs.file_name === "string") {
    result.file_name = attrs.file_name
  }
  if (typeof attrs.mime === "string") {
    result.mime = attrs.mime
  }
  if (typeof attrs.file_type === "string") {
    result.file_type = attrs.file_type
  }
  if (typeof attrs.office_type === "string") {
    result.office_type = attrs.office_type
  }
  if (typeof attrs.size === "number" && Number.isFinite(attrs.size)) {
    result.size = attrs.size
  }
  return result
}

const buildCodeBlockAttrString = (attrs: Record<string, unknown>) => {
  const entries: Array<[string, unknown]> = []
  if (typeof attrs.renderer === "string" && attrs.renderer && attrs.renderer !== "auto") {
    entries.push(["renderer", attrs.renderer])
  }
  if (typeof attrs.view_mode === "string" && attrs.view_mode && attrs.view_mode !== "text") {
    entries.push(["view", attrs.view_mode])
  }
  if (attrs.collapsed === true) {
    entries.push(["collapsed", true])
  }
  if (attrs.preview === true && !entries.some(([key]) => key === "view")) {
    entries.push(["preview", true])
  }
  return formatAttrBlock(entries)
}

const buildFileBlockAttrString = (attrs: Record<string, unknown>) => {
  const entries: Array<[string, unknown]> = []
  if (typeof attrs.asset_id === "string" && attrs.asset_id) {
    entries.push(["asset_id", attrs.asset_id])
  }
  if (typeof attrs.file_name === "string" && attrs.file_name) {
    entries.push(["file_name", attrs.file_name])
  }
  if (typeof attrs.mime === "string" && attrs.mime) {
    entries.push(["mime", attrs.mime])
  }
  if (typeof attrs.size === "number" && Number.isFinite(attrs.size)) {
    entries.push(["size", attrs.size])
  }
  if (typeof attrs.file_type === "string" && attrs.file_type) {
    entries.push(["file_type", attrs.file_type])
  }
  if (typeof attrs.office_type === "string" && attrs.office_type) {
    entries.push(["office_type", attrs.office_type])
  }
  return formatAttrBlock(entries)
}

const formatAttrBlock = (entries: Array<[string, unknown]>): string => {
  if (!entries.length) {
    return ""
  }
  const parts = entries.map(([key, value]) => `${key}=${formatAttrValue(value)}`)
  return `{${parts.join(" ")}}`
}

const formatAttrValue = (value: unknown): string => {
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }
  const text = String(value ?? "")
  const escaped = text.replace(/"/g, "\\\"")
  return `"${escaped}"`
}
