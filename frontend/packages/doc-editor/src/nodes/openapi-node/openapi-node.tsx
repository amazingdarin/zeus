"use client"

import { useEffect, useState, type ChangeEvent } from "react"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper } from "@tiptap/react"
import OpenApiSpecViewer from "../../viewer/OpenApiSpecViewer"
import type { OpenApiSourceType } from "./openapi-node-extension"
import "./openapi-node.scss"

const DEFAULT_FETCHER: (url: string, init?: RequestInit) => Promise<Response> = (
  url,
  init
) => fetch(url, init)

export function OpenApiNodeView({ node, editor, extension, getPos }: NodeViewProps) {
  const source = String(node.attrs?.source ?? "")
  const sourceType = String(node.attrs?.source_type ?? "url") as OpenApiSourceType
  const renderer = String(node.attrs?.renderer ?? "swagger")
  const isEditable = editor.isEditable
  const options = extension?.options as
    | { projectKey?: string; fetcher?: (url: string, init?: RequestInit) => Promise<Response> }
    | undefined
  const projectKey = String(options?.projectKey ?? "")
  const fetcher = options?.fetcher ?? DEFAULT_FETCHER
  const canRender = Boolean(source)

  return (
    <NodeViewWrapper className="openapi-node">
      {isEditable ? (
        <OpenApiNodeEditor
          editor={editor}
          node={node}
          getPos={getPos}
          source={source}
          renderer={renderer}
        />
      ) : canRender ? (
        <OpenApiSpecViewer
          sourceType={sourceType}
          source={source}
          refType="spec"
          fetcher={fetcher}
          projectKey={projectKey}
        />
      ) : (
        <div className="openapi-node-card">
          <div className="openapi-node-title">OpenAPI Spec</div>
          <div className="openapi-node-row">
            <span className="openapi-node-label">Source</span>
            <span className="openapi-node-value">{source || "-"}</span>
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

function OpenApiNodeEditor({
  editor,
  node,
  getPos,
  source,
  renderer,
}: OpenApiNodeEditorProps) {
  const [draft, setDraft] = useState(source)

  useEffect(() => {
    setDraft(source)
  }, [source])

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value)
  }

  const handleBlur = () => {
    if (draft === source || !editor || !getPos) {
      return
    }

    const position = getPos()
    if (typeof position !== "number") {
      return
    }

    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setNodeMarkup(position, undefined, {
          ...node.attrs,
          source: draft,
          source_type: "yaml",
        })
        return true
      })
      .run()
  }

  return (
    <div className="openapi-node-card">
      <div className="openapi-node-title">OpenAPI Spec</div>
      <div className="openapi-node-row">
        <span className="openapi-node-label">Paste YAML or JSON</span>
      </div>
      <textarea
        className="openapi-node-editor"
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="Paste OpenAPI YAML or JSON here"
      />
      <div className="openapi-node-row">
        <span className="openapi-node-label">Renderer</span>
        <span className="openapi-node-value">{renderer}</span>
      </div>
    </div>
  )
}

type OpenApiNodeEditorProps = {
  editor: NodeViewProps["editor"]
  node: NodeViewProps["node"]
  getPos: NodeViewProps["getPos"]
  source: string
  renderer: string
}
