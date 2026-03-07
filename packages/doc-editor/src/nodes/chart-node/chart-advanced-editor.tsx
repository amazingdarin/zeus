"use client"

import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import { EChartsViewer } from "../../viewer/EChartsViewer"
import { validateEChartsOption, formatJson, simpleToEChartsOption } from "./chart-converter"
import type { ChartType } from "./chart-node-extension"
import { parseSimpleData } from "./chart-converter"

export interface ChartAdvancedEditorProps {
  options: string
  chartType: ChartType
  simpleData: string
  height: number
  onOptionsChange: (options: string) => void
  onHeightChange: (height: number) => void
  onSwitchToSimple: () => void
  onSave: () => void
  onCancel: () => void
}

/**
 * Advanced mode chart editor with JSON editor and live preview
 */
export function ChartAdvancedEditor({
  options,
  chartType,
  simpleData,
  height,
  onOptionsChange,
  onHeightChange,
  onSwitchToSimple,
  onSave,
  onCancel,
}: ChartAdvancedEditorProps) {
  // Initialize with existing options or generate from simple data
  const initialOptions = useMemo(() => {
    if (options && options.trim()) {
      return options
    }
    // Generate from simple data
    const parsed = parseSimpleData(simpleData)
    if (parsed) {
      return JSON.stringify(simpleToEChartsOption(chartType, parsed), null, 2)
    }
    return "{}"
  }, [options, simpleData, chartType])

  const [localOptions, setLocalOptions] = useState(initialOptions)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Focus textarea on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [])

  // Validate and update parent
  const handleOptionsChange = useCallback(
    (value: string) => {
      setLocalOptions(value)
      const validation = validateEChartsOption(value)
      if (validation.valid) {
        setError(null)
        onOptionsChange(value)
      } else {
        setError(validation.error || null)
      }
    },
    [onOptionsChange]
  )

  // Format JSON
  const handleFormat = useCallback(() => {
    const formatted = formatJson(localOptions)
    setLocalOptions(formatted)
    onOptionsChange(formatted)
  }, [localOptions, onOptionsChange])

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
        onCancel()
      } else if (e.key === "f" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault()
        handleFormat()
      }
    },
    [error, onSave, onCancel, handleFormat]
  )

  // Handle tab key for indentation
  const handleTab = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault()
      const textarea = e.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const value = textarea.value
      const newValue = value.substring(0, start) + "  " + value.substring(end)
      setLocalOptions(newValue)
      // Restore cursor position
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2
      }, 0)
    }
  }, [])

  return (
    <div className="chart-advanced-editor">
      <div className="chart-advanced-content">
        {/* JSON Editor */}
        <div className="chart-json-section">
          <div className="chart-json-header">
            <span>ECharts 配置 (JSON)</span>
            <button
              type="button"
              className="chart-format-btn"
              onClick={handleFormat}
              title="格式化 JSON (⌘⇧F)"
            >
              格式化
            </button>
          </div>
          <div className="chart-json-editor-wrapper">
            <textarea
              ref={textareaRef}
              className={`chart-json-editor ${error ? "has-error" : ""}`}
              value={localOptions}
              onChange={(e) => handleOptionsChange(e.target.value)}
              onKeyDown={(e) => {
                handleKeyDown(e)
                handleTab(e)
              }}
              spellCheck={false}
              placeholder='{\n  "xAxis": { "type": "category", "data": ["A", "B", "C"] },\n  "yAxis": { "type": "value" },\n  "series": [{ "type": "bar", "data": [10, 20, 30] }]\n}'
            />
            {error && <div className="chart-json-error">{error}</div>}
          </div>
          <div className="chart-json-help">
            提示: 使用 ECharts 官方配置格式。
            <a
              href="https://echarts.apache.org/zh/option.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              查看文档 ↗
            </a>
          </div>
        </div>

        {/* Preview */}
        <div className="chart-preview-section">
          <div className="chart-preview-header">预览</div>
          <div className="chart-preview-container">
            <EChartsViewer option={localOptions} height={Math.min(height, 280)} />
          </div>
        </div>
      </div>

      {/* Height Setting */}
      <div className="chart-height-setting">
        <label>
          图表高度:
          <input
            type="range"
            min="200"
            max="600"
            step="50"
            value={height}
            onChange={(e) => onHeightChange(parseInt(e.target.value, 10))}
          />
          <span>{height}px</span>
        </label>
      </div>

      {/* Actions */}
      <div className="chart-editor-actions">
        <button type="button" className="chart-btn chart-btn-link" onClick={onSwitchToSimple}>
          切换到简化模式
        </button>
        <div className="chart-action-buttons">
          <button type="button" className="chart-btn chart-btn-cancel" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="chart-btn chart-btn-save"
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

export default ChartAdvancedEditor
