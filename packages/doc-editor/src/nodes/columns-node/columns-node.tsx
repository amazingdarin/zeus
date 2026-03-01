import React, { useCallback, useEffect, useRef, useState } from "react"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react"

import {
  createDefaultColumnWidths,
  normalizeColumnsCount,
  normalizeColumnsWidths,
} from "./columns-transform"

export function ColumnsNodeView({ editor, node, getPos }: NodeViewProps) {
  const currentCount = normalizeColumnsCount(node.attrs?.count)
  const widths = normalizeColumnsWidths(node.attrs?.widths, currentCount)
  const gridTemplate = widths.map((value) => `minmax(220px, ${value}fr)`).join(" ")
  const minWidth = `calc(220px * ${currentCount} + 12px * ${Math.max(0, currentCount - 1)})`
  const editable = editor.isEditable
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [draftCount, setDraftCount] = useState(currentCount)
  const [draftWidths, setDraftWidths] = useState<number[]>(() =>
    normalizeColumnsWidths(widths, currentCount),
  )

  useEffect(() => {
    if (!configOpen) {
      setDraftCount(currentCount)
      setDraftWidths(normalizeColumnsWidths(widths, currentCount))
    }
  }, [configOpen, currentCount, widths])

  useEffect(() => {
    if (!configOpen) {
      return
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && wrapperRef.current?.contains(target)) {
        return
      }
      setConfigOpen(false)
    }
    document.addEventListener("mousedown", handlePointerDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
    }
  }, [configOpen])

  const applyConfig = useCallback(() => {
    if (!editable) {
      return
    }
    const pos = typeof getPos === "function" ? getPos() : null
    if (typeof pos !== "number") {
      return
    }
    const count = normalizeColumnsCount(draftCount)
    const nextWidths = normalizeColumnsWidths(draftWidths, count)
    editor.commands.setColumnsCount({
      pos,
      count,
      widths: nextWidths,
    })
    setConfigOpen(false)
  }, [draftCount, draftWidths, editable, editor.commands, getPos])

  const openConfig = useCallback(() => {
    if (!editable) {
      return
    }
    setDraftCount(currentCount)
    setDraftWidths(normalizeColumnsWidths(widths, currentCount))
    setConfigOpen(true)
  }, [currentCount, editable, widths])

  const handleWrapperClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!editable) {
        return
      }
      const target = event.target as HTMLElement | null
      if (!target) {
        return
      }
      if (
        target.closest(".doc-editor-columns-config-panel")
        || target.closest('[data-type="column"]')
      ) {
        return
      }
      openConfig()
    },
    [editable, openConfig],
  )

  const handleDraftCountChange = useCallback((nextRaw: string) => {
    const nextCount = normalizeColumnsCount(nextRaw)
    setDraftCount(nextCount)
    setDraftWidths((prev) => normalizeColumnsWidths(prev, nextCount))
  }, [])

  const handleDraftWidthChange = useCallback(
    (index: number, nextRaw: string) => {
      const parsed = Number(nextRaw)
      setDraftWidths((prev) => {
        const next = normalizeColumnsWidths(prev, draftCount)
        next[index] = Number.isFinite(parsed) && parsed > 0
          ? Number(parsed.toFixed(4))
          : 1
        return normalizeColumnsWidths(next, draftCount)
      })
    },
    [draftCount],
  )

  const handleResetWidths = useCallback(() => {
    setDraftWidths(createDefaultColumnWidths(draftCount))
  }, [draftCount])

  const handlePanelPointerDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }, [])

  const handlePanelKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        setConfigOpen(false)
        return
      }
      if (event.key === "Enter") {
        event.preventDefault()
        event.stopPropagation()
        applyConfig()
      }
    },
    [applyConfig],
  )

  const handleCancelConfig = useCallback(() => {
    setConfigOpen(false)
  }, [])

  const draftCountOptions = Array.from({ length: draftCount }, (_, index) => index + 1)

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      className={configOpen ? "doc-editor-columns is-editing" : "doc-editor-columns"}
      data-count={currentCount}
      data-type="columns"
      onClick={handleWrapperClick}
      style={
        {
          "--doc-editor-columns-grid-template": gridTemplate,
          "--doc-editor-columns-min-width": minWidth,
        } as React.CSSProperties
      }
    >
      {editable && configOpen ? (
        <div
          className="doc-editor-columns-config-panel"
          contentEditable={false}
          onMouseDown={handlePanelPointerDown}
          onClick={handlePanelPointerDown}
          onKeyDown={handlePanelKeyDown}
          role="dialog"
          aria-label="编辑多列块"
        >
          <div className="doc-editor-columns-config-panel-row">
            <label className="doc-editor-columns-config-panel-label" htmlFor="doc-editor-columns-count">
              列数
            </label>
            <input
              id="doc-editor-columns-count"
              className="doc-editor-columns-config-panel-input"
              type="number"
              min={2}
              max={8}
              step={1}
              value={draftCount}
              onChange={(event) => {
                handleDraftCountChange(event.target.value)
              }}
            />
          </div>
          <div className="doc-editor-columns-config-panel-widths">
            {draftCountOptions.map((index) => (
              <label
                key={`doc-editor-columns-width-${index}`}
                className="doc-editor-columns-config-panel-width-item"
              >
                <span>第{index}列</span>
                <input
                  className="doc-editor-columns-config-panel-input"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={String(draftWidths[index - 1] ?? 1)}
                  onChange={(event) => {
                    handleDraftWidthChange(index - 1, event.target.value)
                  }}
                />
              </label>
            ))}
          </div>
          <div className="doc-editor-columns-config-panel-actions">
            <button
              type="button"
              className="doc-editor-columns-config-panel-btn secondary"
              onClick={handleResetWidths}
            >
              默认列宽
            </button>
            <button
              type="button"
              className="doc-editor-columns-config-panel-btn secondary"
              onClick={handleCancelConfig}
            >
              取消
            </button>
            <button
              type="button"
              className="doc-editor-columns-config-panel-btn"
              onClick={applyConfig}
            >
              应用
            </button>
          </div>
        </div>
      ) : null}
      <NodeViewContent className="doc-editor-columns-track" />
    </NodeViewWrapper>
  )
}
