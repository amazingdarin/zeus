import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper } from "@tiptap/react"
import type { LinkPreviewAttrs, LinkPreviewNodeOptions, LinkPreviewStatus } from "./link-preview-node-extension"
import "./link-preview-node.scss"

export function LinkPreviewNodeView({ node, editor, extension, getPos }: NodeViewProps) {
  const attrs = node.attrs as LinkPreviewAttrs
  const url = String(attrs.url ?? "")
  const status = (attrs.status ?? "idle") as LinkPreviewStatus
  const options = extension?.options as LinkPreviewNodeOptions | undefined
  const fetchHtml = options?.fetchHtml
  const isEditable = editor.isEditable
  const position = typeof getPos === "function" ? getPos() : null

  const [input, setInput] = useState(url)
  const [localStatus, setLocalStatus] = useState<LinkPreviewStatus>(
    status === "loading" ? "idle" : status
  )
  const inFlightRef = useRef<string | null>(null)
  const autoFetchedRef = useRef<string | null>(null)

  useEffect(() => {
    setInput(url)
  }, [url])

  useEffect(() => {
    if (status !== "loading" && status !== localStatus) {
      setLocalStatus(status)
    }
  }, [localStatus, status])

  const canUpdate = typeof position === "number" && isEditable
  const canMutate = typeof position === "number" && Boolean(editor)

  const domain = useMemo(() => {
    if (!url) {
      return ""
    }
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }, [url])

  const hasSummary = Boolean(
    attrs.title || attrs.description || attrs.image || attrs.site_name
  )

  const updateNodeAttrs = useCallback(
    (nextAttrs: Partial<LinkPreviewAttrs>) => {
      if (!canMutate || !editor) {
        return
      }
      editor.commands.command(({ tr }) => {
        tr.setNodeMarkup(position as number, undefined, {
          ...attrs,
          ...nextAttrs,
        })
        return true
      })
    },
    [attrs, canMutate, editor, position]
  )

  const fetchPreview = useCallback(
    async (targetUrl: string) => {
      if (!fetchHtml) {
        return
      }
      const cached = linkPreviewCache.get(targetUrl)
      if (cached) {
        updateNodeAttrs({
          url: targetUrl,
          title: cached.title,
          description: cached.description,
          image: cached.image,
          site_name: cached.siteName,
          fetched_at: cached.fetchedAt,
          status: "success",
          error_message: "",
        })
        setLocalStatus("success")
        return
      }
      if (inFlightRef.current === targetUrl) {
        return
      }
      inFlightRef.current = targetUrl
      setLocalStatus("loading")
      updateNodeAttrs({
        url: targetUrl,
        status: "loading",
        error_message: "",
      })
      try {
        let previewPromise = linkPreviewPromises.get(targetUrl)
        if (!previewPromise) {
          previewPromise = fetchLinkPreview(targetUrl, fetchHtml)
          linkPreviewPromises.set(targetUrl, previewPromise)
        }
        const preview = await previewPromise
        linkPreviewCache.set(targetUrl, preview)
        updateNodeAttrs({
          url: targetUrl,
          title: preview.title,
          description: preview.description,
          image: preview.image,
          site_name: preview.siteName,
          fetched_at: preview.fetchedAt,
          status: "success",
          error_message: "",
        })
        setLocalStatus("success")
      } catch {
        updateNodeAttrs({
          url: targetUrl,
          status: "idle",
          error_message: "",
        })
        setLocalStatus("idle")
      } finally {
        if (inFlightRef.current === targetUrl) {
          inFlightRef.current = null
        }
        linkPreviewPromises.delete(targetUrl)
      }
    },
    [fetchHtml, updateNodeAttrs]
  )

  const handleSubmit = async () => {
    if (!canUpdate || !editor) {
      return
    }
    const nextUrl = input.trim()
    if (!nextUrl) {
      return
    }
    autoFetchedRef.current = nextUrl
    await fetchPreview(nextUrl)
  }

  useEffect(() => {
    if (!canMutate || !editor) {
      return
    }
    if (status !== "loading" || hasSummary) {
      return
    }
    updateNodeAttrs({ status: "idle", error_message: "" })
    setLocalStatus("idle")
  }, [canMutate, editor, hasSummary, status, updateNodeAttrs])

  useEffect(() => {
    if (!fetchHtml || !url || hasSummary || status === "loading") {
      return
    }
    if (autoFetchedRef.current === url || inFlightRef.current === url) {
      return
    }
    autoFetchedRef.current = url
    void fetchPreview(url)
  }, [fetchHtml, fetchPreview, hasSummary, status, url])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      handleSubmit()
    }
  }

  const statusLabel = localStatus === "loading" ? "Fetching preview..." : ""

  return (
    <NodeViewWrapper className={`link-preview-node ${localStatus}`}>
      {isEditable ? (
        <div className="link-preview-input">
          <div className="link-preview-label">Link</div>
          <input
            type="text"
            placeholder="Paste or type a URL"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={localStatus === "loading"}
          />
        </div>
      ) : (
        <div className="link-preview-card">
          <div className="link-preview-body">
            {attrs.image ? (
              <div className="link-preview-image">
                <img src={attrs.image} alt={attrs.title || attrs.site_name || domain} />
              </div>
            ) : null}
            <div className="link-preview-content">
              <div className="link-preview-title">
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                ) : (
                  "Link preview"
                )}
              </div>
              {attrs.title || attrs.description || attrs.image || attrs.site_name ? (
                <>
                  {attrs.title ? (
                    <div className="link-preview-summary-title">{attrs.title}</div>
                  ) : null}
                  {attrs.description ? (
                    <div className="link-preview-description">{attrs.description}</div>
                  ) : null}
                  <div className="link-preview-meta">
                    <span>{attrs.site_name || domain}</span>
                    {attrs.fetched_at ? <span>{formatFetchedAt(attrs.fetched_at)}</span> : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>
          {statusLabel ? <div className="link-preview-status">{statusLabel}</div> : null}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default LinkPreviewNodeView

type LinkPreviewResult = {
  title: string
  description: string
  image: string
  siteName: string
  fetchedAt: string
}

const linkPreviewCache = new Map<string, LinkPreviewResult>()
const linkPreviewPromises = new Map<string, Promise<LinkPreviewResult>>()

async function fetchLinkPreview(
  targetUrl: string,
  fetchHtml: (url: string) => Promise<string>
): Promise<LinkPreviewResult> {
  const html = await fetchHtml(targetUrl)
  const document = new DOMParser().parseFromString(html, "text/html")
  return extractMetadata(document, targetUrl)
}

function extractMetadata(document: Document, fallbackUrl: string): LinkPreviewResult {
  const readMeta = (selector: string) =>
    document.querySelector(selector)?.getAttribute("content")?.trim() ?? ""
  const title = readMeta('meta[property="og:title"]') ||
    readMeta('meta[name="twitter:title"]') ||
    document.querySelector("title")?.textContent?.trim() ||
    fallbackUrl
  const description = readMeta('meta[property="og:description"]') ||
    readMeta('meta[name="description"]') ||
    readMeta('meta[name="twitter:description"]')
  const image = readMeta('meta[property="og:image"]') ||
    readMeta('meta[name="twitter:image"]')
  const siteName = readMeta('meta[property="og:site_name"]') ||
    (() => {
      try {
        return new URL(fallbackUrl).hostname
      } catch {
        return ""
      }
    })()

  return {
    title,
    description,
    image,
    siteName,
    fetchedAt: new Date().toISOString(),
  }
}

function formatFetchedAt(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toLocaleString()
}
