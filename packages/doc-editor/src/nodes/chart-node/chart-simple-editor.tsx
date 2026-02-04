"use client"

import { useState, useCallback, useMemo } from "react"
import type { ChartType } from "./chart-node-extension"
import type { SimpleChartData, DatasetItem } from "./chart-converter"
import { parseSimpleData, stringifySimpleData, simpleToEChartsOption } from "./chart-converter"
import { EChartsViewer } from "../../viewer/EChartsViewer"

// Chart type definitions with icons and labels
const CHART_TYPES: { type: ChartType; label: string; icon: string }[] = [
  { type: "bar", label: "柱状图", icon: "📊" },
  { type: "line", label: "折线图", icon: "📈" },
  { type: "pie", label: "饼图", icon: "🥧" },
  { type: "scatter", label: "散点图", icon: "⚬" },
  { type: "radar", label: "雷达图", icon: "🕸️" },
  { type: "funnel", label: "漏斗图", icon: "🔻" },
]

export interface ChartSimpleEditorProps {
  chartType: ChartType
  simpleData: string
  height: number
  onChartTypeChange: (type: ChartType) => void
  onSimpleDataChange: (data: string) => void
  onHeightChange: (height: number) => void
  onSwitchToAdvanced: () => void
  onSave: () => void
  onCancel: () => void
}

/**
 * Simple mode chart editor with chart type selector and data table
 */
