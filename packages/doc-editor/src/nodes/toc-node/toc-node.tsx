import { useCallback, useEffect, useMemo, useState } from "react"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper } from "@tiptap/react"
import type { Node as ProsemirrorNode } from "@tiptap/pm/model"
import type { TocNodeAttrs } from "./toc-node-extension"
import "./toc-node.scss"

export type TocHeadingItem = {
  id: string
  level: number
  text: string
  pos: number
}

/**
 * Extract all heading nodes from a ProseMirror document
 */
function extractHeadings(
  doc: ProsemirrorNode,
  minLevel: number,
  maxLevel: number
): TocHeadingItem[] {
  const headings: TocHeadingItem[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = (node.attrs.level as number) || 1
      if (level >= minLevel && level <= maxLevel) {
        headings.push({
          id: (node.attrs.id as string) || "",
          level,
          text: node.textContent || "",
          pos,
        })
      }
    }
  })
  return headings
}

/**
 * Build hierarchical numbering for headings (e.g., 1, 1.1, 1.2, 2, 2.1)
 */
function buildNumbering(headings: TocHeadingItem[]): string[] {
  const counters: number[] = [0, 0, 0, 0, 0, 0] // h1-h6
  const numbers: string[] = []

  for (const heading of headings) {
    const level = heading.level
    // Increment counter for current level
    counters[level - 1]++
    // Reset counters for deeper levels
    for (let i = level; i < counters.length; i++) {
      counters[i] = 0
    }
    // Build number string
    const parts: number[] = []
    for (let i = 0; i < level; i++) {
      if (counters[i] > 0) {
        parts.push(counters[i])
      }
    }
    numbers.push(parts.join("."))
  }

  return numbers
}

export function TocNodeView({ node, editor }: NodeViewProps) {
  const attrs = node.attrs as TocNodeAttrs
  const minLevel = attrs.minLevel ?? 1
  const maxLevel = attrs.maxLevel ?? 4
  const title = attrs.title ?? "目录"

  const [headings, setHeadings] = useState<TocHeadingItem[]>([])
  const [updateKey, setUpdateKey] = useState(0)
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Extract headings from document
  const extractAndSetHeadings = useCallback(() => {
    if (!editor || !editor.state) {
      return
    }
    const extracted = extractHeadings(editor.state.doc, minLevel, maxLevel)
    setHeadings(extracted)
  }, [editor, minLevel, maxLevel])

  // Initial extraction
  useEffect(() => {
    extractAndSetHeadings()
  }, [extractAndSetHeadings])

  // Subscribe to editor updates with debounce
  useEffect(() => {
    if (!editor) {
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const handleUpdate = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      timeoutId = setTimeout(() => {
        extractAndSetHeadings()
        setUpdateKey((prev) => prev + 1)
      }, 150) // 150ms debounce
    }

    editor.on("update", handleUpdate)

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      editor.off("update", handleUpdate)
    }
  }, [editor, extractAndSetHeadings])

  // Build numbering
  const numbering = useMemo(() => buildNumbering(headings), [headings])

  // Handle click on a heading item
  const handleHeadingClick = useCallback(
    (pos: number) => {
      if (!editor) {
        return
      }
      // Set selection to the heading position
      editor.chain().focus().setTextSelection(pos + 1).run()

      // Scroll the heading into view
      const domAtPos = editor.view.domAtPos(pos + 1)
      if (domAtPos?.node) {
        const element =
          domAtPos.node instanceof Element
            ? domAtPos.node
            : domAtPos.node.parentElement
        element?.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    },
    [editor]
  )

  // Calculate indent level (relative to minLevel)
  const getIndentLevel = (level: number) => level - minLevel

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev)
  }, [])

  return (
    <NodeViewWrapper className={`toc-node ${isCollapsed ? "toc-node-collapsed" : ""}`} key={updateKey}>
      <div className="toc-node-container">
        <div className="toc-node-header">
          <button
            type="button"
            className="toc-node-toggle"
            onClick={toggleCollapse}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? "展开目录" : "收起目录"}
          >
            <span className={`toc-node-toggle-icon ${isCollapsed ? "collapsed" : ""}`}>
              ▼
            </span>
          </button>
          <span className="toc-node-icon">📑</span>
          <span className="toc-node-title">{title}</span>
          {isCollapsed && headings.length > 0 && (
            <span className="toc-node-count">({headings.length} 项)</span>
          )}
        </div>
        {!isCollapsed && (
          <div className="toc-node-content">
            {headings.length === 0 ? (
              <div className="toc-node-empty">暂无标题</div>
            ) : (
              <ul className="toc-node-list">
                {headings.map((heading, index) => (
                  <li
                    key={heading.id || `${heading.pos}-${index}`}
                    className={`toc-node-item toc-node-item-level-${heading.level}`}
                    style={{
                      paddingLeft: `${getIndentLevel(heading.level) * 16}px`,
                    }}
                  >
                    <button
                      type="button"
                      className="toc-node-link"
                      onClick={() => handleHeadingClick(heading.pos)}
                    >
                      <span className="toc-node-number">{numbering[index]}</span>
                      <span className="toc-node-text">{heading.text || "(空标题)"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export default TocNodeView
