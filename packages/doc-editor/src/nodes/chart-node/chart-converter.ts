import type { EChartsOption } from "echarts"
import type { ChartType } from "./chart-node-extension"

/**
 * Simple data structure for chart configuration
 */
export interface SimpleChartData {
  labels?: string[]
  datasets: DatasetItem[]
  title?: string
  showLegend?: boolean
}

export interface DatasetItem {
  name: string
  values: number[] | [number, number][]
  color?: string
}

/**
 * Parse simple data from JSON string
 */
export function parseSimpleData(jsonStr: string): SimpleChartData | null {
  if (!jsonStr) return null
  try {
    return JSON.parse(jsonStr) as SimpleChartData
  } catch {
    return null
  }
}

/**
 * Stringify simple data to JSON string
 */
export function stringifySimpleData(data: SimpleChartData): string {
  return JSON.stringify(data)
}

/**
 * Default color palette for charts
 */
const DEFAULT_COLORS = [
  "#5470c6",
  "#91cc75",
  "#fac858",
  "#ee6666",
  "#73c0de",
  "#3ba272",
  "#fc8452",
  "#9a60b4",
  "#ea7ccc",
]

/**
 * Convert simple data to ECharts option based on chart type
 */
export function simpleToEChartsOption(
  chartType: ChartType,
  simpleData: SimpleChartData
): EChartsOption {
  const { labels = [], datasets, title, showLegend = true } = simpleData

  const baseOption: EChartsOption = {
    tooltip: {},
    legend: showLegend
      ? {
          data: datasets.map((d) => d.name),
          bottom: 0,
        }
      : undefined,
    title: title
      ? {
          text: title,
          left: "center",
        }
      : undefined,
  }

  switch (chartType) {
    case "bar":
      return {
        ...baseOption,
        tooltip: { trigger: "axis" },
        xAxis: {
          type: "category",
          data: labels,
        },
        yAxis: {
          type: "value",
        },
        series: datasets.map((dataset, index) => ({
          name: dataset.name,
          type: "bar",
          data: dataset.values as number[],
          itemStyle: dataset.color ? { color: dataset.color } : undefined,
        })),
      }

    case "line":
      return {
        ...baseOption,
        tooltip: { trigger: "axis" },
        xAxis: {
          type: "category",
          data: labels,
          boundaryGap: false,
        },
        yAxis: {
          type: "value",
        },
        series: datasets.map((dataset) => ({
          name: dataset.name,
          type: "line",
          data: dataset.values as number[],
          smooth: true,
          itemStyle: dataset.color ? { color: dataset.color } : undefined,
        })),
      }

    case "pie":
      return {
        ...baseOption,
        tooltip: { trigger: "item" },
        series: [
          {
            name: datasets[0]?.name || "数据",
            type: "pie",
            radius: ["40%", "70%"],
            avoidLabelOverlap: true,
            itemStyle: {
              borderRadius: 10,
              borderColor: "#fff",
              borderWidth: 2,
            },
            label: {
              show: true,
              formatter: "{b}: {c} ({d}%)",
            },
            data: labels.map((label, index) => ({
              name: label,
              value: (datasets[0]?.values as number[])?.[index] || 0,
            })),
          },
        ],
      }

    case "scatter":
      return {
        ...baseOption,
        tooltip: {
          trigger: "item",
          formatter: (params: unknown) => {
            const p = params as { seriesName: string; value: [number, number] }
            return `${p.seriesName}<br/>X: ${p.value[0]}, Y: ${p.value[1]}`
          },
        },
        xAxis: { type: "value" },
        yAxis: { type: "value" },
        series: datasets.map((dataset) => ({
          name: dataset.name,
          type: "scatter",
          data: dataset.values as [number, number][],
          symbolSize: 12,
          itemStyle: dataset.color ? { color: dataset.color } : undefined,
        })),
      }

    case "radar":
      const maxValues = labels.map((_, index) =>
        Math.max(...datasets.map((d) => (d.values as number[])[index] || 0)) * 1.2
      )
      return {
        ...baseOption,
        tooltip: {},
        radar: {
          indicator: labels.map((label, index) => ({
            name: label,
            max: maxValues[index] || 100,
          })),
        },
        series: [
          {
            type: "radar",
            data: datasets.map((dataset) => ({
              name: dataset.name,
              value: dataset.values as number[],
              areaStyle: { opacity: 0.3 },
            })),
          },
        ],
      }

    case "funnel":
      const sortedData = labels
        .map((label, index) => ({
          name: label,
          value: (datasets[0]?.values as number[])?.[index] || 0,
        }))
        .sort((a, b) => b.value - a.value)
      return {
        ...baseOption,
        tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
        series: [
          {
            name: datasets[0]?.name || "漏斗",
            type: "funnel",
            left: "10%",
            width: "80%",
            top: 40,
            bottom: 40,
            min: 0,
            max: Math.max(...sortedData.map((d) => d.value)),
            minSize: "20%",
            maxSize: "100%",
            sort: "descending",
            gap: 2,
            label: {
              show: true,
              position: "inside",
            },
            itemStyle: {
              borderColor: "#fff",
              borderWidth: 1,
            },
            data: sortedData,
          },
        ],
      }

    default:
      return baseOption
  }
}

/**
 * Try to convert ECharts option back to simple data format
 * This is a best-effort conversion and may not work for all configurations
 */
export function echartsToSimple(
  option: EChartsOption
): { chartType: ChartType; simpleData: SimpleChartData } | null {
  try {
    const series = option.series as unknown[]
    if (!series || !Array.isArray(series) || series.length === 0) {
      return null
    }

    const firstSeries = series[0] as { type?: string; data?: unknown[] }
    const chartType = firstSeries.type as ChartType

    if (!["bar", "line", "pie", "scatter", "radar", "funnel"].includes(chartType)) {
      return null
    }

    // Extract labels from xAxis for bar/line charts
    const xAxis = option.xAxis as { data?: string[] } | undefined
    const labels = xAxis?.data || []

    // Extract datasets from series
    const datasets: DatasetItem[] = series.map((s) => {
      const seriesItem = s as { name?: string; data?: unknown[] }
      return {
        name: seriesItem.name || "",
        values: (seriesItem.data || []) as number[],
      }
    })

    // Handle pie chart special case
    if (chartType === "pie" && firstSeries.data) {
      const pieData = firstSeries.data as { name: string; value: number }[]
      return {
        chartType: "pie",
        simpleData: {
          labels: pieData.map((d) => d.name),
          datasets: [
            {
              name: (firstSeries as { name?: string }).name || "数据",
              values: pieData.map((d) => d.value),
            },
          ],
        },
      }
    }

    return {
      chartType,
      simpleData: {
        labels,
        datasets,
      },
    }
  } catch {
    return null
  }
}

/**
 * Validate ECharts option JSON
 */
export function validateEChartsOption(json: string): { valid: boolean; error?: string } {
  if (!json.trim()) {
    return { valid: false, error: "配置不能为空" }
  }

  try {
    const option = JSON.parse(json)
    if (typeof option !== "object" || option === null) {
      return { valid: false, error: "配置必须是一个对象" }
    }
    return { valid: true }
  } catch (e) {
    return { valid: false, error: `JSON 格式错误: ${(e as Error).message}` }
  }
}

/**
 * Format JSON string with proper indentation
 */
export function formatJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}
