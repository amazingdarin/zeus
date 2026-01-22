import { useEffect, useMemo, useRef, useState } from "react"
import type { App as VueApp, Component as VueComponent } from "vue"

import { createApp, h } from "vue"
import VueOfficeDocx from "@vue-office/docx"
import VueOfficeExcel from "@vue-office/excel"
import VueOfficePdf from "@vue-office/pdf"
import VueOfficePptx from "@vue-office/pptx"
import "@vue-office/docx/lib/index.css"
import "@vue-office/excel/lib/index.css"

type OfficeFileType = "docx" | "xlsx" | "pptx" | "pdf"

type OfficeViewerProps = {
  src: string
  fileType: OfficeFileType
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>
  onError?: (message: string) => void
}


const componentMap: Record<OfficeFileType, VueComponent> = {
  docx: VueOfficeDocx,
  xlsx: VueOfficeExcel,
  pptx: VueOfficePptx,
  pdf: VueOfficePdf,
}

const DEFAULT_FETCHER: (url: string, init?: RequestInit) => Promise<Response> = (
  url,
  init
) => fetch(url, init)

const blobCache = new Map<string, string>()
const blobRefCounts = new Map<string, number>()
const blobPromiseCache = new Map<string, Promise<string>>()

const retainBlobUrl = async (
  src: string,
  fetcher: (url: string, init?: RequestInit) => Promise<Response>
) => {
  const currentRefs = blobRefCounts.get(src) ?? 0
  blobRefCounts.set(src, currentRefs + 1)

  const cached = blobCache.get(src)
  if (cached) {
    return cached
  }

  let promise = blobPromiseCache.get(src)
  if (!promise) {
    promise = (async () => {
      const response = await fetcher(src)
      if (!response.ok) {
        throw new Error("Failed to load office file")
      }
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      blobCache.set(src, objectUrl)
      return objectUrl
    })()
    blobPromiseCache.set(src, promise)
    promise.finally(() => {
      if (blobPromiseCache.get(src) === promise) {
        blobPromiseCache.delete(src)
      }
    })
  }

  const objectUrl = await promise
  const refs = blobRefCounts.get(src) ?? 0
  if (refs <= 0) {
    blobCache.delete(src)
    URL.revokeObjectURL(objectUrl)
  }

  return objectUrl
}

const releaseBlobUrl = (src: string) => {
  const refs = blobRefCounts.get(src) ?? 0
  if (refs <= 1) {
    blobRefCounts.delete(src)
    const cached = blobCache.get(src)
    if (cached) {
      blobCache.delete(src)
      URL.revokeObjectURL(cached)
    }
    return
  }
  blobRefCounts.set(src, refs - 1)
}

function OfficeViewer({ src, fileType, fetcher, onError }: OfficeViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<VueApp | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const mutationObserverRef = useRef<MutationObserver | null>(null)
  const [objectUrl, setObjectUrl] = useState("")
  const activeFetcher = useMemo(() => fetcher ?? DEFAULT_FETCHER, [fetcher])

  useEffect(() => {
    let active = true
    if (!src) {
      setObjectUrl("")
      return () => {
        active = false
      }
    }

    retainBlobUrl(src, activeFetcher)
      .then((url) => {
        if (!active) {
          return
        }
        setObjectUrl(url)
      })
      .catch((error) => {
        if (!active) {
          return
        }
        const message =
          error instanceof Error ? error.message : "failed to render document"
        onError?.(message)
      })

    return () => {
      active = false
      releaseBlobUrl(src)
    }
  }, [activeFetcher, onError, src])

  const renderSrc = objectUrl || ""

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    if (!renderSrc) {
      if (appRef.current) {
        appRef.current.unmount()
        appRef.current = null
      }
      container.innerHTML = ""
      return
    }

    const applyDocxScale = () => {
      if (fileType !== "docx") {
        return
      }
      const wrapper = container.querySelector(".docx-wrapper") as HTMLElement | null
      if (!wrapper) {
        return
      }
      const sections = Array.from(wrapper.querySelectorAll("section.docx"))
      let contentWidth = wrapper.scrollWidth
      let contentHeight = wrapper.scrollHeight
      if (sections.length > 0) {
        let maxWidth = 0
        let totalHeight = 0
        sections.forEach((section) => {
          const width = section.scrollWidth || section.clientWidth
          const height = section.scrollHeight || section.clientHeight
          if (width > maxWidth) {
            maxWidth = width
          }
          totalHeight += height
        })
        if (maxWidth > 0) {
          contentWidth = maxWidth
        }
        if (totalHeight > 0) {
          contentHeight = totalHeight
        }
      }

      const containerWidth = container.clientWidth
      if (!containerWidth || !contentWidth) {
        return
      }

      const scale = contentWidth > containerWidth ? containerWidth / contentWidth : 1
      const scaledWidth = contentWidth * scale
      const offsetX = Math.max((containerWidth - scaledWidth) / 2, 0)
      wrapper.style.transform = `translateX(${offsetX}px) scale(${scale})`
      wrapper.style.transformOrigin = "top left"
      wrapper.style.width = `${contentWidth}px`
      wrapper.style.height = `${contentHeight}px`
    }

    if (appRef.current) {
      appRef.current.unmount()
      appRef.current = null
    }

    const ViewerComponent = componentMap[fileType]
    const app = createApp({
      render() {
        return h(ViewerComponent, {
          src: renderSrc,
          onError: (err: unknown) => {
            const message = err instanceof Error ? err.message : "failed to render document"
            onError?.(message)
          },
          onRendered: applyDocxScale,
        })
      },
    })

    app.mount(container)
    appRef.current = app

    if (fileType === "docx") {
      const resizeObserver = new ResizeObserver(() => {
        applyDocxScale()
      })
      resizeObserver.observe(container)
      resizeObserverRef.current = resizeObserver

      const mutationObserver = new MutationObserver(() => {
        applyDocxScale()
      })
      mutationObserver.observe(container, { subtree: true, childList: true })
      mutationObserverRef.current = mutationObserver
    }

    requestAnimationFrame(() => {
      applyDocxScale()
    })

    return () => {
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      mutationObserverRef.current?.disconnect()
      mutationObserverRef.current = null
      app.unmount()
      appRef.current = null
      container.innerHTML = ""
    }
  }, [fileType, onError, renderSrc])

  return <div className="office-viewer" ref={containerRef} />
}

export default OfficeViewer
