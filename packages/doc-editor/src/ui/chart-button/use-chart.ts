import { useMemo, useCallback } from "react"
import type { Editor } from "@tiptap/react"
import type { ChartType } from "../../nodes/chart-node/chart-node-extension"

export interface UseChartConfig {
  /**
   * The Tiptap editor instance.
   */
  editor: Editor | null
  /**
   * Hide the chart button when it's not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback when a chart is inserted.
   */
  onInserted?: (chartType: ChartType) => void
}

export interface UseChartReturn {
  /**
   * Whether the chart button should be visible.
   */
  isVisible: boolean
  /**
   * Whether a chart can be inserted at the current cursor position.
   */
  canInsert: boolean
  /**
   * Insert a chart with the specified type.
   */
  handleInsert: (chartType: ChartType) => void
  /**
   * Button label for accessibility.
   */
  label: string
}

/**
 * Hook for chart insertion functionality.
 */
export function useChart({
  editor,
  hideWhenUnavailable = false,
  onInserted,
}: UseChartConfig): UseChartReturn {
  const canInsert = useMemo(() => {
    if (!editor) return false
    return editor.can().insertContent({ type: "chart" })
  }, [editor])

  const isVisible = useMemo(() => {
    if (hideWhenUnavailable && !canInsert) {
      return false
    }
    return true
  }, [hideWhenUnavailable, canInsert])

  const handleInsert = useCallback(
    (chartType: ChartType) => {
      if (!editor || !canInsert) return
      editor.commands.insertChart({ chartType, mode: "simple" })
      onInserted?.(chartType)
    },
    [editor, canInsert, onInserted]
  )

  return {
    isVisible,
    canInsert,
    handleInsert,
    label: "Insert Chart",
  }
}
