"use client"

import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import katex from "katex"
import "katex/dist/katex.min.css"
import { useMemo, useState, useCallback, useRef, useEffect } from "react"

export function MathNodeView({
  node,
  editor,
  updateAttributes,
  selected,
}: NodeViewProps) {
  const { latex, display } = node.attrs as { latex: string; display: boolean }
  const isEditable = editor.isEditable
  const [isEditing, setIsEditing] = useState(!latex && isEditable)
  const [editValue, setEditValue] = useState(latex)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Render formula using KaTeX
  const rendered = useMemo(() => {
    if (!latex) {
      return null
    }
    try {
      return katex.renderToString(latex, {
        displayMode: display,
        throwOnError: false,
        output: "html",
        strict: false,
      })
    } catch (error) {
      return `<span class="math-error">Invalid formula: ${error instanceof Error ? error.message : "Unknown error"}</span>`
    }
  }, [latex, display])

  const handleDoubleClick = useCallback(() => {
    if (isEditable) {
      setEditValue(latex)
      setIsEditing(true)
    }
  }, [isEditable, latex])

  const handleSave = useCallback(() => {
    updateAttributes({ latex: editValue })
    setIsEditing(false)
  }, [editValue, updateAttributes])

  const handleCancel = useCallback(() => {
    setEditValue(latex)
    setIsEditing(false)
  }, [latex])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSave()
      } else if (e.key === "Escape") {
        e.preventDefault()
        handleCancel()
      }
    },
    [handleSave, handleCancel]
  )

  const wrapperClass = display ? "math-block" : "math-inline"
  const selectedClass = selected ? "math-selected" : ""

  // Edit mode
  if (isEditing && isEditable) {
    return (
      <NodeViewWrapper
        className={`math-node ${wrapperClass} math-editing`}
        contentEditable={false}
      >
        <div className="math-editor">
          <textarea
            ref={inputRef}
            className="math-editor-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={display ? "Enter block formula..." : "Enter inline formula..."}
            rows={display ? 3 : 1}
          />
          <div className="math-editor-preview">
            {editValue ? (
              <span
                dangerouslySetInnerHTML={{
                  __html: katex.renderToString(editValue, {
                    displayMode: display,
                    throwOnError: false,
                    output: "html",
                    strict: false,
                  }),
                }}
              />
            ) : (
              <span className="math-placeholder">Preview</span>
            )}
          </div>
          <div className="math-editor-actions">
            <button
              type="button"
              className="math-editor-btn math-editor-btn-cancel"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="math-editor-btn math-editor-btn-save"
              onClick={handleSave}
            >
              Save (⌘↵)
            </button>
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  // View mode
  return (
    <NodeViewWrapper
      className={`math-node ${wrapperClass} ${selectedClass}`}
      contentEditable={false}
      onDoubleClick={handleDoubleClick}
    >
      {rendered ? (
        <span
          className="math-content"
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      ) : (
        <span className="math-placeholder" onClick={handleDoubleClick}>
          {display ? "Click to add block formula" : "Click to add formula"}
        </span>
      )}
    </NodeViewWrapper>
  )
}

export default MathNodeView
