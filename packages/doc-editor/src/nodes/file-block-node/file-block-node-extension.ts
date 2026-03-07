import { mergeAttributes, Node } from "@tiptap/react"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { FileBlockNodeView } from "./file-block-node"

export type FileBlockAttrs = {
  asset_id?: string
  file_name?: string
  mime?: string
  size?: number
  file_type?: "office" | "text" | "audio" | "video" | "unknown" | string
  office_type?: "docx" | "xlsx" | "pptx" | "pdf" | string
}

export type FileBlockUploadResult = {
  asset_id: string
  file_name: string
  mime: string
  size: number
}

export type FileBlockNodeOptions = {
  projectKey?: string
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>
  uploadFile?: (file: File) => Promise<FileBlockUploadResult>
  resolveAssetUrl?: (projectKey: string, assetId: string) => string
  maxTextBytes?: number
  accept?: string
}

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    file_block: {
      insertFileBlock: (attrs?: FileBlockAttrs) => ReturnType
    }
  }
}

export const FileBlockNode = Node.create<FileBlockNodeOptions>({
  name: "file_block",

  group: "block",

  atom: true,

  draggable: true,

  selectable: true,

  addOptions() {
    return {
      projectKey: "",
      fetcher: undefined,
      uploadFile: undefined,
      resolveAssetUrl: undefined,
      maxTextBytes: 200 * 1024,
      accept: "",
    }
  },

  addAttributes() {
    return {
      asset_id: {
        default: "",
      },
      file_name: {
        default: "",
      },
      mime: {
        default: "",
      },
      size: {
        default: 0,
      },
      file_type: {
        default: "",
      },
      office_type: {
        default: "",
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="file-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "file-block" }, HTMLAttributes),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileBlockNodeView)
  },

  addCommands() {
    return {
      insertFileBlock:
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

export default FileBlockNode
