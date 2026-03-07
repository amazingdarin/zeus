"use client"

import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import { useState, useCallback, useMemo } from "react"
import type { ChartType, ChartMode } from "./chart-node-extension"
import { DEFAULT_SIMPLE_DATA } from "./chart-node-extension"
import { ChartSimpleEditor } from "./chart-simple-editor"
import { ChartAdvancedEditor } from "./chart-advanced-editor"
import { EChartsViewer } from "../../viewer/EChartsViewer"
import { simpleToEChartsOption, parseSimpleData } from "./chart-converter"
import "./chart-node.scss"

export function ChartNodeView({
  node,
  editor,
  updateAttributes,
  selected,
}: NodeViewProps) {
  const {
    options,
    chartType,
    simpleData,
    mode,
    width,
    height,
  } = node.attrs as {
    options: string
    chartType: ChartType
    simpleData: string
    mode: ChartMode
    width: number
    height: number
  }

  const isEditable = editor.isEditable
  const [isEditing, setIsEditing] = useState(false)

  // Local editing state
  const [editChartType, setEditChartType] = useState(chartType)
  const [editSimpleData, setEditSimpleData] = useState(simpleData)
  const [editOptions, setEditOptions] = useState(options)
  const [editMode, setEditMode] = useState(mode)
  const [editHeight, setEditHeight] = useState(height)

  // Generate display option from current data
  const displayOption = useMemo(() => {
    // If advanced mode with valid options, use that
    if (mode === "advanced" && options && options.trim()) {
      try {
        return JSON.parse(options)
      } catch {
        // Fall back to simple data
      }
    }
    // Otherwise use simple data
    const parsed = parseSimpleData(simpleData)
    if (parsed) {
      return simpleToEChartsOption(chartType, parsed)
    }
    return null
  }, [mode, options, simpleData, chartType])

  // Handle double click to edit
  const handleDoubleClick = useCallback(() => {
    if (isEditable) {
      setEditChartType(chartType)
      setEditSimpleData(simpleData)
      setEditOptions(options)
      setEditMode(mode)
      setEditHeight(height)
      setIsEditing(true)
    }
  }, [isEditable, chartType, simpleData, options, mode, height])

  // Save changes
  const handleSave = useCallback(() => {
    updateAttributes({
      chartType: editChartType,
      simpleData: editSimpleData,
      options: editOptions,
      mode: editMode,
      height: editHeight,
    })
    setIsEditing(false)
  }, [updateAttributes, editChartType, editSimpleData, editOptions, editMode, editHeight])

  // Cancel editing
  const handleCancel = useCallback(() => {
    setEditChartType(chartType)
    setEditSimpleData(simpleData)
    setEditOptions(options)
    setEditMode(mode)
    setEditHeight(height)
    setIsEditing(false)
  }, [chartType, simpleData, options, mode, height])

  // Switch to advanced mode
  const handleSwitchToAdvanced = useCallback(() => {
    // Generate options from simple data if not set
    if (!editOptions || !editOptions.trim()) {
      const parsed = parseSimpleData(editSimpleData)
      if (parsed) {
        const option = simpleToEChartsOption(editChartType, parsed)
        setEditOptions(JSON.stringify(option, null, 2))
      }
    }
    setEditMode("advanced")
  }, [editOptions, editSimpleData, editChartType])

  // Switch to simple mode
  const handleSwitchToSimple = useCallback(() => {
    setEditMode("simple")
  }, [])

  // Handle chart type change
  const handleChartTypeChange = useCallback((type: ChartType) => {
    setEditChartType(type)
    // Reset simple data for new chart type
    setEditSimpleData(DEFAULT_SIMPLE_DATA[type])
    // Clear advanced options
    setEditOptions("")
  }, [])

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

  const wrapperClass = `chart-node ${selected ? "chart-selected" : ""}`

  // Edit mode
  if (isEditing && isEditable) {
    return (
      <NodeViewWrapper
        className={`${wrapperClass} chart-editing`}
        contentEditable={false}
        onKeyDown={handleKeyDown}
      >
        {editMode === "simple" ? (
          <ChartSimpleEditor
            chartType={editChartType}
            simpleData={editSimpleData}
            height={editHeight}
            onChartTypeChange={handleChartTypeChange}
            onSimpleDataChange={setEditSimpleData}
            onHeightChange={setEditHeight}
            onSwitchToAdvanced={handleSwitchToAdvanced}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        ) : (
          <ChartAdvancedEditor
            options={editOptions}
            chartType={editChartType}
            simpleData={editSimpleData}
            height={editHeight}
            onOptionsChange={setEditOptions}
            onHeightChange={setEditHeight}
            onSwitchToSimple={handleSwitchToSimple}
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
      style={{ width: `${width}%` }}
    >
      {displayOption ? (
        <div className="chart-viewer-container">
          <EChartsViewer option={displayOption} height={height} />
          {isEditable && (
            <div className="chart-edit-hint">双击编辑图表</div>
          )}
        </div>
      ) : (
        <div
          className="chart-placeholder"
          onClick={handleDoubleClick}
          style={{ height: `${height}px` }}
        >
          <div className="chart-placeholder-icon">📊</div>
          <div className="chart-placeholder-text">点击添加图表</div>
        </div>
      )}
    </NodeViewWrapper>
  )
}

export default ChartNodeView
