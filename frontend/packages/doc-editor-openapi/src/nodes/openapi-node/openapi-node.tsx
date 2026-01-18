"use client"

import { useEffect, useMemo, useState } from "react"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper } from "@tiptap/react"
import OpenApiSpecViewer from "../../viewer/OpenApiSpecViewer"
import type { OpenApiSourceType } from "./openapi-node-extension"
import { parse as parseYaml } from "yaml"
import "./openapi-node.scss"

const DEFAULT_FETCHER: (url: string, init?: RequestInit) => Promise<Response> = (
  url,
  init
) => fetch(url, init)

export function OpenApiNodeView({ node, editor, extension }: NodeViewProps) {
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
          canRender={canRender}
          sourceType={sourceType}
          source={source}
          renderer={renderer}
          fetcher={fetcher}
          projectKey={projectKey}
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

type OpenApiSourcePreviewProps = {
  sourceType: OpenApiSourceType
  source: string
  fetcher: (url: string, init?: RequestInit) => Promise<Response>
  projectKey: string
}

type OpenApiSourceState = {
  loading: boolean
  error: string | null
  jsonText: string | null
}

type OpenApiNodeEditorProps = {
  editor: NodeViewProps["editor"]
  node: NodeViewProps["node"]
  canRender: boolean
  sourceType: OpenApiSourceType
  source: string
  renderer: string
  fetcher: (url: string, init?: RequestInit) => Promise<Response>
  projectKey: string
}

const initialState: OpenApiSourceState = {
  loading: false,
  error: null,
  jsonText: null,
}

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
    return null
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

const formatError = (message: string) => message || "OpenAPI 解析失败"

const buildFetchUrl = (projectKey: string, source: string) => {
  const normalized = source.trim()
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized
  }
  if (!projectKey) {
    return normalized
  }
  const assetId = normalized.replace(/^storage:\/\//, "")
  return `/api/projects/${encodeURIComponent(projectKey)}/assets/${encodeURIComponent(
    assetId
  )}/content`
}

async function resolveSource(
  sourceType: OpenApiSourceType,
  source: string,
  projectKey: string,
  fetcher: (url: string, init?: RequestInit) => Promise<Response>,
  signal: AbortSignal
) {
  if (sourceType === "json" || sourceType === "yaml") {
    return source
  }

  const url = buildFetchUrl(projectKey, source)
  const response = await fetcher(url, { signal })
  if (!response.ok) {
    throw new Error("OpenAPI 资源加载失败")
  }
  return response.text()
}

function OpenApiNodeEditor({
  editor,
  node,
  canRender,
  sourceType,
  source,
  renderer,
  fetcher,
  projectKey,
}: OpenApiNodeEditorProps) {
  const [draft, setDraft] = useState(source)

  useEffect(() => {
    setDraft(source)
  }, [source])

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value)
  }

  const handleBlur = () => {
    if (draft === source) {
      return
    }
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        const { selection } = tr
        const position = selection?.$anchor?.before() ?? selection?.from
        if (typeof position !== "number") {
          return false
        }
        tr.setNodeMarkup(position, undefined, {
          ...node.attrs,
          source: draft,
          source_type: "yaml",
        })
        return true
      })
      .run()
  }

  if (canRender) {
    return (
      <OpenApiSourcePreview
        sourceType={sourceType}
        source={source}
        fetcher={fetcher}
        projectKey={projectKey}
      />
    )
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

function OpenApiSourcePreview({
  sourceType,
  source,
  fetcher,
  projectKey,
}: OpenApiSourcePreviewProps & { projectKey: string }) {
  const [state, setState] = useState<OpenApiSourceState>(initialState)

  useEffect(() => {
    if (!source.trim()) {
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
        const raw = await resolveSource(
          sourceType,
          source,
          projectKey,
          fetcher,
          controller.signal
        )
        if (controller.signal.aborted) {
          return
        }
        const spec = parseSpec(raw)
        if (!spec) {
          throw new Error("OpenAPI 内容解析失败")
        }
        const jsonText = JSON.stringify(spec, null, 2)
        setState({ loading: false, error: null, jsonText })
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return
        }
        setState({
          loading: false,
          error: formatError((err as Error).message),
          jsonText: null,
        })
      }
    }

    loadSpec()
    return () => controller.abort()
  }, [fetcher, projectKey, source, sourceType])

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
        <span className="openapi-node-value">{source || "-"}</span>
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
