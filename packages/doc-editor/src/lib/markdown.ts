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
import { createTableExtensions } from "../nodes/table-node/table-node-extension"
import { MathNode } from "../nodes/math-node/math-node-extension"
import { MusicNode } from "../nodes/music-node/music-node-extension"
import { ChartNode } from "../nodes/chart-node/chart-node-extension"

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
  MathNode,
  MusicNode,
  ChartNode,
  ...createTableExtensions(),
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
  // Use "default" preset instead of "commonmark" to enable GFM tables
  const markdown = new MarkdownIt("default", {
    html: false,
    linkify: true,
    breaks: true,
  })
  // Enable GFM tables
  markdown.enable("table")

  // Add inline math rule: $...$
  markdown.inline.ruler.after("escape", "math_inline", (state, silent) => {
    if (state.src[state.pos] !== "$") {
      return false
    }
    // Check for $$
    if (state.src[state.pos + 1] === "$") {
      return false
    }

    const start = state.pos + 1
    let end = start
    while (end < state.posMax && state.src[end] !== "$") {
      if (state.src[end] === "\\") {
        end += 2
      } else {
        end++
      }
    }

    if (end >= state.posMax || state.src[end] !== "$") {
      return false
    }

    const latex = state.src.slice(start, end)
    if (!latex.trim()) {
      return false
    }

    if (!silent) {
      const token = state.push("math_inline", "span", 0)
      token.content = latex
      token.markup = "$"
    }

    state.pos = end + 1
    return true
  })

  // Add block math rule: $$...$$
  markdown.block.ruler.before("fence", "math_block", (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]

    if (pos + 2 > max) {
      return false
    }
    if (state.src.slice(pos, pos + 2) !== "$$") {
      return false
    }

    // Find closing $$
    let nextLine = startLine
    let content = ""

    // Check if it's a single-line block: $$...$$ on same line
    const restOfLine = state.src.slice(pos + 2, max).trim()
    if (restOfLine.endsWith("$$") && restOfLine.length > 2) {
      content = restOfLine.slice(0, -2)
      nextLine = startLine + 1
    } else {
      // Multi-line block
      nextLine = startLine + 1
      while (nextLine < endLine) {
        const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
        const lineEnd = state.eMarks[nextLine]
        const line = state.src.slice(lineStart, lineEnd)

        if (line.trim() === "$$") {
          break
        }
        content += (content ? "\n" : "") + line
        nextLine++
      }

      if (nextLine >= endLine) {
        return false
      }
      nextLine++
    }

    if (silent) {
      return true
    }

    const token = state.push("math_block", "div", 0)
    token.content = content.trim()
    token.markup = "$$"
    token.map = [startLine, nextLine]

    state.line = nextLine
    return true
  })

  // Add inline music rule: ~abc:...~
  markdown.inline.ruler.after("escape", "music_inline", (state, silent) => {
    if (state.src[state.pos] !== "~") {
      return false
    }
    // Check for ~abc:
    if (state.src.slice(state.pos, state.pos + 5) !== "~abc:") {
      return false
    }

    const start = state.pos + 5
    let end = start
    while (end < state.posMax && state.src[end] !== "~") {
      if (state.src[end] === "\\") {
        end += 2
      } else {
        end++
      }
    }

    if (end >= state.posMax || state.src[end] !== "~") {
      return false
    }

    const abc = state.src.slice(start, end)
    if (!abc.trim()) {
      return false
    }

    if (!silent) {
      const token = state.push("music_inline", "span", 0)
      token.content = abc
      token.markup = "~abc:"
    }

    state.pos = end + 1
    return true
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
      // Handle ABC music notation blocks
      if (language === "abc") {
        token.type = "music_block"
        token.tag = "div"
        continue
      }
      // Handle ECharts chart blocks
      if (language === "echarts") {
        token.type = "chart_block"
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
    // Math tokens
    math_inline: {
      node: "math",
      getAttrs: (token: any) => ({
        latex: token.content,
        display: false,
      }),
    },
    math_block: {
      node: "math",
      getAttrs: (token: any) => ({
        latex: token.content,
        display: true,
      }),
    },
    // Music tokens
    music_inline: {
      node: "music",
      getAttrs: (token: any) => ({
        abc: token.content,
        display: false,
      }),
    },
    music_block: {
      node: "music",
      noCloseToken: true,
      getAttrs: (token: any) => ({
        abc: token.content,
        display: true,
      }),
    },
    // Chart tokens
    chart_block: {
      node: "chart",
      noCloseToken: true,
      getAttrs: (token: any) => ({
        options: token.content,
        mode: "advanced",
        chartType: "bar",
        simpleData: "",
        width: 100,
        height: 300,
      }),
    },
    // Table tokens
    table: { block: "table" },
    thead: { ignore: true }, // thead/tbody are structural, content goes in rows
    tbody: { ignore: true },
    tr: { block: "tableRow" },
    th: {
      block: "tableHeader",
      getAttrs: (token: any) => ({
        colspan: Number(token.attrGet("colspan")) || 1,
        rowspan: Number(token.attrGet("rowspan")) || 1,
        colwidth: null,
      }),
    },
    td: {
      block: "tableCell",
      getAttrs: (token: any) => ({
        colspan: Number(token.attrGet("colspan")) || 1,
        rowspan: Number(token.attrGet("rowspan")) || 1,
        colwidth: null,
      }),
    },
  }

  return new MarkdownParser(schema, markdown, tokens)
}

/**
 * Serialize cell content to plain text for markdown table
 */
const serializeCellContent = (cell: any): string => {
  let text = ""
  cell.forEach((child: any) => {
    if (child.isText) {
      text += child.text || ""
    } else if (child.type.name === "paragraph") {
      child.forEach((inline: any) => {
        if (inline.isText) {
          text += inline.text || ""
        }
      })
    } else {
      // For other block types, recursively get text content
      text += child.textContent || ""
    }
  })
  // Escape pipe characters in cell content
  return text.replace(/\|/g, "\\|").trim()
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
      horizontalRule: (state: any, node: any) => {
        state.write("---")
        state.closeBlock(node)
      },
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
      // Table serializers
      table: (state: any, node: any) => {
        // Collect all rows and cells to compute column widths
        const rows: string[][] = []
        const isHeaderRow: boolean[] = []

        node.forEach((row: any) => {
          const cells: string[] = []
          let hasHeader = false
          row.forEach((cell: any) => {
            // Serialize cell content to string
            const cellContent = serializeCellContent(cell)
            cells.push(cellContent)
            if (cell.type.name === "tableHeader") {
              hasHeader = true
            }
          })
          rows.push(cells)
          isHeaderRow.push(hasHeader)
        })

        if (rows.length === 0) {
          state.closeBlock(node)
          return
        }

        // Calculate column widths
        const colCount = Math.max(...rows.map((r) => r.length))
        const colWidths = new Array(colCount).fill(3)
        for (const row of rows) {
          for (let i = 0; i < row.length; i++) {
            colWidths[i] = Math.max(colWidths[i], row[i].length)
          }
        }

        // Write table
        for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
          const row = rows[rowIdx]
          const cells = row.map((cell, i) => cell.padEnd(colWidths[i]))
          state.write(`| ${cells.join(" | ")} |\n`)

          // Write separator after header row
          if (isHeaderRow[rowIdx] && (rowIdx === 0 || !isHeaderRow[rowIdx - 1])) {
            const separator = colWidths.map((w) => "-".repeat(w))
            state.write(`| ${separator.join(" | ")} |\n`)
          }
        }

        state.closeBlock(node)
      },
      tableRow: () => {
        // Handled by table serializer
      },
      tableHeader: () => {
        // Handled by table serializer
      },
      tableCell: () => {
        // Handled by table serializer
      },
      // Math serializer
      math: (state: any, node: any) => {
        const latex = node.attrs.latex || ""
        const display = node.attrs.display || false
        if (display) {
          // Block math
          state.write("$$\n")
          state.write(latex)
          state.ensureNewLine()
          state.write("$$")
          state.closeBlock(node)
        } else {
          // Inline math
          state.write(`$${latex}$`)
        }
      },
      // Music serializer
      music: (state: any, node: any) => {
        const abc = node.attrs.abc || ""
        const display = node.attrs.display || false
        if (display) {
          // Block music
          state.write("```abc\n")
          state.write(abc)
          state.ensureNewLine()
          state.write("```")
          state.closeBlock(node)
        } else {
          // Inline music
          state.write(`~abc:${abc}~`)
        }
      },
      // Chart serializer
      chart: (state: any, node: any) => {
        const options = node.attrs.options || ""
        // If options is set, use it directly
        // Otherwise, serialize from simpleData (though typically options should be computed)
        const content = options || "{}"
        state.write("```echarts\n")
        state.write(content)
        state.ensureNewLine()
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
