import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { parse as parseYaml } from "yaml"
import "swagger-ui-react/swagger-ui.css"

import type { OpenAPIRef, OpenAPIRefType, OpenAPISpec } from "../lib/openapi-filter"
import { filterOpenAPISpec } from "../lib/openapi-filter"
import { encodeProjectRefPath } from "../lib/project-scope"
import type { OpenApiSourceType } from "../nodes/openapi-node/openapi-node-extension"

const SwaggerUI = lazy(() => import("swagger-ui-react"))

type OpenApiSpecViewerProps = {
  sourceType: OpenApiSourceType
  source: string
  refType?: OpenAPIRefType
  ref?: OpenAPIRef
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>
  projectKey?: string
}

type ViewState = {
  loading: boolean
  error: string | null
  spec: OpenAPISpec | null
}

const initialState: ViewState = {
  loading: false,
  error: null,
  spec: null,
}

const parseSpec = (raw: string): OpenAPISpec | null => {
  if (!raw.trim()) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as OpenAPISpec
    if (parsed && typeof parsed === "object") {
      return parsed
    }
  } catch {
    // fall through to YAML
  }
  try {
    const parsed = parseYaml(raw) as OpenAPISpec
    if (parsed && typeof parsed === "object") {
      return parsed
    }
  } catch {
    return null
  }
  return null
}

const DEFAULT_FETCHER: (url: string, init?: RequestInit) => Promise<Response> = (
  url,
  init
) => fetch(url, init)

const buildFetchUrl = (projectKey: string, source: string) => {
  const normalized = source.trim()
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized
  }
  if (!projectKey) {
    return normalized
  }
  const assetId = normalized.replace(/^storage:\/\//, "")
  return `/api/projects/${encodeProjectRefPath(projectKey)}/assets/${encodeURIComponent(
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

function OpenApiSpecViewer({
  sourceType,
  source,
  refType = "spec",
  ref,
  fetcher = DEFAULT_FETCHER,
  projectKey = "",
}: OpenApiSpecViewerProps) {
  const refSignature = `${refType}|${ref?.tag ?? ""}|${ref?.path ?? ""}|${ref?.method ?? ""}`
  const stableRef = useMemo(
    () => ({
      tag: ref?.tag,
      path: ref?.path,
      method: ref?.method,
    }),
    [refSignature]
  )
  const [state, setState] = useState<ViewState>(initialState)

  useEffect(() => {
    if (!source.trim()) {
      setState({
        loading: false,
        error: "Missing OpenAPI source",
        spec: null,
      })
      return
    }

    const controller = new AbortController()
    const loadSpec = async () => {
      setState({ loading: true, error: null, spec: null })
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
        const filtered =
          refType === "spec" ? spec : filterOpenAPISpec(spec, refType, stableRef)
        setState({ loading: false, error: null, spec: filtered })
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return
        }
        setState({
          loading: false,
          error: (err as Error).message || "OpenAPI 资源加载失败",
          spec: null,
        })
      }
    }

    loadSpec()
    return () => controller.abort()
  }, [fetcher, projectKey, refSignature, source, sourceType])

  if (state.loading) {
    return <div className="openapi-viewer-state">Loading OpenAPI spec...</div>
  }

  if (state.error) {
    return <div className="openapi-viewer-error">{state.error}</div>
  }

  if (!state.spec) {
    return <div className="openapi-viewer-state">No OpenAPI spec available</div>
  }

  return (
    <div className="openapi-viewer">
      <Suspense fallback={<div className="openapi-viewer-state">Loading viewer...</div>}>
        <SwaggerUI spec={state.spec} />
      </Suspense>
    </div>
  )
}

export default OpenApiSpecViewer
