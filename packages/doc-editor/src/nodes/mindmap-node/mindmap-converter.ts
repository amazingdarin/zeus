import type { EChartsOption } from "echarts"

/**
 * Mind map tree node structure
 */
export interface MindmapTreeNode {
  name: string
  children?: MindmapTreeNode[]
}

export type MindmapLayout = "LR" | "TB" | "radial"

/**
 * Default mind map data
 */
export const DEFAULT_MINDMAP_DATA: MindmapTreeNode = {
  name: "中心主题",
  children: [
    {
      name: "分支 1",
      children: [{ name: "子项 1.1" }, { name: "子项 1.2" }],
    },
    {
      name: "分支 2",
      children: [{ name: "子项 2.1" }],
    },
    {
      name: "分支 3",
    },
  ],
}

/**
 * Color palette for mindmap nodes by depth
 */
const DEPTH_COLORS = [
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
 * Parse tree data from JSON string
 */
export function parseTreeData(jsonStr: string): MindmapTreeNode | null {
  if (!jsonStr) return null
  try {
    const data = JSON.parse(jsonStr) as MindmapTreeNode
    if (!data || typeof data.name !== "string") return null
    return data
  } catch {
    return null
  }
}

/**
 * Stringify tree data to JSON string
 */
export function stringifyTreeData(tree: MindmapTreeNode): string {
  return JSON.stringify(tree)
}

/**
 * Assign colors to tree nodes based on depth
 */
function assignNodeStyles(
  node: MindmapTreeNode,
  depth: number
): Record<string, unknown> {
  const color = DEPTH_COLORS[depth % DEPTH_COLORS.length]
  const result: Record<string, unknown> = {
    name: node.name,
    itemStyle: {
      color,
      borderColor: color,
    },
    label: {
      color: depth === 0 ? "#fff" : "#333",
      fontSize: Math.max(14 - depth, 10),
      fontWeight: depth === 0 ? "bold" : "normal",
    },
  }

  if (depth === 0) {
    result.itemStyle = {
      color,
      borderColor: color,
      shadowBlur: 10,
      shadowColor: "rgba(0,0,0,0.15)",
    }
    result.symbolSize = 18
  }

  if (node.children && node.children.length > 0) {
    result.children = node.children.map((child) =>
      assignNodeStyles(child, depth + 1)
    )
  }

  return result
}

/**
 * Convert tree data to ECharts tree option
 */
export function treeToEChartsOption(
  tree: MindmapTreeNode,
  layout: MindmapLayout
): EChartsOption {
  const styledTree = assignNodeStyles(tree, 0)

  if (layout === "radial") {
    return {
      tooltip: { trigger: "item", triggerOn: "mousemove" },
      series: [
        {
          type: "tree",
          data: [styledTree],
          layout: "radial",
          symbol: "circle",
          symbolSize: 12,
          initialTreeDepth: -1,
          animationDurationUpdate: 750,
          emphasis: { focus: "descendant" },
          label: {
            fontSize: 12,
            position: "inside",
          },
          leaves: {
            label: {
              // ECharts supports `outside` in practice for radial labels; typings are stricter.
              position: "outside" as any,
              fontSize: 11,
            },
          },
        },
      ],
    }
  }

  // Orthogonal layout (LR or TB)
  const orient = layout === "TB" ? "TB" : "LR"
  const isHorizontal = orient === "LR"

  return {
    tooltip: { trigger: "item", triggerOn: "mousemove" },
    series: [
      {
        type: "tree",
        data: [styledTree],
        layout: "orthogonal",
        orient,
        symbol: "roundRect",
        symbolSize: [10, 10],
        initialTreeDepth: -1,
        animationDurationUpdate: 750,
        emphasis: { focus: "descendant" },
        label: {
          position: isHorizontal ? "right" : "bottom",
          verticalAlign: "middle",
          fontSize: 12,
          distance: 8,
        },
        leaves: {
          label: {
            position: isHorizontal ? "right" : "bottom",
            verticalAlign: "middle",
            fontSize: 11,
          },
        },
        expandAndCollapse: false,
        roam: true,
      },
    ],
  }
}

/**
 * Convert tree structure to indented text.
 * Each level uses 2-space indent.
 *
 * Example output:
 *   中心主题
 *     分支 1
 *       子项 1.1
 *       子项 1.2
 *     分支 2
 */
export function treeToIndentedText(
  node: MindmapTreeNode,
  depth: number = 0
): string {
  const indent = "  ".repeat(depth)
  let result = `${indent}${node.name}`
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      result += "\n" + treeToIndentedText(child, depth + 1)
    }
  }
  return result
}

/**
 * Convert indented text to tree structure.
 * Uses 2-space indent to determine hierarchy.
 */
export function indentedTextToTree(text: string): MindmapTreeNode | null {
  const lines = text.split("\n").filter((line) => line.trim().length > 0)
  if (lines.length === 0) return null

  // Calculate indent level for each line
  const items = lines.map((line) => {
    const match = line.match(/^(\s*)(.+)$/)
    if (!match) return { level: 0, name: line.trim() }
    const spaces = match[1].length
    const level = Math.floor(spaces / 2)
    return { level, name: match[2].trim() }
  })

  // Normalize: ensure root starts at level 0
  const minLevel = Math.min(...items.map((item) => item.level))
  for (const item of items) {
    item.level -= minLevel
  }

  // Build tree recursively
  function buildTree(
    startIdx: number,
    parentLevel: number
  ): { nodes: MindmapTreeNode[]; nextIdx: number } {
    const nodes: MindmapTreeNode[] = []
    let i = startIdx

    while (i < items.length) {
      const item = items[i]
      if (item.level <= parentLevel && i !== startIdx) {
        break
      }
      if (item.level === parentLevel + 1 || (i === startIdx && item.level === parentLevel)) {
        const node: MindmapTreeNode = { name: item.name }
        i++
        // Check for children
        if (i < items.length && items[i].level > item.level) {
          const childResult = buildTree(i, item.level)
          node.children = childResult.nodes
          i = childResult.nextIdx
        }
        nodes.push(node)
      } else {
        // Skip unexpected indent levels
        i++
      }
    }

    return { nodes, nextIdx: i }
  }

  // Root is the first item
  const rootName = items[0].name
  const rootLevel = items[0].level
  const root: MindmapTreeNode = { name: rootName }

  if (items.length > 1) {
    const childResult = buildTree(1, rootLevel)
    if (childResult.nodes.length > 0) {
      root.children = childResult.nodes
    }
  }

  return root
}

/**
 * Validate tree data structure
 */
export function validateTreeData(
  data: unknown
): { valid: boolean; error?: string } {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "数据必须是一个对象" }
  }

  const node = data as Record<string, unknown>
  if (typeof node.name !== "string" || !node.name.trim()) {
    return { valid: false, error: "节点必须有非空的 name 属性" }
  }

  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) {
      return { valid: false, error: "children 必须是数组" }
    }
    for (const child of node.children) {
      const result = validateTreeData(child)
      if (!result.valid) return result
    }
  }

  return { valid: true }
}
