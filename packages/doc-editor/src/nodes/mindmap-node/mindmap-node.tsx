"use client"

import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import { useState, useCallback, useMemo } from "react"
import type { MindmapLayout } from "./mindmap-converter"
import type { MindmapMode } from "./mindmap-node-extension"
import {
  parseTreeData,
  treeToEChartsOption,
  stringifyTreeData,
  treeToIndentedText,
  indentedTextToTree,
} from "./mindmap-converter"
import { MindmapOutlineEditor } from "./mindmap-outline-editor"
import { MindmapTextEditor } from "./mindmap-text-editor"
import { EChartsViewer } from "../../viewer/EChartsViewer"
import "./mindmap-node.scss"

export function MindmapNodeView({
  node,
  editor,
  updateAttributes,
  selected,
}: NodeViewProps) {
  const { data, mode, layout, height } = node.attrs as {
    data: string
    mode: MindmapMode
    layout: MindmapLayout
    height: number
  }

  const isEditable = editor.isEditable
  const [isEditing, setIsEditing] = useState(false)

  // Local editing state
  const [editData, setEditData] = useState(data)
  const [editMode, setEditMode] = useState(mode)
  const [editLayout, setEditLayout] = useState(layout)
  const [editHeight, setEditHeight] = useState(height)

  // Generate display option from current data
  const displayOption = useMemo(() => {
    const tree = parseTreeData(data)
    if (tree) {
      return treeToEChartsOption(tree, layout)
    }
    return null
  }, [data, layout])

  // Handle double click to edit
  const handleDoubleClick = useCallback(() => {
    if (isEditable) {
      setEditData(data)
      setEditMode(mode)
      setEditLayout(layout)
      setEditHeight(height)
      setIsEditing(true)
    }
  }, [isEditable, data, mode, layout, height])

  // Save changes
  const handleSave = useCallback(() => {
    updateAttributes({
      data: editData,
      mode: editMode,
      layout: editLayout,
      height: editHeight,
    })
    setIsEditing(false)
  }, [updateAttributes, editData, editMode, editLayout, editHeight])

  // Cancel editing
  const handleCancel = useCallback(() => {
    setEditData(data)
    setEditMode(mode)
    setEditLayout(layout)
    setEditHeight(height)
    setIsEditing(false)
  }, [data, mode, layout, height])

  // Switch between outline and text mode
  const handleSwitchToText = useCallback(() => {
    // Convert current data to text representation
    const tree = parseTreeData(editData)
    if (tree) {
      // Data stays the same, just switch mode
      setEditMode("text")
    }
  }, [editData])

  const handleSwitchToOutline = useCallback(() => {
    // When switching back, re-parse text to tree data
    const tree = parseTreeData(editData)
    if (tree) {
      setEditData(stringifyTreeData(tree))
    }
    setEditMode("outline")
  }, [editData])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        handleSave()
      } else if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        handleCancel()
      }
    },
    [handleSave, handleCancel]
  )

  const wrapperClass = `mindmap-node ${selected ? "mindmap-selected" : ""}`

  // Edit mode
  if (isEditing && isEditable) {
    return (
      <NodeViewWrapper
        className={`${wrapperClass} mindmap-editing`}
        contentEditable={false}
        onKeyDown={handleKeyDown}
      >
        {editMode === "outline" ? (
          <MindmapOutlineEditor
            data={editData}
            layout={editLayout}
            height={editHeight}
            onDataChange={setEditData}
            onLayoutChange={setEditLayout}
            onHeightChange={setEditHeight}
            onSwitchToText={handleSwitchToText}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        ) : (
          <MindmapTextEditor
            data={editData}
            layout={editLayout}
            height={editHeight}
            onDataChange={setEditData}
            onLayoutChange={setEditLayout}
            onHeightChange={setEditHeight}
            onSwitchToOutline={handleSwitchToOutline}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        )}
      </NodeViewWrapper>
    )
  }

  // View mode
  return (
    <NodeViewWrapper
      className={wrapperClass}
      contentEditable={false}
      onDoubleClick={handleDoubleClick}
    >
      {displayOption ? (
        <div className="mindmap-viewer-container">
          <EChartsViewer option={displayOption} height={height} />
          {isEditable && (
            <div className="mindmap-edit-hint">双击编辑脑图</div>
          )}
        </div>
      ) : (
        <div
          className="mindmap-placeholder"
          onClick={handleDoubleClick}
          style={{ height: `${height}px` }}
        >
          <div className="mindmap-placeholder-icon">🧠</div>
          <div className="mindmap-placeholder-text">点击添加脑图</div>
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default MindmapNodeView
