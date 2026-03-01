import React, { useCallback } from "react"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react"

import { normalizeColumnsCount } from "./columns-transform"

function ColumnsCountButton({
  count,
  active,
  onClick,
}: {
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={active ? "doc-editor-columns-toolbar-btn active" : "doc-editor-columns-toolbar-btn"}
      onClick={onClick}
    >
      {count}列
    </button>
  )
}

export function ColumnsNodeView({ editor, node, getPos }: NodeViewProps) {
  const currentCount = normalizeColumnsCount(node.attrs?.count)
  const editable = editor.isEditable

  const applyCount = useCallback(
    (nextCount: number) => {
      if (!editable) {
        return
      }
      const pos = typeof getPos === "function" ? getPos() : null
      if (typeof pos !== "number") {
        return
      }
      editor.commands.setColumnsCount({
        pos,
        count: normalizeColumnsCount(nextCount),
      })
    },
    [editable, editor.commands, getPos],
  )

  return (
    <NodeViewWrapper className="doc-editor-columns" data-count={currentCount} data-type="columns">
      {editable ? (
        <div className="doc-editor-columns-toolbar" contentEditable={false}>
          <button
            type="button"
            className="doc-editor-columns-toolbar-btn"
            onClick={() => applyCount(currentCount - 1)}
            disabled={currentCount <= 2}
          >
            -列
          </button>
          <ColumnsCountButton count={2} active={currentCount === 2} onClick={() => applyCount(2)} />
          <ColumnsCountButton count={3} active={currentCount === 3} onClick={() => applyCount(3)} />
          <ColumnsCountButton count={4} active={currentCount === 4} onClick={() => applyCount(4)} />
          <ColumnsCountButton count={5} active={currentCount === 5} onClick={() => applyCount(5)} />
          <button
            type="button"
            className="doc-editor-columns-toolbar-btn"
            onClick={() => applyCount(currentCount + 1)}
            disabled={currentCount >= 5}
          >
            +列
          </button>
        </div>
      ) : null}
      <NodeViewContent className="doc-editor-columns-track" />
    </NodeViewWrapper>
  )
}

