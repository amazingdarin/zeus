"use client"

import { useMemo } from "react"
import type { ChangeEvent } from "react"
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"

import OpenApiSpecViewer from "../../viewer/OpenApiSpecViewer"
import { MermaidViewer } from "../../viewer/MermaidViewer"
import { ChevronDownIcon } from "../../icons/chevron-down-icon"
import { ViewPreviewIcon } from "../../icons/view-preview-icon"
import { ViewSplitIcon } from "../../icons/view-split-icon"
import { ViewTextIcon } from "../../icons/view-text-icon"
import type { OpenApiSourceType } from "../openapi-node/openapi-node-extension"
import type { CodeBlockNodeOptions, CodeBlockRenderer } from "./code-block-node-extension"

const LANGUAGE_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "openapi", label: "OpenAPI" },
  { value: "html", label: "HTML" },
  { value: "mermaid", label: "Mermaid" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "go", label: "Go" },
  { value: "bash", label: "Bash" },
  { value: "sql", label: "SQL" },
  { value: "plaintext", label: "Plain Text" },
]

const inferOpenApiSourceType = (code: string): OpenApiSourceType => {
  const trimmed = code.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json"
  }
  return "yaml"
}

const DEFAULT_RENDERERS: CodeBlockRenderer[] = [
  {
    id: "openapi",
    label: "OpenAPI",
    match: ({ language }) => language === "openapi",
    render: ({ code, fetcher, projectKey }) => (
      <OpenApiSpecViewer
        sourceType={inferOpenApiSourceType(code)}
        source={code}
        refType="spec"
        fetcher={fetcher}
        projectKey={projectKey}
      />
    ),
  },
  {
    id: "html",
    label: "HTML",
    match: ({ language }) => language === "html",
    render: ({ code }) => (
      <iframe
        title="HTML preview"
        sandbox=""
        className="code-block-html-preview"
        srcDoc={code}
        loading="lazy"
      />
    ),
  },
  {
    id: "mermaid",
    label: "Mermaid",
    match: ({ language }) => language === "mermaid",
    render: ({ code }) => <MermaidViewer code={code} />,
  },
]

type ViewMode = "text" | "preview" | "split"

const VIEW_MODES: ViewMode[] = ["text", "preview", "split"]

const isViewMode = (value: string): value is ViewMode =>
  VIEW_MODES.includes(value as ViewMode)

const resolveRenderer = (args: {
  renderers: CodeBlockRenderer[]
  rendererAttr: string
  language: string
  code: string
  attrs: Record<string, unknown>
}) => {
  const { renderers, rendererAttr, language, code, attrs } = args
  if (renderers.length === 0) {
    return null
  }

  const explicitRenderer = rendererAttr && rendererAttr !== "auto"
    ? renderers.find((renderer) => renderer.id === rendererAttr)
    : undefined

  if (explicitRenderer) {
    if (explicitRenderer.id === "openapi" && language !== "openapi") {
      return null
    }
    if (explicitRenderer.id === "html" && language !== "html") {
      return null
    }
    if (explicitRenderer.id === "mermaid" && language !== "mermaid") {
      return null
    }
    return explicitRenderer
  }

  if (language !== "openapi") {
    return renderers.find((renderer) =>
      renderer.match?.({ language, code, attrs })
    ) ?? null
  }

  return (
    renderers.find((renderer) => renderer.id === "openapi") ??
    renderers.find((renderer) => renderer.match?.({ language, code, attrs })) ??
    null
  )
}

