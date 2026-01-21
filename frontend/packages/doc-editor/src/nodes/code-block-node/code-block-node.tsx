"use client"

import { useMemo } from "react"
import type { ChangeEvent } from "react"
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"

import OpenApiSpecViewer from "../../viewer/OpenApiSpecViewer"
import type { OpenApiSourceType } from "../openapi-node/openapi-node-extension"
import type { CodeBlockNodeOptions, CodeBlockRenderer } from "./code-block-node-extension"

const LANGUAGE_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "openapi", label: "OpenAPI" },
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
]

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
    const nextRenderer = nextLanguage === "openapi" ? "openapi" : "auto"
    const nextPreview = nextLanguage === "openapi" ? preview : false
    updateNodeAttrs({
      language: nextLanguage || null,
      renderer: nextRenderer,
      preview: nextPreview,
    })
  }

  const handleTogglePreview = () => {
    updateNodeAttrs({ preview: !preview })
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

  const shouldShowPreview = Boolean(isEditable && preview && renderedPreview)
  const shouldRenderViewer = Boolean(!isEditable && renderedPreview)
  const showPreviewToggle = isEditable && language === "openapi"

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
              <button
                type="button"
                className="code-block-preview-toggle"
                data-active={preview}
                onClick={handleTogglePreview}
              >
                Preview
              </button>
            ) : null}
          </div>
          <pre className="code-block-pre">
            <NodeViewContent className={languageClass} />
          </pre>
          {shouldShowPreview ? (
            <div className="code-block-preview">{renderedPreview}</div>
          ) : null}
        </div>
      ) : shouldRenderViewer ? (
        <div className="code-block-preview">{renderedPreview}</div>
      ) : (
        <pre className="code-block-pre">
          <NodeViewContent className={languageClass} />
        </pre>
      )}
    </NodeViewWrapper>
  )
}

export default CodeBlockNodeView
