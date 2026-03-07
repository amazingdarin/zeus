import { useMemo } from "react"
import type { JSONContent, Editor } from "@tiptap/react"
import type { Extensions } from "@tiptap/core"
import { LinkPreviewNode } from "../nodes/link-preview-node/link-preview-node-extension"

import { DocEditor } from "./simple/doc-editor"

export interface DocViewerProps {
  content?: JSONContent | null
  extensions?: Extensions
  linkPreviewFetchHtml?: (url: string) => Promise<string>
  onEditorReady?: (editor: Editor | null) => void
  /** Callback when a task item checkbox is toggled in view mode */
  onTaskCheckChange?: (blockId: string, checked: boolean) => void
}

export function DocViewer({
  content,
  extensions = [],
  linkPreviewFetchHtml,
  onEditorReady,
  onTaskCheckChange,
}: DocViewerProps) {
  const contentKey = useMemo(() => JSON.stringify(content ?? {}), [content])
  return (
    <DocEditor
      key={contentKey}
      content={content}
      extensions={extensions}
      linkPreviewFetchHtml={linkPreviewFetchHtml}
      mode="view"
      onEditorReady={onEditorReady}
      onTaskCheckChange={onTaskCheckChange}
    />
  )
}
