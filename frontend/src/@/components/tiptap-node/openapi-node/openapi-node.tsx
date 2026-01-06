"use client"

import type { NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper } from "@tiptap/react"
import OpenApiSpecViewer from "@/components/OpenApiSpecViewer"
import "@/components/tiptap-node/openapi-node/openapi-node.scss"

export function OpenApiNodeView({ node, editor, extension }: NodeViewProps) {
  const source = String(node.attrs?.source ?? "")
  const renderer = String(node.attrs?.renderer ?? "swagger")
  const isEditable = editor.isEditable
  const projectKey = String(
    (extension?.options as { projectKey?: string } | undefined)?.projectKey ?? "",
  )

  return (
    <NodeViewWrapper className="openapi-node">
      {!isEditable ? (
        <OpenApiSpecViewer projectKey={projectKey} source={source} refType="spec" />
      ) : (
        <div className="openapi-node-card">
          <div className="openapi-node-title">OpenAPI Spec</div>
          <div className="openapi-node-row">
            <span className="openapi-node-label">Source</span>
            <span className="openapi-node-value">{source || "storage://..."}</span>
          </div>
          <div className="openapi-node-row">
            <span className="openapi-node-label">Renderer</span>
            <span className="openapi-node-value">{renderer}</span>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default OpenApiNodeView
