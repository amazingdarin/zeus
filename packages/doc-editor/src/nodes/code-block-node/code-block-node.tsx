"use client"

import { useMemo, useCallback } from "react"
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
import { mapCodeExecStatusLabel, resolveCodeExecButtonState } from "./code-block-exec-ui"

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
const EXEC_LANGUAGES = new Set(["python", "javascript", "typescript", "bash"])

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
  const blockId = typeof attrs.id === "string" ? attrs.id : ""
  const codeExecState = blockId ? options?.codeExecStateByBlockId?.[blockId] : undefined
  const canRunCodeExec =
    isEditable
    && Boolean(blockId)
    && Boolean(options?.onCodeExecRun)
    && EXEC_LANGUAGES.has((language || "").toLowerCase())
  const runButtonState = resolveCodeExecButtonState({
    editable: isEditable,
    running: Boolean(codeExecState?.running),
  })
  const runStatusLabel = mapCodeExecStatusLabel(codeExecState?.lastStatus)
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

  const handleSetViewMode = (mode: ViewMode) => {
    if (!supportsPreview) {
      return
    }
    updateNodeAttrs({ preview: mode !== "text", view_mode: mode })
  }

  const handleToggleCollapsed = () => {
    updateNodeAttrs({ collapsed: !collapsed })
  }

  const handleRunCode = () => {
    if (!canRunCodeExec || runButtonState.disabled) {
      return
    }
    const trigger = options?.onCodeExecRun
    if (!trigger) {
      return
    }
    void Promise.resolve(
      trigger({
        blockId,
        language,
        code,
      })
    ).catch((err) => {
      console.error("[doc-editor] code block run failed:", err)
    })
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
  const shouldShowEditToolbar = isEditable && (showPreviewToggle || canRunCodeExec)
  const viewFrameClass = shouldRenderViewer
    ? "code-block-viewer code-block-viewer--framed"
    : "code-block-viewer"
  const languageLabel =
    LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ||
    (language ? language : "Auto")
  const shouldShowViewerBar = shouldRenderViewer
  const shouldShowContent = shouldRenderViewer ? !collapsed : true

  // Emit custom events for code block hover state
  const handleMouseEnter = useCallback(() => {
    if (isEditable) {
      document.dispatchEvent(new CustomEvent("codeblock-hover", { 
        detail: { hover: true },
        bubbles: true 
      }))
    }
  }, [isEditable])

  const handleMouseLeave = useCallback(() => {
    if (isEditable) {
      document.dispatchEvent(new CustomEvent("codeblock-hover", { 
        detail: { hover: false },
        bubbles: true 
      }))
    }
  }, [isEditable])

  return (
    <NodeViewWrapper className="code-block-node">
      <div
        className="code-block-hover-wrapper"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
      {isEditable ? (
        <div className="code-block-editor">
          {shouldShowEditToolbar ? (
            <div className="code-block-view-toolbar" contentEditable={false}>
              {canRunCodeExec ? (
                <div className="code-block-run-group">
                  <button
                    type="button"
                    className="code-block-run-button"
                    disabled={runButtonState.disabled}
                    onClick={handleRunCode}
                    aria-label="Run code block"
                  >
                    {runButtonState.label}
                  </button>
                  {runStatusLabel ? (
                    <span className="code-block-run-status">{runStatusLabel}</span>
                  ) : null}
                </div>
              ) : null}
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
          ) : null}
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
      </div>
    </NodeViewWrapper>
  )
}

export default CodeBlockNodeView
