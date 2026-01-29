import { useMemo } from "react"
import type { JSONContent } from "@tiptap/react"
import type { Extensions } from "@tiptap/core"
import { LinkPreviewNode } from "../nodes/link-preview-node/link-preview-node-extension"

import { DocEditor } from "./simple/doc-editor"

export interface DocViewerProps {
  content?: JSONContent | null
  extensions?: Extensions
  linkPreviewFetchHtml?: (url: string) => Promise<string>
}

export function DocViewer({
  content,
  extensions = [],
  linkPreviewFetchHtml,
}: DocViewerProps) {
  const contentKey = useMemo(() => JSON.stringify(content ?? {}), [content])
  return (
    <DocEditor
      key={contentKey}
      content={content}
      extensions={extensions}
      linkPreviewFetchHtml={linkPreviewFetchHtml}
      mode="view"
    />
  )
}
