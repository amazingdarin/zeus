"use client"

import { useEffect, useState } from "react"
import type { Editor, JSONContent, NodeViewProps } from "@tiptap/react"
import type { Extensions } from "@tiptap/core"
import { NodeViewWrapper } from "@tiptap/react"

import { DocViewer } from "../../templates/doc-viewer"
import { encodeProjectRefPath } from "../../lib/project-scope"
import "./block-ref-node.scss"

type BlockRefState = {
  loading: boolean
  error: string | null
  content: JSONContent | null
  sourceTitle: string
}

type BlockRefCacheEntry = {
  content: JSONContent
  sourceTitle: string
}

const blockRefCache = new Map<string, BlockRefCacheEntry>()
const blockRefPromiseCache = new Map<string, Promise<BlockRefCacheEntry>>()

const DEFAULT_FETCHER: (url: string, init?: RequestInit) => Promise<Response> = (
  url,
  init
) => fetch(url, init)

export function BlockRefNodeView({
  node,
  editor,
  extension,
  getPos,
}: NodeViewProps) {
  const docID = String(node.attrs?.doc_id ?? "")
  const blockID = String(node.attrs?.block_id ?? "")
  const isEditable = editor.isEditable
  const options = extension?.options as
    | {
        projectKey?: string
        fetcher?: (url: string, init?: RequestInit) => Promise<Response>
        viewerExtensions?: Extensions
        onSelect?: (payload: {
          editor: Editor
          range: { from: number; to: number }
          attrs: { doc_id?: string; block_id?: string }
        }) => void
      }
    | undefined
  const projectKey = String(options?.projectKey ?? "")
  const fetcher = options?.fetcher ?? DEFAULT_FETCHER
  const viewerExtensions = options?.viewerExtensions ?? []
  const handleOpenPicker = () => {
    if (!isEditable || !options?.onSelect) {
      return
    }
    if (typeof getPos !== "function") {
      return
    }
    const resolvedPos = getPos()
    if (resolvedPos === undefined) {
      return
    }
    const range = {
      from: resolvedPos,
      to: resolvedPos + node.nodeSize,
    }
    options.onSelect({
      editor,
      range,
      attrs: { doc_id: docID, block_id: blockID },
    })
  }
  const [state, setState] = useState<BlockRefState>({
    loading: false,
    error: null,
    content: null,
    sourceTitle: "",
  })
  const refLabel = `Ref: ${state.sourceTitle || "Untitled Document"}`

  const canFetch = Boolean(projectKey && docID && blockID)

  useEffect(() => {
    if (!canFetch) {
      setState({
        loading: false,
        error: "Missing document or block reference.",
        content: null,
        sourceTitle: "",
      })
      return
    }

    let isActive = true
    const cacheKey = `${projectKey}:${docID}:${blockID}`
    const cached = blockRefCache.get(cacheKey)
    if (cached) {
      setState({
        loading: false,
        error: null,
        content: cached.content,
        sourceTitle: cached.sourceTitle,
      })
      return () => {
        isActive = false
      }
    }

    const load = async () => {
      setState({ loading: true, error: null, content: null, sourceTitle: "" })
      try {
        let promise = blockRefPromiseCache.get(cacheKey)
        if (!promise) {
          promise = (async () => {
            const response = await fetcher(
              `/api/projects/${encodeProjectRefPath(projectKey)}/documents/${encodeURIComponent(
                docID
              )}/blocks/${encodeURIComponent(blockID)}`
            )
            if (!response.ok) {
              throw new Error("Failed to load referenced block.")
            }
            const payload = await response.json()
            const content = extractBodyContent(payload?.data)
            const sourceTitle = extractMetaTitle(payload?.data)
            if (!content) {
              throw new Error("Referenced block content missing.")
            }
            return { content, sourceTitle }
          })()
          blockRefPromiseCache.set(cacheKey, promise)
          promise.finally(() => {
            if (blockRefPromiseCache.get(cacheKey) === promise) {
              blockRefPromiseCache.delete(cacheKey)
            }
          })
        }

        const result = await promise
        blockRefCache.set(cacheKey, result)
        if (isActive) {
          setState({
            loading: false,
            error: null,
            content: result.content,
            sourceTitle: result.sourceTitle,
          })
        }
      } catch (error) {
        if (isActive) {
          setState({
            loading: false,
            error: (error as Error).message || "Failed to load block.",
            content: null,
            sourceTitle: "",
          })
        }
      }
    }

    load()
    return () => {
      isActive = false
    }
  }, [blockID, canFetch, docID, fetcher, projectKey])

  return (
    <NodeViewWrapper className="block-ref-node">
      <div
        className={`block-ref-card${isEditable ? " is-editable" : ""}`}
        onClick={handleOpenPicker}
      >
        <div className="block-ref-header">
          {!isEditable && docID ? (
            <a
              className="block-ref-link"
              href={`#/documents/${encodeURIComponent(docID)}`}
            >
              {refLabel}
            </a>
          ) : (
            <span className="block-ref-title">{refLabel}</span>
          )}
        </div>
        {state.loading ? (
          <div className="block-ref-state">Loading block...</div>
        ) : state.error ? (
          <div className="block-ref-error">{state.error}</div>
        ) : state.content ? (
          <>
            <div className="block-ref-content">
              <DocViewer content={state.content} extensions={viewerExtensions} />
            </div>
          </>
        ) : (
          <div className="block-ref-state">No block selected.</div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default BlockRefNodeView

type BlockRefPayload = {
  meta?: {
    title?: string
  }
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

const extractMetaTitle = (data?: BlockRefPayload | null): string => {
  return typeof data?.meta?.title === "string" ? data?.meta?.title : ""
}
