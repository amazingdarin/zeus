"use client"

import { useRef, useEffect, useState } from "react"
import * as echarts from "echarts"
import type { EChartsOption } from "echarts"

export interface EChartsViewerProps {
  /**
   * ECharts option object or JSON string
   */
  option: EChartsOption | string
  /**
   * Chart width (CSS value)
   */
  width?: string | number
  /**
   * Chart height (CSS value)
   */
  height?: string | number
  /**
   * Theme: light or dark
   */
  theme?: "light" | "dark"
  /**
   * Class name for the container
   */
  className?: string
}

/**
 * ECharts Viewer Component
 * Renders ECharts charts with automatic resize handling
 */
export function EChartsViewer({
  option,
  width = "100%",
  height = 300,
  theme = "light",
  className = "",
}: EChartsViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Parse option if it's a string
  const parsedOption = (() => {
    if (typeof option === "string") {
      if (!option.trim()) return null
      try {
        return JSON.parse(option) as EChartsOption
      } catch (e) {
        return null
      }
    }
    return option
  })()

  // Initialize and update chart
  useEffect(() => {
    if (!containerRef.current) return

    // Dispose existing chart if theme changes
    if (chartRef.current) {
      chartRef.current.dispose()
    }

    // Initialize chart
    chartRef.current = echarts.init(containerRef.current, theme)

    // Handle resize
    const handleResize = () => {
      chartRef.current?.resize()
    }
    window.addEventListener("resize", handleResize)

    // ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(() => {
      chartRef.current?.resize()
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      window.removeEventListener("resize", handleResize)
      resizeObserver.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [theme])

  // Update chart option
  useEffect(() => {
    if (!chartRef.current || !parsedOption) {
      setError(parsedOption === null && typeof option === "string" && option.trim() 
        ? "Invalid chart configuration" 
        : null)
      return
    }

    try {
      chartRef.current.setOption(parsedOption, true)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to render chart")
    }
  }, [parsedOption, option])

  // Handle empty state
  if (!parsedOption && !error) {
    return (
      <div
        className={`echarts-placeholder ${className}`}
        style={{
          width: typeof width === "number" ? `${width}px` : width,
          height: typeof height === "number" ? `${height}px` : height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--surface, #f5f5f5)",
          borderRadius: "8px",
          color: "var(--muted, #999)",
          fontSize: "14px",
        }}
      >
        配置图表数据以显示图表
      </div>
    )
  }

  // Handle error state
  if (error) {
    return (
      <div
        className={`echarts-error ${className}`}
        style={{
          width: typeof width === "number" ? `${width}px` : width,
          height: typeof height === "number" ? `${height}px` : height,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255, 77, 79, 0.1)",
          border: "1px solid rgba(255, 77, 79, 0.3)",
          borderRadius: "8px",
          padding: "16px",
        }}
      >
        <div style={{ color: "#ff4d4f", fontWeight: 600, marginBottom: "8px" }}>
          图表渲染错误
        </div>
        <div
          style={{
            color: "#cf1322",
            fontSize: "12px",
            fontFamily: "monospace",
            textAlign: "center",
          }}
        >
          {error}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`echarts-viewer ${className}`}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
      }}
    />
  )
}

export default EChartsViewer
