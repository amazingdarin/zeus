"use client"

import { useEffect, useMemo, useState } from "react"
import type { Extension, JSONContent, NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper } from "@tiptap/react"

import { DocViewer } from "../../templates/doc-viewer"
import "./block-ref-node.scss"

type BlockRefState = {
  loading: boolean
  error: string | null
  content: JSONContent | null
}

const DEFAULT_FETCHER: (url: string, init?: RequestInit) => Promise<Response> = (
  url,
  init
) => fetch(url, init)

export function BlockRefNodeView({ node, editor, extension }: NodeViewProps) {
  const docID = String(node.attrs?.doc_id ?? "")
  const blockID = String(node.attrs?.block_id ?? "")
  const isEditable = editor.isEditable
  const options = extension?.options as
    | {
        projectKey?: string
        fetcher?: (url: string, init?: RequestInit) => Promise<Response>
        viewerExtensions?: Extension[]
      }
    | undefined
  const projectKey = String(options?.projectKey ?? "")
  const fetcher = options?.fetcher ?? DEFAULT_FETCHER
  const viewerExtensions = options?.viewerExtensions ?? []
  const [state, setState] = useState<BlockRefState>({
    loading: false,
    error: null,
    content: null,
  })

  const canFetch = Boolean(projectKey && docID && blockID)

  useEffect(() => {
    if (!canFetch) {
      setState({
        loading: false,
        error: "Missing document or block reference.",
        content: null,
      })
      return
    }

    let isActive = true
    const controller = new AbortController()
    const load = async () => {
      setState({ loading: true, error: null, content: null })
      try {
        const response = await fetcher(
          `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(
            docID
          )}/blocks/${encodeURIComponent(blockID)}`,
          { signal: controller.signal }
        )
        if (!response.ok) {
          throw new Error("Failed to load referenced block.")
        }
        const payload = await response.json()
        const content = extractBodyContent(payload?.data)
        if (!content) {
          throw new Error("Referenced block content missing.")
        }
        if (isActive) {
          setState({ loading: false, error: null, content })
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return
        }
        if (isActive) {
          setState({
            loading: false,
            error: (error as Error).message || "Failed to load block.",
            content: null,
          })
        }
      }
    }

    load()
    return () => {
      isActive = false
      controller.abort()
    }
  }, [blockID, canFetch, docID, fetcher, projectKey])

  const refLabel = useMemo(() => {
    if (docID && blockID) {
      return `${docID} · ${blockID}`
    }
    return docID || blockID || "Missing reference"
  }, [blockID, docID])

  return (
    <NodeViewWrapper className="block-ref-node">
      <div className={`block-ref-card${isEditable ? " is-editable" : ""}`}>
        <div className="block-ref-header">
          <span className="block-ref-title">Block Reference</span>
          <span className="block-ref-meta">{refLabel}</span>
        </div>
        {state.loading ? (
          <div className="block-ref-state">Loading block...</div>
        ) : state.error ? (
          <div className="block-ref-error">{state.error}</div>
        ) : state.content ? (
          <div className="block-ref-content">
            <DocViewer content={state.content} extensions={viewerExtensions} />
          </div>
        ) : (
          <div className="block-ref-state">No block selected.</div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default BlockRefNodeView

type BlockRefPayload = {
  body?: {
    type?: string
    content?: unknown
  }
  content?: unknown
}

const extractBodyContent = (data?: BlockRefPayload | null): JSONContent | null => {
  const body = data?.body ?? data?.content
  if (!body || typeof body !== "object") {
    return null
  }
  const bodyContent = (body as { content?: unknown }).content
  return resolveDocContent(bodyContent ?? body)
}

const resolveDocContent = (value: unknown): JSONContent | null => {
  if (!value || typeof value !== "object") {
    return null
  }
  const maybeWrapped = value as { content?: unknown }
  if (maybeWrapped.content && typeof maybeWrapped.content === "object") {
    const nested = maybeWrapped.content as JSONContent
    if (nested && typeof nested === "object" && "type" in nested) {
      return nested
    }
  }
  const direct = value as JSONContent
  if (direct && typeof direct === "object" && "type" in direct) {
    return direct
  }
  return null
}
