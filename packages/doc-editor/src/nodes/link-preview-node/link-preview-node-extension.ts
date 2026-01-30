import { mergeAttributes } from "@tiptap/core"
import { Node } from "@tiptap/react"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { LinkPreviewNodeView } from "./link-preview-node"

export type LinkPreviewStatus = "idle" | "loading" | "success" | "error"

export type LinkPreviewAttrs = {
  url?: string
  title?: string
  description?: string
  image?: string
  site_name?: string
  fetched_at?: string
  status?: LinkPreviewStatus
  error_message?: string
}

export type LinkPreviewNodeOptions = {
  fetchHtml?: (url: string) => Promise<string>
}

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    linkPreview: {
      insertLinkPreview: (attrs: LinkPreviewAttrs) => ReturnType
    }
  }
}

export const LinkPreviewNode = Node.create<LinkPreviewNodeOptions>({
  name: "link_preview",

  group: "block",

  atom: true,

  draggable: true,

  selectable: true,

  addOptions() {
    return {
      fetchHtml: undefined,
    }
  },

  addAttributes() {
    return {
      url: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-url") ?? "",
        renderHTML: (attrs) => ({ "data-url": attrs.url ?? "" }),
      },
      title: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-title") ?? "",
        renderHTML: (attrs) => ({ "data-title": attrs.title ?? "" }),
      },
      description: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-description") ?? "",
        renderHTML: (attrs) => ({ "data-description": attrs.description ?? "" }),
      },
      image: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-image") ?? "",
        renderHTML: (attrs) => ({ "data-image": attrs.image ?? "" }),
      },
      site_name: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-site-name") ?? "",
        renderHTML: (attrs) => ({ "data-site-name": attrs.site_name ?? "" }),
      },
      fetched_at: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-fetched-at") ?? "",
        renderHTML: (attrs) => ({ "data-fetched-at": attrs.fetched_at ?? "" }),
      },
      status: {
        default: "idle",
        parseHTML: (element) => element.getAttribute("data-status") ?? "idle",
        renderHTML: (attrs) => ({ "data-status": attrs.status ?? "idle" }),
      },
      error_message: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-error") ?? "",
        renderHTML: (attrs) => ({ "data-error": attrs.error_message ?? "" }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="link-preview"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "link-preview" }, HTMLAttributes),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinkPreviewNodeView)
  },

  addCommands() {
    return {
      insertLinkPreview:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    }
  },
})

export default LinkPreviewNode
