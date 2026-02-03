"use client"

import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import abcjs from "abcjs"
import { useRef, useState, useCallback, useEffect } from "react"

export function MusicNodeView({
  node,
  editor,
  updateAttributes,
  selected,
}: NodeViewProps) {
  const { abc, display } = node.attrs as { abc: string; display: boolean }
  const isEditable = editor.isEditable
  const [isEditing, setIsEditing] = useState(!abc && isEditable)
  const [editValue, setEditValue] = useState(abc)
  const [renderError, setRenderError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Render ABC notation using abcjs
  useEffect(() => {
    if (!isEditing && containerRef.current && abc) {
      try {
        const result = abcjs.renderAbc(containerRef.current, abc, {
          responsive: "resize",
          add_classes: true,
          staffwidth: display ? 600 : 300,
          scale: display ? 1 : 0.8,
          paddingtop: 0,
          paddingbottom: 0,
          paddingleft: 0,
          paddingright: 0,
        })
        if (result && result[0] && result[0].warnings && result[0].warnings.length > 0) {
          setRenderError(result[0].warnings.join(", "))
        } else {
          setRenderError(null)
        }
      } catch (error) {
        setRenderError(error instanceof Error ? error.message : "Unknown error")
      }
    }
  }, [abc, display, isEditing])

  // Render preview in edit mode
  const previewRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (isEditing && previewRef.current && editValue) {
      try {
        abcjs.renderAbc(previewRef.current, editValue, {
          responsive: "resize",
          add_classes: true,
          staffwidth: display ? 500 : 250,
          scale: display ? 0.8 : 0.6,
          paddingtop: 0,
          paddingbottom: 0,
          paddingleft: 0,
          paddingright: 0,
        })
      } catch {
        // Ignore preview errors
      }
    }
  }, [editValue, display, isEditing])

  const handleDoubleClick = useCallback(() => {
    if (isEditable) {
      setEditValue(abc)
      setIsEditing(true)
    }
  }, [isEditable, abc])

  const handleSave = useCallback(() => {
    updateAttributes({ abc: editValue })
    setIsEditing(false)
  }, [editValue, updateAttributes])

  const handleCancel = useCallback(() => {
    setEditValue(abc)
    setIsEditing(false)
  }, [abc])

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

  const wrapperClass = display ? "music-block" : "music-inline"
  const selectedClass = selected ? "music-selected" : ""

  // Edit mode
  if (isEditing && isEditable) {
    return (
      <NodeViewWrapper
        className={`music-node ${wrapperClass} music-editing`}
        contentEditable={false}
      >
        <div className="music-editor">
          <textarea
            ref={inputRef}
            className="music-editor-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={display ? "Enter ABC notation...\nX:1\nT:Title\nM:4/4\nK:C\nC D E F |" : "Enter ABC notation..."}
            rows={display ? 6 : 2}
          />
          <div className="music-editor-preview" ref={previewRef}>
            {!editValue && <span className="music-placeholder">Preview</span>}
          </div>
          <div className="music-editor-actions">
            <button
              type="button"
              className="music-editor-btn music-editor-btn-cancel"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="music-editor-btn music-editor-btn-save"
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
      className={`music-node ${wrapperClass} ${selectedClass}`}
      contentEditable={false}
      onDoubleClick={handleDoubleClick}
    >
      {abc ? (
        <>
          <div ref={containerRef} className="music-content" />
          {renderError && <span className="music-error">{renderError}</span>}
        </>
      ) : (
        <span className="music-placeholder" onClick={handleDoubleClick}>
          {display ? "Click to add music score" : "Click to add music"}
        </span>
      )}
    </NodeViewWrapper>
  )
}

export default MusicNodeView
