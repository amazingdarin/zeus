import type { JSONContent } from "@tiptap/react"
import type { Extensions } from "@tiptap/core"

import { DocEditor } from "./simple/doc-editor"

export interface DocViewerProps {
  content?: JSONContent | null
  extensions?: Extensions
}

export function DocViewer({ content, extensions = [] }: DocViewerProps) {
  return <DocEditor content={content} extensions={extensions} mode="view" />
}