export function CodeBlockNodeView({ node, editor, extension, getPos }: NodeViewProps) {
  const options = extension?.options as CodeBlockNodeOptions | undefined
  const language = typeof node.attrs.language === "string" ? node.attrs.language : ""
  const rendererAttr = typeof node.attrs.renderer === "string" ? node.attrs.renderer : "auto"
  const preview = Boolean(node.attrs.preview)
  const collapsed = Boolean(node.attrs.collapsed)
  const supportsPreview = language === "openapi" || language === "html" || language === "mermaid"
  const rawViewMode = typeof node.attrs.view_mode === "string" ? node.attrs.view_mode : ""
  const viewMode: ViewMode = supportsPreview
    ? isViewMode(rawViewMode)
      ? rawViewMode
      : preview
        ? "preview"
        : "text"
    : "text"
  const code = node.textContent
  const attrs = node.attrs as Record<string, unknown>
  const renderers = options?.renderers?.length ? options.renderers : DEFAULT_RENDERERS
  const renderer = useMemo(
    () =>
      resolveRenderer({
        renderers,
        rendererAttr,
        language,
        code,
        attrs,
      }),
    [attrs, code, language, renderers, rendererAttr]
  )
  const isEditable = editor.isEditable
  const languageClassPrefix = options?.languageClassPrefix ?? "language-"
  const languageClass = language ? `${languageClassPrefix}${language}` : undefined

  const updateNodeAttrs = (nextAttrs: Record<string, unknown>) => {
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
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...nextAttrs })
        return true
      })
      .run()
  }

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextLanguage = event.target.value
    const nextSupportsPreview = nextLanguage === "openapi" || nextLanguage === "html" || nextLanguage === "mermaid"
    const nextRenderer = nextSupportsPreview ? nextLanguage : "auto"
    const nextViewMode: ViewMode = nextSupportsPreview ? viewMode : "text"
    const nextPreview = nextSupportsPreview ? nextViewMode !== "text" : false
    updateNodeAttrs({
      language: nextLanguage || null,
      renderer: nextRenderer,
      preview: nextPreview,
      view_mode: nextViewMode,
    })
  }

  const handleSetViewMode = (mode: ViewMode) => {
    if (!supportsPreview) {
      return
    }
    updateNodeAttrs({ preview: mode !== "text", view_mode: mode })
  }

  const handleToggleCollapsed = () => {
    updateNodeAttrs({ collapsed: !collapsed })
  }

  const renderedPreview = renderer
    ? renderer.render({
        code,
        language: language || undefined,
        attrs,
        mode: isEditable ? "edit" : "view",
        fetcher: options?.fetcher,
        projectKey: options?.projectKey,
      })
    : null

  const shouldRenderViewer = Boolean(!isEditable && renderedPreview)
  const showPreviewToggle = isEditable && supportsPreview
  const viewFrameClass = shouldRenderViewer
    ? "code-block-viewer code-block-viewer--framed"
    : "code-block-viewer"
  const languageLabel =
    LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ||
    (language ? language : "Auto")
  const shouldShowViewerBar = shouldRenderViewer
  const shouldShowContent = shouldRenderViewer ? !collapsed : true

  return (
    <NodeViewWrapper className="code-block-node">
      {isEditable ? (
        <div className="code-block-editor">
          <div className="code-block-toolbar">
            <span className="code-block-label">Language</span>
            <select
              className="code-block-select"
              value={language}
              onChange={handleLanguageChange}
              aria-label="Code block language"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value || "auto"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {showPreviewToggle ? (
              <div className="code-block-view-modes" role="group" aria-label="Code block view">
                <button
                  type="button"
                  className="code-block-view-button"
                  data-active={viewMode === "text"}
                  onClick={() => handleSetViewMode("text")}
                  aria-label="Text"
                >
                  <ViewTextIcon className="code-block-view-icon" />
                </button>
                <button
                  type="button"
                  className="code-block-view-button"
                  data-active={viewMode === "preview"}
                  onClick={() => handleSetViewMode("preview")}
                  aria-label="Preview"
                >
                  <ViewPreviewIcon className="code-block-view-icon" />
                </button>
                <button
                  type="button"
                  className="code-block-view-button"
                  data-active={viewMode === "split"}
                  onClick={() => handleSetViewMode("split")}
                  aria-label="Split view"
                >
                  <ViewSplitIcon className="code-block-view-icon" />
                </button>
              </div>
            ) : null}
          </div>
          {supportsPreview ? (
            viewMode === "split" ? (
              <div className="code-block-edit-split">
                <div className="code-block-edit-pane code-block-edit-pane--code">
                  <pre className="code-block-pre">
                    <NodeViewContent className={languageClass} />
                  </pre>
                </div>
                <div className="code-block-edit-pane code-block-edit-pane--preview">
                  <div className="code-block-preview code-block-preview--inline">
                    {renderedPreview}
                  </div>
                </div>
              </div>
            ) : viewMode === "preview" ? (
              <div className="code-block-preview code-block-preview--inline">
                {renderedPreview}
              </div>
            ) : (
              <pre className="code-block-pre">
                <NodeViewContent className={languageClass} />
              </pre>
            )
          ) : (
            <pre className="code-block-pre">
              <NodeViewContent className={languageClass} />
            </pre>
          )}
        </div>
      ) : (
        <div className={viewFrameClass}>
          {shouldShowViewerBar ? (
            <div className="code-block-viewer-bar" contentEditable={false}>
              <button
                type="button"
                className="code-block-collapse"
                data-collapsed={collapsed}
                onClick={handleToggleCollapsed}
                aria-label={collapsed ? "Expand code block" : "Collapse code block"}
              >
                <ChevronDownIcon className="code-block-collapse-icon" />
              </button>
              <span className="code-block-viewer-language">{languageLabel}</span>
            </div>
          ) : null}
          {shouldShowContent ? (
            shouldRenderViewer ? (
              <div className="code-block-preview">{renderedPreview}</div>
            ) : (
              <pre className="code-block-pre">
                {!shouldShowViewerBar ? (
                  <div className="code-block-plain-label">{languageLabel}</div>
                ) : null}
                <NodeViewContent className={languageClass} />
              </pre>
            )
          ) : null}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default CodeBlockNodeView
