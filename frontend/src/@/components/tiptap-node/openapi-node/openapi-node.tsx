"use client"

import { useEffect, useMemo, useState } from "react"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper } from "@tiptap/react"
import OpenApiSpecViewer from "@/components/OpenApiSpecViewer"
import { apiFetch } from "../../../../config/api"
import { parse as parseYaml } from "yaml"
import "@/components/tiptap-node/openapi-node/openapi-node.scss"

export function OpenApiNodeView({ node, editor, extension }: NodeViewProps) {
  const source = String(node.attrs?.source ?? "")
  const renderer = String(node.attrs?.renderer ?? "swagger")
  const isEditable = editor.isEditable
  const projectKey = String(
    (extension?.options as { projectKey?: string } | undefined)?.projectKey ?? "",
  )
  const canRender = Boolean(projectKey && source)

  return (
    <NodeViewWrapper className="openapi-node">
      {isEditable ? (
        canRender ? (
          <OpenApiSourcePreview projectKey={projectKey} source={source} />
        ) : (
          <OpenApiNodeCard source={source} renderer={renderer} showStatus />
        )
      ) : canRender ? (
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

type OpenApiSourcePreviewProps = {
  projectKey: string
  source: string
}

type OpenApiSourceState = {
  loading: boolean
  error: string | null
  jsonText: string | null
}

const initialState: OpenApiSourceState = {
  loading: false,
  error: null,
  jsonText: null,
}

const normalizeSource = (value: string) => value.trim().replace(/^storage:\/\//, "")

const parseSpec = (raw: string): Record<string, unknown> | null => {
  if (!raw.trim()) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed && typeof parsed === "object") {
      return parsed
    }
  } catch {
    // fall through to YAML
  }
  try {
    const parsed = parseYaml(raw) as Record<string, unknown>
    if (parsed && typeof parsed === "object") {
      return parsed
    }
  } catch {
    return null
  }
  return null
}

function OpenApiSourcePreview({ projectKey, source }: OpenApiSourcePreviewProps) {
  const assetId = useMemo(() => normalizeSource(source), [source])
  const [state, setState] = useState<OpenApiSourceState>(initialState)

  useEffect(() => {
    if (!projectKey || !assetId) {
      setState({
        loading: false,
        error: "Missing OpenAPI source",
        jsonText: null,
      })
      return
    }

    const controller = new AbortController()
    const loadSpec = async () => {
      setState({ loading: true, error: null, jsonText: null })
      try {
        const response = await apiFetch(
          `/api/projects/${encodeURIComponent(projectKey)}/assets/${encodeURIComponent(
            assetId,
          )}/content`,
          { signal: controller.signal },
        )
        if (!response.ok) {
          throw new Error("failed to load OpenAPI spec")
        }
        const raw = await response.text()
        if (controller.signal.aborted) {
          return
        }
        const spec = parseSpec(raw)
        if (!spec) {
          throw new Error("invalid OpenAPI content")
        }
        const jsonText = JSON.stringify(spec, null, 2)
        setState({ loading: false, error: null, jsonText })
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return
        }
        setState({
          loading: false,
          error: (err as Error).message || "failed to load OpenAPI spec",
          jsonText: null,
        })
      }
    }

    loadSpec()
    return () => controller.abort()
  }, [assetId, projectKey])

  if (state.loading) {
    return <div className="openapi-viewer-state">Loading OpenAPI spec...</div>
  }

  if (state.error) {
    return <div className="openapi-viewer-error">{state.error}</div>
  }

  if (!state.jsonText) {
    return <div className="openapi-viewer-state">No OpenAPI spec available</div>
  }

  return <pre className="openapi-source-preview">{state.jsonText}</pre>
}

type OpenApiNodeCardProps = {
  source: string
  renderer: string
  showStatus?: boolean
}

function OpenApiNodeCard({ source, renderer, showStatus }: OpenApiNodeCardProps) {
  return (
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
      {showStatus ? (
        <div className="openapi-node-row">
          <span className="openapi-node-label">Status</span>
          <span className="openapi-node-value">Missing project or source</span>
        </div>
      ) : null}
    </div>
  )
}
