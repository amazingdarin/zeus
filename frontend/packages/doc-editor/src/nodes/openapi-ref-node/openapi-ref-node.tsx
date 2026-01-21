"use client"

import type { NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper } from "@tiptap/react"
import OpenApiSpecViewer from "../../viewer/OpenApiSpecViewer"
import type { OpenApiSourceType } from "../openapi-node/openapi-node-extension"
import "./openapi-ref-node.scss"

type OpenApiRefType = "spec" | "module" | "endpoint"

const VALID_REF_TYPES = new Set(["spec", "module", "endpoint"])

export function OpenApiRefNodeView({ node, editor, extension }: NodeViewProps) {
  const source = String(node.attrs?.source ?? "")
  const sourceType = String(node.attrs?.source_type ?? "url") as OpenApiSourceType
  const rawRefType = String(node.attrs?.ref_type ?? "spec")
  const refType = (VALID_REF_TYPES.has(rawRefType) ? rawRefType : "spec") as OpenApiRefType
  const ref = node.attrs?.ref ?? {}
  const tag = typeof ref?.tag === "string" ? ref.tag : ""
  const path = typeof ref?.path === "string" ? ref.path : ""
  const method = typeof ref?.method === "string" ? ref.method : ""
  const isEditable = editor.isEditable
  const options = extension?.options as
    | { projectKey?: string; fetcher?: (url: string, init?: RequestInit) => Promise<Response> }
    | undefined
  const fetcher = options?.fetcher
  const projectKey = String(options?.projectKey ?? "")

  return (
    <NodeViewWrapper className="openapi-ref-node">
      {!isEditable ? (
        <OpenApiSpecViewer
          sourceType={sourceType}
          source={source}
          refType={refType}
          ref={{ tag, path, method }}
          fetcher={fetcher}
          projectKey={projectKey}
        />
      ) : (
        <div className="openapi-ref-card">
          <div className="openapi-ref-title">OpenAPI Reference</div>
          <div className="openapi-ref-row">
            <span className="openapi-ref-label">Source</span>
            <span className="openapi-ref-value">{source || "-"}</span>
          </div>
          <div className="openapi-ref-row">
            <span className="openapi-ref-label">Type</span>
            <span className="openapi-ref-value">{refType}</span>
          </div>
          {refType === "module" && tag ? (
            <div className="openapi-ref-row">
              <span className="openapi-ref-label">Tag</span>
              <span className="openapi-ref-value">{tag}</span>
            </div>
          ) : null}
          {refType === "endpoint" && (path || method) ? (
            <div className="openapi-ref-row">
              <span className="openapi-ref-label">Endpoint</span>
              <span className="openapi-ref-value">
                {method ? method.toUpperCase() : ""} {path}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default OpenApiRefNodeView
