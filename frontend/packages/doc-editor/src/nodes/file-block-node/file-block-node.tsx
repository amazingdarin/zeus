"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper } from "@tiptap/react"

import OfficeViewer from "../../viewer/OfficeViewer"
import { Button } from "../../primitives/button"
import { TrashIcon } from "../../icons/trash-icon"
import { ImagePlusIcon } from "../../icons/image-plus-icon"
import type {
  FileBlockAttrs,
  FileBlockNodeOptions,
  FileBlockUploadResult,
} from "./file-block-node-extension"
import "./file-block-node.scss"

type FileBlockState = {
  loading: boolean
  error: string | null
  text: string
  truncated: boolean
}

type TextCacheEntry = {
  text: string
  truncated: boolean
}

const textCache = new Map<string, TextCacheEntry>()
const textPromiseCache = new Map<string, Promise<TextCacheEntry>>()

type FileKind = {
  fileType: "office" | "text" | "unknown"
  officeType?: "docx" | "xlsx" | "pptx" | "pdf"
}

const DEFAULT_FETCHER: (url: string, init?: RequestInit) => Promise<Response> = (
  url,
  init
) => fetch(url, init)

const DEFAULT_ACCEPT =
  ".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.json,.yaml,.yml,.log"

const OFFICE_MIME_MAP: Record<string, FileKind["officeType"]> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
}

const OFFICE_EXT_MAP: Record<string, FileKind["officeType"]> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
}

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "csv",
  "json",
  "yaml",
  "yml",
  "log",
])

const TEXT_MIME_PREFIXES = ["text/"]
const TEXT_MIME_VALUES = new Set([
  "application/json",
  "application/x-yaml",
  "application/yaml",
  "application/xml",
  "application/x-www-form-urlencoded",
])

const resolveFileKind = (
  fileName: string,
  mime: string,
  fileType?: string,
  officeType?: string
): FileKind => {
  if (fileType === "office") {
    return {
      fileType: "office",
      officeType: (officeType as FileKind["officeType"]) ?? undefined,
    }
  }
  if (fileType === "text") {
    return { fileType: "text" }
  }

  const normalizedMime = mime.toLowerCase()
  if (normalizedMime in OFFICE_MIME_MAP) {
    return { fileType: "office", officeType: OFFICE_MIME_MAP[normalizedMime] }
  }
  if (TEXT_MIME_VALUES.has(normalizedMime)) {
    return { fileType: "text" }
  }
  if (TEXT_MIME_PREFIXES.some((prefix) => normalizedMime.startsWith(prefix))) {
    return { fileType: "text" }
  }

  const ext = fileName.split(".").pop()?.toLowerCase() ?? ""
  if (ext in OFFICE_EXT_MAP) {
    return { fileType: "office", officeType: OFFICE_EXT_MAP[ext] }
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return { fileType: "text" }
  }

  return { fileType: "unknown" }
}

