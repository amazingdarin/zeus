"use client"

import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import type { MindmapLayout } from "./mindmap-converter"
import {
  parseTreeData,
  treeToEChartsOption,
  treeToIndentedText,
  indentedTextToTree,
  stringifyTreeData,
} from "./mindmap-converter"
import { EChartsViewer } from "../../viewer/EChartsViewer"

const LAYOUT_OPTIONS: { layout: MindmapLayout; label: string; icon: string }[] =
  [
    { layout: "LR", label: "水平", icon: "⟶" },
    { layout: "TB", label: "垂直", icon: "⬇" },
    { layout: "radial", label: "辐射", icon: "◎" },
  ]

export interface MindmapTextEditorProps {
  data: string
  layout: MindmapLayout
  height: number
  onDataChange: (data: string) => void
  onLayoutChange: (layout: MindmapLayout) => void
  onHeightChange: (height: number) => void
  onSwitchToOutline: () => void
  onSave: () => void
  onCancel: () => void
}

/**
 * Text-based mind map editor with indented text and live preview
 */
export function MindmapTextEditor({
  data,
  layout,
  height,
  onDataChange,
  onLayoutChange,
  onHeightChange,
  onSwitchToOutline,
  onSave,
  onCancel,
}: MindmapTextEditorProps) {
  // Initialize text from tree data
  const initialText = useMemo(() => {
    const tree = parseTreeData(data)
    return tree ? treeToIndentedText(tree) : "中心主题"
  }, [data])

  const [localText, setLocalText] = useState(initialText)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [])

  // Parse text to tree for preview
  const previewTree = useMemo(() => {
    const tree = indentedTextToTree(localText)
    return tree
  }, [localText])

  const previewOption = useMemo(() => {
    if (!previewTree) return null
    return treeToEChartsOption(previewTree, layout)
  }, [previewTree, layout])

  // Handle text change
  const handleTextChange = useCallback(
    (value: string) => {
      setLocalText(value)
      const tree = indentedTextToTree(value)
      if (tree) {
        setError(null)
        onDataChange(stringifyTreeData(tree))
      } else {
        setError("无法解析文本，请确保至少有一行非空内容")
      }
    },
    [onDataChange]
  )

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (!error) {
          onSave()
        }
      } else if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    },
    [error, onSave, onCancel]
  )

  // Handle tab key for indentation
  const handleTab = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault()
        const textarea = e.currentTarget
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const value = textarea.value

        if (e.shiftKey) {
          // Outdent: remove leading 2 spaces from current line
          const lineStart = value.lastIndexOf("\n", start - 1) + 1
          const linePrefix = value.substring(lineStart, lineStart + 2)
          if (linePrefix === "  ") {
            const newValue =
              value.substring(0, lineStart) + value.substring(lineStart + 2)
            setLocalText(newValue)
            handleTextChange(newValue)
            setTimeout(() => {
              textarea.selectionStart = textarea.selectionEnd = Math.max(
                start - 2,
                lineStart
              )
            }, 0)
          }
        } else {
          // Indent: add 2 spaces at the beginning of current line
          const lineStart = value.lastIndexOf("\n", start - 1) + 1
          const newValue =
            value.substring(0, lineStart) + "  " + value.substring(lineStart)
          setLocalText(newValue)
          handleTextChange(newValue)
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + 2
          }, 0)
        }
      }
    },
    [handleTextChange]
  )

  return (
    <div className="mindmap-text-editor">
      {/* Layout Selector */}
      <div className="mindmap-layout-selector">
        <div className="mindmap-layout-label">布局方向</div>
        <div className="mindmap-layout-grid">
          {LAYOUT_OPTIONS.map(({ layout: l, label, icon }) => (
            <button
              key={l}
              type="button"
              className={`mindmap-layout-card ${layout === l ? "active" : ""}`}
              onClick={() => onLayoutChange(l)}
            >
              <span className="mindmap-layout-icon">{icon}</span>
              <span className="mindmap-layout-name">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main content: Text editor + Preview */}
      <div className="mindmap-text-content">
        {/* Text Editor */}
        <div className="mindmap-text-section">
          <div className="mindmap-text-header">
            <span>缩进文本</span>
          </div>
          <textarea
            ref={textareaRef}
            className={`mindmap-textarea ${error ? "has-error" : ""}`}
            value={localText}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={(e) => {
              handleKeyDown(e)
              handleTab(e)
            }}
            spellCheck={false}
            placeholder={
              "中心主题\n  分支 1\n    子项 1.1\n    子项 1.2\n  分支 2"
            }
          />
          {error && <div className="mindmap-text-error">{error}</div>}
          <div className="mindmap-text-help">
            提示: 每行一个节点，使用 2 个空格缩进表示层级关系。Tab / Shift+Tab
            可调整缩进。
          </div>
        </div>

        {/* Preview */}
        <div className="mindmap-preview-section">
          <div className="mindmap-preview-header">预览</div>
          <div className="mindmap-preview-container">
            {previewOption ? (
              <EChartsViewer
                option={previewOption}
                height={Math.min(height, 300)}
              />
            ) : (
              <div
                style={{
                  height: Math.min(height, 300),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#9ca3af",
                  fontSize: 14,
                }}
              >
                输入文本以预览脑图
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Height Setting */}
      <div className="mindmap-height-setting">
        <label>
          脑图高度:
          <input
            type="range"
            min="200"
            max="800"
            step="50"
            value={height}
            onChange={(e) => onHeightChange(parseInt(e.target.value, 10))}
          />
          <span>{height}px</span>
        </label>
      </div>

      {/* Actions */}
      <div className="mindmap-editor-actions">
        <button
          type="button"
          className="mindmap-btn mindmap-btn-link"
          onClick={onSwitchToOutline}
        >
          切换到大纲模式
        </button>
        <div className="mindmap-action-buttons">
          <button
            type="button"
            className="mindmap-btn mindmap-btn-cancel"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="mindmap-btn mindmap-btn-save"
            onClick={onSave}
            disabled={!!error}
          >
            保存 (⌘↵)
          </button>
        </div>
      </div>
    </div>
  )
}

export default MindmapTextEditor
