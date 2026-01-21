import { mergeAttributes, Node } from "@tiptap/react"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { OpenApiRefNodeView } from "./openapi-ref-node"
import type { OpenApiSourceType } from "../openapi-node/openapi-node-extension"

export type OpenApiRefAttrs = {
  source?: string
  source_type?: OpenApiSourceType
  ref_type?: "spec" | "module" | "endpoint" | string
  ref?: {
    tag?: string
    path?: string
    method?: string
  }
}

export type OpenApiRefOptions = {
  projectKey?: string
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>
}

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    openapi_ref: {
      insertOpenAPIRef: (attrs: OpenApiRefAttrs) => ReturnType
    }
  }
}

export const OpenApiRefNode = Node.create<OpenApiRefOptions>({
  name: "openapi_ref",

  group: "block",

  atom: true,

  draggable: true,

  selectable: true,

  addOptions() {
    return {
      projectKey: "",
      fetcher: undefined,
    }
  },

  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-source") ?? "",
        renderHTML: (attrs) => ({
          "data-source": attrs.source ?? "",
        }),
      },
      source_type: {
        default: "url",
        parseHTML: (element) => element.getAttribute("data-source-type") ?? "url",
        renderHTML: (attrs) => ({
          "data-source-type": attrs.source_type ?? "url",
        }),
      },
      ref_type: {
        default: "spec",
        parseHTML: (element) => element.getAttribute("data-ref-type") ?? "spec",
        renderHTML: (attrs) => ({
          "data-ref-type": attrs.ref_type ?? "spec",
        }),
      },
      ref: {
        default: {},
        parseHTML: (element) => {
          const raw = element.getAttribute("data-ref") ?? ""
          if (!raw) {
            return {}
          }
          try {
            const parsed = JSON.parse(raw)
            return typeof parsed === "object" && parsed ? parsed : {}
          } catch {
            return {}
          }
        },
        renderHTML: (attrs) => ({
          "data-ref": JSON.stringify(attrs.ref ?? {}),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="openapi-ref"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "openapi-ref" }, HTMLAttributes),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(OpenApiRefNodeView)
  },

  addCommands() {
    return {
      insertOpenAPIRef:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          })
        },
    }
  },
})

export default OpenApiRefNode
