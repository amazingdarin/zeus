import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { InputRule } from "@tiptap/core"
import { ChartNodeView } from "./chart-node"

export type ChartType = "bar" | "line" | "pie" | "scatter" | "radar" | "funnel"
export type ChartMode = "simple" | "advanced"

export interface ChartNodeOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    chart: {
      /**
       * Insert a chart
       */
      insertChart: (options?: {
        chartType?: ChartType
        mode?: ChartMode
      }) => ReturnType
    }
  }
}

/**
 * Default simple data for each chart type
 */
export const DEFAULT_SIMPLE_DATA: Record<ChartType, string> = {
  bar: JSON.stringify({
    labels: ["类别A", "类别B", "类别C"],
    datasets: [{ name: "系列1", values: [120, 200, 150] }],
  }),
  line: JSON.stringify({
    labels: ["一月", "二月", "三月", "四月", "五月"],
    datasets: [{ name: "数据", values: [150, 230, 224, 218, 135] }],
  }),
  pie: JSON.stringify({
    labels: ["直接访问", "邮件营销", "联盟广告", "搜索引擎"],
    datasets: [{ name: "访问来源", values: [335, 310, 234, 535] }],
  }),
  scatter: JSON.stringify({
    datasets: [
      {
        name: "数据点",
        values: [
          [10, 8.04],
          [8, 6.95],
          [13, 7.58],
          [9, 8.81],
          [11, 8.33],
        ],
      },
    ],
  }),
  radar: JSON.stringify({
    labels: ["销售", "管理", "技术", "客服", "研发", "市场"],
    datasets: [{ name: "预算", values: [4200, 3000, 20000, 35000, 50000, 18000] }],
  }),
  funnel: JSON.stringify({
    labels: ["展现", "点击", "访问", "咨询", "订单"],
    datasets: [{ name: "转化", values: [60, 40, 20, 80, 100] }],
  }),
}

/**
 * Chart Node Extension for Tiptap
 * Supports multiple chart types with simple and advanced editing modes
 * Rendered using ECharts
 */
export const ChartNode = Node.create<ChartNodeOptions>({
  name: "chart",

  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      // ECharts option JSON string
      options: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-options") || "",
        renderHTML: (attributes) => ({
          "data-options": attributes.options,
        }),
      },
      // Chart type for simple mode
      chartType: {
        default: "bar" as ChartType,
        parseHTML: (element) =>
          (element.getAttribute("data-chart-type") as ChartType) || "bar",
        renderHTML: (attributes) => ({
          "data-chart-type": attributes.chartType,
        }),
      },
      // Simple mode data
      simpleData: {
        default: DEFAULT_SIMPLE_DATA.bar,
        parseHTML: (element) =>
          element.getAttribute("data-simple-data") || DEFAULT_SIMPLE_DATA.bar,
        renderHTML: (attributes) => ({
          "data-simple-data": attributes.simpleData,
        }),
      },
      // Editing mode
      mode: {
        default: "simple" as ChartMode,
        parseHTML: (element) =>
          (element.getAttribute("data-mode") as ChartMode) || "simple",
        renderHTML: (attributes) => ({
          "data-mode": attributes.mode,
        }),
      },
      // Display width percentage
      width: {
        default: 100,
        parseHTML: (element) =>
          parseInt(element.getAttribute("data-width") || "100", 10),
        renderHTML: (attributes) => ({
          "data-width": String(attributes.width),
        }),
      },
      // Display height in pixels
      height: {
        default: 300,
        parseHTML: (element) =>
          parseInt(element.getAttribute("data-height") || "300", 10),
        renderHTML: (attributes) => ({
          "data-height": String(attributes.height),
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="chart"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "chart",
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChartNodeView)
  },

  addCommands() {
    return {
      insertChart:
        (options = {}) =>
        ({ commands }) => {
          const chartType = options.chartType || "bar"
          const mode = options.mode || "simple"
          return commands.insertContent({
            type: this.name,
            attrs: {
              chartType,
              mode,
              simpleData: DEFAULT_SIMPLE_DATA[chartType],
              options: "",
              width: 100,
              height: 300,
            },
          })
        },
    }
  },

  addInputRules() {
    // Input rule: ```chart triggers chart insertion
    const chartInputRule = new InputRule({
      find: /^```chart\s$/,
      handler: ({ state, range }) => {
        const { tr } = state
        const node = this.type.create({
          chartType: "bar",
          mode: "simple",
          simpleData: DEFAULT_SIMPLE_DATA.bar,
        })
        tr.replaceWith(range.from, range.to, node)
      },
    })

    return [chartInputRule]
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-c": () => {
        return this.editor.commands.insertChart({ chartType: "bar", mode: "simple" })
      },
    }
  },
})

export default ChartNode