export function ChartSimpleEditor({
  chartType,
  simpleData,
  height,
  onChartTypeChange,
  onSimpleDataChange,
  onHeightChange,
  onSwitchToAdvanced,
  onSave,
  onCancel,
}: ChartSimpleEditorProps) {
  const parsedData = useMemo(() => parseSimpleData(simpleData), [simpleData])
  const [localData, setLocalData] = useState<SimpleChartData>(
    parsedData || { labels: ["类别1"], datasets: [{ name: "系列1", values: [100] }] }
  )

  // Update parent when local data changes
  const updateData = useCallback(
    (newData: SimpleChartData) => {
      setLocalData(newData)
      onSimpleDataChange(stringifySimpleData(newData))
    },
    [onSimpleDataChange]
  )

  // Generate preview option
  const previewOption = useMemo(
    () => simpleToEChartsOption(chartType, localData),
    [chartType, localData]
  )

  // Handle chart type change
  const handleChartTypeChange = useCallback(
    (type: ChartType) => {
      onChartTypeChange(type)
      // Reset data for new chart type if structure is incompatible
      if (type === "scatter" && !Array.isArray(localData.datasets[0]?.values[0])) {
        updateData({
          datasets: [
            {
              name: "数据点",
              values: [
                [10, 20],
                [20, 30],
                [30, 40],
              ],
            },
          ],
        })
      }
    },
    [localData, onChartTypeChange, updateData]
  )

  // Add a new label (row)
  const handleAddLabel = useCallback(() => {
    const newLabels = [...(localData.labels || []), `类别${(localData.labels?.length || 0) + 1}`]
    const newDatasets = localData.datasets.map((ds) => ({
      ...ds,
      values: [...(ds.values as number[]), 0],
    }))
    updateData({ ...localData, labels: newLabels, datasets: newDatasets })
  }, [localData, updateData])

  // Remove a label (row)
  const handleRemoveLabel = useCallback(
    (index: number) => {
      if ((localData.labels?.length || 0) <= 1) return
      const newLabels = localData.labels?.filter((_, i) => i !== index) || []
      const newDatasets = localData.datasets.map((ds) => ({
        ...ds,
        values: (ds.values as number[]).filter((_, i) => i !== index),
      }))
      updateData({ ...localData, labels: newLabels, datasets: newDatasets })
    },
    [localData, updateData]
  )

  // Add a new dataset (column)
  const handleAddDataset = useCallback(() => {
    const newDataset: DatasetItem = {
      name: `系列${localData.datasets.length + 1}`,
      values: (localData.labels || []).map(() => 0),
    }
    updateData({ ...localData, datasets: [...localData.datasets, newDataset] })
  }, [localData, updateData])

  // Remove a dataset (column)
  const handleRemoveDataset = useCallback(
    (index: number) => {
      if (localData.datasets.length <= 1) return
      const newDatasets = localData.datasets.filter((_, i) => i !== index)
      updateData({ ...localData, datasets: newDatasets })
    },
    [localData, updateData]
  )

  // Update a label
  const handleLabelChange = useCallback(
    (index: number, value: string) => {
      const newLabels = [...(localData.labels || [])]
      newLabels[index] = value
      updateData({ ...localData, labels: newLabels })
    },
    [localData, updateData]
  )

  // Update a dataset name
  const handleDatasetNameChange = useCallback(
    (index: number, value: string) => {
      const newDatasets = [...localData.datasets]
      newDatasets[index] = { ...newDatasets[index], name: value }
      updateData({ ...localData, datasets: newDatasets })
    },
    [localData, updateData]
  )

  // Update a cell value
  const handleCellChange = useCallback(
    (datasetIndex: number, labelIndex: number, value: string) => {
      const numValue = parseFloat(value) || 0
      const newDatasets = [...localData.datasets]
      const newValues = [...(newDatasets[datasetIndex].values as number[])]
      newValues[labelIndex] = numValue
      newDatasets[datasetIndex] = { ...newDatasets[datasetIndex], values: newValues }
      updateData({ ...localData, datasets: newDatasets })
    },
    [localData, updateData]
  )

  const isScatter = chartType === "scatter"

  return (
    <div className="chart-simple-editor">
      {/* Chart Type Selector */}
      <div className="chart-type-selector">
        <div className="chart-type-label">图表类型</div>
        <div className="chart-type-grid">
          {CHART_TYPES.map(({ type, label, icon }) => (
            <button
              key={type}
              type="button"
              className={`chart-type-card ${chartType === type ? "active" : ""}`}
              onClick={() => handleChartTypeChange(type)}
            >
              <span className="chart-type-icon">{icon}</span>
              <span className="chart-type-name">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main content: Data table + Preview */}
      <div className="chart-editor-content">
        {/* Data Table */}
        <div className="chart-data-section">
          <div className="chart-data-header">
            <span>数据配置</span>
            <div className="chart-data-actions">
              {!isScatter && (
                <>
                  <button type="button" className="chart-action-btn" onClick={handleAddLabel}>
                    + 行
                  </button>
                  <button type="button" className="chart-action-btn" onClick={handleAddDataset}>
                    + 列
                  </button>
                </>
              )}
            </div>
          </div>

          {isScatter ? (
            <ScatterDataEditor
              data={localData}
              onDataChange={updateData}
            />
          ) : (
            <div className="chart-data-table-wrapper">
              <table className="chart-data-table">
                <thead>
                  <tr>
                    <th className="chart-cell-header chart-cell-label-header">
                      <span className="chart-header-text">标签</span>
                    </th>
                    {localData.datasets.map((ds, i) => (
                      <th key={i} className="chart-cell-header chart-cell-value-header">
                        <div className="chart-header-cell">
                          <input
                            type="text"
                            value={ds.name}
                            onChange={(e) => handleDatasetNameChange(i, e.target.value)}
                            className="chart-cell-input chart-header-input"
                          />
                          {localData.datasets.length > 1 && (
                            <button
                              type="button"
                              className="chart-remove-col-btn"
                              onClick={() => handleRemoveDataset(i)}
                              title="删除此列"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(localData.labels || []).map((label, labelIndex) => (
                    <tr key={labelIndex}>
                      <td className="chart-cell-label">
                        <div className="chart-label-cell">
                          <input
                            type="text"
                            value={label}
                            onChange={(e) => handleLabelChange(labelIndex, e.target.value)}
                            className="chart-cell-input"
                          />
                          {(localData.labels?.length || 0) > 1 && (
                            <button
                              type="button"
                              className="chart-remove-row-btn"
                              onClick={() => handleRemoveLabel(labelIndex)}
                              title="删除此行"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </td>
                      {localData.datasets.map((ds, dsIndex) => (
                        <td key={dsIndex} className="chart-cell-value">
                          <input
                            type="number"
                            value={(ds.values as number[])[labelIndex] || 0}
                            onChange={(e) =>
                              handleCellChange(dsIndex, labelIndex, e.target.value)
                            }
                            className="chart-cell-input chart-value-input"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="chart-preview-section">
          <div className="chart-preview-header">预览</div>
          <div className="chart-preview-container">
            <EChartsViewer option={previewOption} height={Math.min(height, 250)} />
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
        <button type="button" className="chart-btn chart-btn-link" onClick={onSwitchToAdvanced}>
          切换到高级模式
        </button>
        <div className="chart-action-buttons">
          <button type="button" className="chart-btn chart-btn-cancel" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="chart-btn chart-btn-save" onClick={onSave}>
            保存 (⌘↵)
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Special editor for scatter chart (X-Y data pairs)
 */
function ScatterDataEditor({
  data,
  onDataChange,
}: {
  data: SimpleChartData
  onDataChange: (data: SimpleChartData) => void
}) {
  const points = (data.datasets[0]?.values || []) as [number, number][]

  const handleAddPoint = () => {
    const newPoints: [number, number][] = [...points, [0, 0]]
    onDataChange({
      ...data,
      datasets: [{ ...data.datasets[0], values: newPoints }],
    })
  }

  const handleRemovePoint = (index: number) => {
    if (points.length <= 1) return
    const newPoints = points.filter((_, i) => i !== index)
    onDataChange({
      ...data,
      datasets: [{ ...data.datasets[0], values: newPoints }],
    })
  }

  const handlePointChange = (index: number, axis: 0 | 1, value: string) => {
    const numValue = parseFloat(value) || 0
    const newPoints = [...points]
    newPoints[index] = [...newPoints[index]] as [number, number]
    newPoints[index][axis] = numValue
    onDataChange({
      ...data,
      datasets: [{ ...data.datasets[0], values: newPoints }],
    })
  }

  return (
    <div className="chart-scatter-editor">
      <div className="chart-scatter-header">
        <span>X</span>
        <span>Y</span>
        <span></span>
      </div>
      {points.map((point, i) => (
        <div key={i} className="chart-scatter-row">
          <input
            type="number"
            value={point[0]}
            onChange={(e) => handlePointChange(i, 0, e.target.value)}
            className="chart-cell-input"
          />
          <input
            type="number"
            value={point[1]}
            onChange={(e) => handlePointChange(i, 1, e.target.value)}
            className="chart-cell-input"
          />
          {points.length > 1 && (
            <button
              type="button"
              className="chart-remove-btn"
              onClick={() => handleRemovePoint(i)}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button type="button" className="chart-action-btn" onClick={handleAddPoint}>
        + 添加数据点
      </button>
    </div>
  )
}

export default ChartSimpleEditor
