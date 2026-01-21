import { mergeAttributes, Node } from "@tiptap/react"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { OpenApiNodeView } from "./openapi-node"

export type OpenApiSourceType = "url" | "json" | "yaml"

export type OpenApiNodeAttrs = {
  source?: string
  source_type?: OpenApiSourceType
  renderer?: "swagger" | "redoc" | string
}

export type OpenApiNodeOptions = {
  projectKey?: string
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>
}

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    openapi: {
      insertOpenAPI: (attrs: OpenApiNodeAttrs) => ReturnType
    }
  }
}

export const OpenApiNode = Node.create<OpenApiNodeOptions>({
  name: "openapi",

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
      renderer: {
        default: "swagger",
        parseHTML: (element) => element.getAttribute("data-renderer") ?? "swagger",
        renderHTML: (attrs) => ({
          "data-renderer": attrs.renderer ?? "swagger",
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="openapi"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "openapi" }, HTMLAttributes),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(OpenApiNodeView)
  },

  addCommands() {
    return {
      insertOpenAPI:
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

export default OpenApiNode