const formatFileSize = (size: number) => {
  if (!size) {
    return ""
  }
  const units = ["B", "KB", "MB", "GB"]
  let value = size
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

const normalizeAssetId = (assetId: string) => {
  return assetId.replace(/^storage:\/\//, "")
}

const defaultResolveAssetUrl = (projectKey: string, assetId: string) => {
  const normalized = assetId.trim()
  if (!normalized) {
    return ""
  }
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized
  }
  if (!projectKey) {
    return normalized
  }
  const id = normalizeAssetId(normalized)
  return `/api/projects/${encodeURIComponent(projectKey)}/assets/${encodeURIComponent(
    id
  )}/content`
}

const defaultUploadFile = async (
  projectKey: string,
  fetcher: (url: string, init?: RequestInit) => Promise<Response>,
  file: File
): Promise<FileBlockUploadResult> => {
  if (!projectKey) {
    throw new Error("Missing project key")
  }
  const formData = new FormData()
  formData.append("file", file)
  formData.append("filename", file.name)
  formData.append("mime", file.type || "application/octet-stream")
  formData.append("size", String(file.size))

  const response = await fetcher(
    `/api/projects/${encodeURIComponent(projectKey)}/assets/import`,
    {
      method: "POST",
      body: formData,
    }
  )
  if (!response.ok) {
    throw new Error("file upload failed")
  }
  const payload = await response.json()
  const data = payload?.data ?? payload ?? {}
  const assetId = String(data.asset_id ?? "")
  if (!assetId) {
    throw new Error("missing asset id")
  }
  return {
    asset_id: assetId,
    file_name: String(data.filename ?? file.name),
    mime: String(data.mime ?? file.type ?? "application/octet-stream"),
    size: Number(data.size ?? file.size ?? 0),
  }
}

export function FileBlockNodeView({ node, editor, extension, getPos }: NodeViewProps) {
  const attrs = node.attrs as FileBlockAttrs
  const options = extension?.options as FileBlockNodeOptions | undefined
  const projectKey = String(options?.projectKey ?? "")
  const fetcher = options?.fetcher ?? DEFAULT_FETCHER
  const resolveAssetUrl = options?.resolveAssetUrl ?? defaultResolveAssetUrl
  const uploadFile = options?.uploadFile
  const maxTextBytes = options?.maxTextBytes ?? 200 * 1024
  const accept = options?.accept || DEFAULT_ACCEPT
  const assetId = String(attrs.asset_id ?? "")
  const fileName = String(attrs.file_name ?? "")
  const mime = String(attrs.mime ?? "")
  const size = Number(attrs.size ?? 0)
  const fileTypeAttr = String(attrs.file_type ?? "")
  const officeTypeAttr = String(attrs.office_type ?? "")
  const resolvedKind = useMemo(
    () => resolveFileKind(fileName, mime, fileTypeAttr, officeTypeAttr),
    [fileName, fileTypeAttr, mime, officeTypeAttr]
  )
  const assetUrl = useMemo(
    () => resolveAssetUrl(projectKey, assetId),
    [assetId, projectKey, resolveAssetUrl]
  )

  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [textState, setTextState] = useState<FileBlockState>({
    loading: false,
    error: null,
    text: "",
    truncated: false,
  })
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const updateNodeAttrs = useCallback(
    (nextAttrs: Partial<FileBlockAttrs>) => {
      if (!editor || typeof getPos !== "function") {
        return
      }
      const pos = getPos()
      if (typeof pos !== "number") {
        return
      }
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, { ...attrs, ...nextAttrs })
          return true
        })
        .run()
    },
    [attrs, editor, getPos]
  )

  useEffect(() => {
    if (!assetId || resolvedKind.fileType !== "text") {
      setTextState({ loading: false, error: null, text: "", truncated: false })
      return
    }
    let active = true
    const cacheKey = `${assetUrl}|${maxTextBytes}`
    const cached = textCache.get(cacheKey)
    if (cached) {
      setTextState({
        loading: false,
        error: null,
        text: cached.text,
        truncated: cached.truncated,
      })
      return () => {
        active = false
      }
    }
    const load = async () => {
      setTextState({ loading: true, error: null, text: "", truncated: false })
      try {
        let promise = textPromiseCache.get(cacheKey)
        if (!promise) {
          promise = (async () => {
            const response = await fetcher(assetUrl)
            if (!response.ok) {
              throw new Error("Failed to load text content")
            }
            const text = await response.text()
            const truncated = text.length > maxTextBytes
            const content = truncated ? text.slice(0, maxTextBytes) : text
            return { text: content, truncated }
          })()
          textPromiseCache.set(cacheKey, promise)
          promise.finally(() => {
            if (textPromiseCache.get(cacheKey) === promise) {
              textPromiseCache.delete(cacheKey)
            }
          })
        }

        const result = await promise
        textCache.set(cacheKey, result)
        if (!active) {
          return
        }
        setTextState({
          loading: false,
          error: null,
          text: result.text,
          truncated: result.truncated,
        })
      } catch (error) {
        if (!active) {
          return
        }
        setTextState({
          loading: false,
          error: (error as Error).message || "Failed to load text",
          text: "",
          truncated: false,
        })
      }
    }
    load()
    return () => {
      active = false
    }
  }, [assetId, assetUrl, fetcher, maxTextBytes, resolvedKind.fileType])

  const handleSelectFile = () => {
    fileInputRef.current?.click()
  }

  const handleRemove = () => {
    updateNodeAttrs({
      asset_id: "",
      file_name: "",
      mime: "",
      size: 0,
      file_type: "",
      office_type: "",
    })
    setUploadError(null)
    setTextState({ loading: false, error: null, text: "", truncated: false })
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) {
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const uploader = uploadFile
        ? (input: File) => uploadFile(input)
        : (input: File) => defaultUploadFile(projectKey, fetcher, input)
      const result = await uploader(file)
      const nextKind = resolveFileKind(result.file_name, result.mime)
      updateNodeAttrs({
        asset_id: result.asset_id,
        file_name: result.file_name,
        mime: result.mime,
        size: result.size,
        file_type: nextKind.fileType,
        office_type: nextKind.officeType ?? "",
      })
    } catch (error) {
      setUploadError((error as Error).message || "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  const fileSizeLabel = formatFileSize(size)
  const typeLabel = mime || "unknown"
  const nameLabel = fileName || "Untitled file"
  const showUpload = !assetId
  const showUploadPrompt = showUpload && editor.isEditable
  const showOfficeViewer =
    assetId && resolvedKind.fileType === "office" && resolvedKind.officeType
  const showTextViewer = assetId && resolvedKind.fileType === "text"
  const showUnsupported = assetId && resolvedKind.fileType === "unknown"

  return (
    <NodeViewWrapper className="file-block-node">
      <div className={`file-block-card${editor.isEditable ? " is-editable" : ""}`}>
        <div className="file-block-header">
          <div className="file-block-meta">
            <div className="file-block-name">{nameLabel}</div>
            <div className="file-block-subtitle">
              <span>{typeLabel}</span>
              {fileSizeLabel ? <span>• {fileSizeLabel}</span> : null}
            </div>
          </div>
          {editor.isEditable ? (
            <div className="file-block-actions" contentEditable={false}>
              <Button
                type="button"
                data-style="ghost"
                className="file-block-action"
                onClick={handleSelectFile}
                disabled={uploading}
                showTooltip={false}
              >
                <ImagePlusIcon className="file-block-action-icon" />
                {showUpload ? "Upload" : "Replace"}
              </Button>
              {assetId ? (
                <Button
                  type="button"
                  data-style="ghost"
                  className="file-block-action"
                  onClick={handleRemove}
                  showTooltip={false}
                >
                  <TrashIcon className="file-block-action-icon" />
                  Remove
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {uploading ? <div className="file-block-state">Uploading...</div> : null}
        {uploadError ? <div className="file-block-error">{uploadError}</div> : null}
        {showUploadPrompt ? (
          <button
            type="button"
            className="file-block-dropzone"
            onClick={handleSelectFile}
          >
            <div className="file-block-dropzone-content">
              <div className="file-block-dropzone-icon">+</div>
              <div className="file-block-dropzone-text">
                Drop a file or <em>browse</em>
              </div>
              <div className="file-block-dropzone-subtext">Supports office + text files</div>
            </div>
          </button>
        ) : showOfficeViewer ? (
          <div className="file-block-preview">
            <OfficeViewer
              src={assetUrl}
              fileType={resolvedKind.officeType!}
              fetcher={fetcher}
            />
          </div>
        ) : showTextViewer ? (
          <div className="file-block-preview file-block-preview--text">
            {textState.loading ? (
              <div className="file-block-state">Loading text...</div>
            ) : textState.error ? (
              <div className="file-block-error">{textState.error}</div>
            ) : (
              <pre className="file-block-text">
                {textState.text}
                {textState.truncated ? "\n..." : ""}
              </pre>
            )}
          </div>
        ) : showUnsupported ? (
          <div className="file-block-state">Preview not available.</div>
        ) : null}
      </div>
      <input
        ref={fileInputRef}
        className="file-block-input"
        type="file"
        accept={accept}
        onChange={handleFileChange}
      />
    </NodeViewWrapper>
  )
}

export default FileBlockNodeView
