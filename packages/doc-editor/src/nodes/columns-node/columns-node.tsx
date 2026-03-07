import React, { useCallback, useEffect, useRef, useState } from "react"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react"

import {
  normalizeColumnsCount,
  normalizeColumnsWidths,
  resizeAdjacentColumnsWidths,
  resolveColumnResizeHandleLayouts,
} from "./columns-transform"

type ResizeSession = {
  handlePointerMove: (event: PointerEvent) => void
  handlePointerUp: () => void
}

function areEqualWidths(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

export function ColumnsNodeView({ editor, node, getPos }: NodeViewProps) {
  const currentCount = normalizeColumnsCount(node.attrs?.count)
  const widths = normalizeColumnsWidths(node.attrs?.widths, currentCount)
  const editable = editor.isEditable
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const resizeSessionRef = useRef<ResizeSession | null>(null)
  const liveResizingWidthsRef = useRef<number[] | null>(null)
  const [resizingHandleIndex, setResizingHandleIndex] = useState<number | null>(null)
  const [resizingWidths, setResizingWidths] = useState<number[] | null>(null)

  const activeWidths = resizingWidths ?? widths
  const gridTemplate = activeWidths.map((value) => `minmax(0, ${value}fr)`).join(" ")
  const handleLayouts = resolveColumnResizeHandleLayouts(activeWidths, currentCount, 12)

  const stopResizeSession = useCallback(() => {
    const session = resizeSessionRef.current
    if (session) {
      window.removeEventListener("pointermove", session.handlePointerMove)
      window.removeEventListener("pointerup", session.handlePointerUp)
      window.removeEventListener("pointercancel", session.handlePointerUp)
    }
    resizeSessionRef.current = null
    liveResizingWidthsRef.current = null
    setResizingWidths(null)
    setResizingHandleIndex(null)
  }, [])

  useEffect(() => {
    liveResizingWidthsRef.current = resizingWidths
  }, [resizingWidths])

  useEffect(() => {
    return () => {
      stopResizeSession()
    }
  }, [stopResizeSession])

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, handleIndex: number) => {
      if (!editable) {
        return
      }
      event.preventDefault()
      event.stopPropagation()

      const track = wrapperRef.current?.querySelector(".doc-editor-columns-track") as HTMLElement | null
      if (!track) {
        return
      }
      const rect = track.getBoundingClientRect()
      if (!(rect.width > 0)) {
        return
      }

      stopResizeSession()

      const startClientX = event.clientX
      const startWidths = normalizeColumnsWidths(widths, currentCount)
      liveResizingWidthsRef.current = startWidths
      setResizingWidths(startWidths)
      setResizingHandleIndex(handleIndex)

      const commitResizedWidths = () => {
        const finalWidths = normalizeColumnsWidths(
          liveResizingWidthsRef.current ?? startWidths,
          currentCount
        )
        if (areEqualWidths(finalWidths, widths)) {
          stopResizeSession()
          return
        }
        const pos = typeof getPos === "function" ? getPos() : null
        if (typeof pos !== "number") {
          stopResizeSession()
          return
        }
        editor.commands.setColumnsCount({
          pos,
          count: currentCount,
          widths: finalWidths,
        })
        stopResizeSession()
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault()
        const nextWidths = resizeAdjacentColumnsWidths({
          widths: startWidths,
          count: currentCount,
          handleIndex,
          containerWidthPx: rect.width,
          deltaPx: moveEvent.clientX - startClientX,
        })
        if (areEqualWidths(nextWidths, liveResizingWidthsRef.current ?? [])) {
          return
        }
        liveResizingWidthsRef.current = nextWidths
        setResizingWidths(nextWidths)
      }

      const handlePointerUp = () => {
        commitResizedWidths()
      }

      const session: ResizeSession = {
        handlePointerMove,
        handlePointerUp,
      }
      resizeSessionRef.current = session
      window.addEventListener("pointermove", session.handlePointerMove)
      window.addEventListener("pointerup", session.handlePointerUp)
      window.addEventListener("pointercancel", session.handlePointerUp)
    },
    [currentCount, editable, editor.commands, getPos, stopResizeSession, widths],
  )

  const wrapperClassName = [
    "doc-editor-columns",
    resizingHandleIndex != null ? "is-resizing" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      className={wrapperClassName}
      data-count={currentCount}
      data-type="columns"
      style={
        {
          "--doc-editor-columns-grid-template": gridTemplate,
        } as React.CSSProperties
      }
    >
      {editable && handleLayouts.length > 0 ? (
        <div className="doc-editor-columns-resize-handles" contentEditable={false}>
          {handleLayouts.map((layout, index) => (
            <button
              key={`doc-editor-columns-resize-${index}`}
              type="button"
              className={
                resizingHandleIndex === index
                  ? "doc-editor-columns-resize-handle is-active"
                  : "doc-editor-columns-resize-handle"
              }
              style={{ left: `calc(${layout.percent}% + ${layout.offsetPx}px)` }}
              onPointerDown={(event) => {
                handleResizePointerDown(event, index)
              }}
              onClick={(event) => {
                event.stopPropagation()
              }}
              aria-label={`调整第${index + 1}列和第${index + 2}列宽度`}
            />
          ))}
        </div>
      ) : null}
      <NodeViewContent className="doc-editor-columns-track" />
    </NodeViewWrapper>
  )
}
