import { ReactNodeViewRenderer } from "@tiptap/react"
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import type { CodeBlockLowlightOptions } from "@tiptap/extension-code-block-lowlight"
import { common, createLowlight } from "lowlight"
import type { ReactNode } from "react"

import { CodeBlockNodeView } from "./code-block-node"

export type CodeBlockRenderer = {
  id: string
  label: string
  match?: (args: { language?: string; code: string; attrs: Record<string, unknown> }) => boolean
  render: (args: {
    code: string
    language?: string
    attrs: Record<string, unknown>
    mode: "edit" | "view"
    fetcher?: (url: string, init?: RequestInit) => Promise<Response>
    projectKey?: string
  }) => ReactNode
}

export type CodeBlockNodeOptions = CodeBlockLowlightOptions & {
  renderers?: CodeBlockRenderer[]
  defaultRenderer?: "auto" | string
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>
  projectKey?: string
}

const defaultLowlight = createLowlight(common)

export const CodeBlockNode = CodeBlockLowlight.extend<CodeBlockNodeOptions>({
  addOptions() {
    const parentOptions = this.parent?.()
    const options: CodeBlockNodeOptions = {
      lowlight: defaultLowlight,
      languageClassPrefix: parentOptions?.languageClassPrefix ?? "language-",
      exitOnTripleEnter: parentOptions?.exitOnTripleEnter ?? true,
      exitOnArrowDown: parentOptions?.exitOnArrowDown ?? true,
      defaultLanguage: parentOptions?.defaultLanguage ?? null,
      enableTabIndentation: parentOptions?.enableTabIndentation ?? false,
      tabSize: parentOptions?.tabSize ?? 4,
      HTMLAttributes: parentOptions?.HTMLAttributes ?? {},
      renderers: parentOptions?.renderers ?? [],
      defaultRenderer: parentOptions?.defaultRenderer ?? "auto",
      fetcher: parentOptions?.fetcher,
      projectKey: parentOptions?.projectKey ?? "",
    }
    return options
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      renderer: {
        default: "auto",
      },
      preview: {
        default: false,
      },
      view_mode: {
        default: "text",
      },
      collapsed: {
        default: false,
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView)
  },
})

export default CodeBlockNode
