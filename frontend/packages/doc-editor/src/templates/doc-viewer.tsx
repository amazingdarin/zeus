import type { Extension, JSONContent } from "@tiptap/react"

import { DocEditor } from "./simple/doc-editor"

export interface DocViewerProps {
  content?: JSONContent | null
  extensions?: Extension[]
}

export function DocViewer({ content, extensions = [] }: DocViewerProps) {
  return <DocEditor content={content} extensions={extensions} mode="view" />
}
