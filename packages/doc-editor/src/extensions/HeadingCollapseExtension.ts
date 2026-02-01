import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { Node as ProsemirrorNode } from "@tiptap/pm/model"
import type { EditorView } from "@tiptap/pm/view"

// ============================================================================
// Types
// ============================================================================

type HeadingInfo = {
  id: string
  level: number
  pos: number
  endPos: number
  textContent: string
}

type CollapseRange = {
  headingId: string
  headingPos: number
  headingLevel: number
  startPos: number
  endPos: number
}

type CollapsePluginState = {
  collapsedIds: Set<string>
  decorations: DecorationSet
}

// ============================================================================
// Plugin Key
// ============================================================================

export const headingCollapsePluginKey = new PluginKey<CollapsePluginState>(
  "headingCollapse"
)

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract all headings from the document
 */
function extractHeadings(doc: ProsemirrorNode): HeadingInfo[] {
  const headings: HeadingInfo[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = (node.attrs.level as number) || 1
      const id = (node.attrs.id as string) || ""
      if (id && level >= 1 && level <= 4) {
        headings.push({
          id,
          level,
          pos,
          endPos: pos + node.nodeSize,
          textContent: node.textContent,
        })
      }
    }
  })
  return headings
}

/**
 * Calculate which content ranges should be collapsed
 */
function calculateCollapseRanges(
  doc: ProsemirrorNode,
  collapsedIds: Set<string>
): CollapseRange[] {
  if (collapsedIds.size === 0) {
    return []
  }

  const headings = extractHeadings(doc)
  const ranges: CollapseRange[] = []

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]
    if (!collapsedIds.has(heading.id)) {
      continue
    }

    // Find the end position: next heading of same or higher level, or end of doc
    let endPos = doc.content.size
    for (let j = i + 1; j < headings.length; j++) {
      const nextHeading = headings[j]
      // Same level or higher (lower number) ends this section
      if (nextHeading.level <= heading.level) {
        endPos = nextHeading.pos
        break
      }
    }

    // Only add range if there's content to hide
    if (heading.endPos < endPos) {
      ranges.push({
        headingId: heading.id,
        headingPos: heading.pos,
        headingLevel: heading.level,
        startPos: heading.endPos,
        endPos,
      })
    }
  }

  return ranges
}

/**
 * Check if a position is within any collapsed range
 */
function isPositionInCollapsedRange(
  pos: number,
  collapseRanges: CollapseRange[]
): boolean {
  for (const range of collapseRanges) {
    if (pos >= range.startPos && pos < range.endPos) {
      return true
    }
  }
  return false
}

/**
 * Create decorations for collapsed content and toggle buttons
 */
function createDecorations(
  doc: ProsemirrorNode,
  collapsedIds: Set<string>,
  _view: EditorView | null
): DecorationSet {
  const decorations: Decoration[] = []
  const headings = extractHeadings(doc)
  const collapseRanges = calculateCollapseRanges(doc, collapsedIds)

  // Add toggle button decorations to each heading (unless it's inside a collapsed range)
  for (const heading of headings) {
    // Skip creating button for headings inside collapsed ranges
    if (isPositionInCollapsedRange(heading.pos, collapseRanges)) {
      continue
    }

    const isCollapsed = collapsedIds.has(heading.id)

    // Widget decoration for the toggle button - insert INSIDE the heading at position + 1
    const toggleWidget = Decoration.widget(
      heading.pos + 1, // Insert at the start of heading content
      (view) => {
        const button = document.createElement("button")
        button.className = `heading-collapse-btn level-${heading.level} ${isCollapsed ? "collapsed" : ""}`
        button.setAttribute("type", "button")
        button.setAttribute("aria-label", isCollapsed ? "展开" : "折叠")
        button.setAttribute("data-heading-id", heading.id)
        button.setAttribute("data-heading-level", String(heading.level))
        button.setAttribute("contenteditable", "false")
        // Use SVG for consistent icon size
        const svgIcon = isCollapsed
          ? `<svg class="heading-collapse-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l6 4-6 4V4z"/></svg>`
          : `<svg class="heading-collapse-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M4 6l4 6 4-6H4z"/></svg>`
        button.innerHTML = svgIcon

        button.addEventListener("mousedown", (e) => {
          e.preventDefault()
          e.stopPropagation()

          // Dispatch a transaction to toggle the collapse state
          const tr = view.state.tr.setMeta(headingCollapsePluginKey, {
            type: "toggle",
            headingId: heading.id,
          })
          view.dispatch(tr)
        })

        return button
      },
      { side: -1, key: `collapse-btn-${heading.id}-${isCollapsed ? "c" : "e"}` }
    )
    decorations.push(toggleWidget)

    // Add collapsed class to heading if collapsed
    if (isCollapsed) {
      decorations.push(
        Decoration.node(heading.pos, heading.endPos, {
          class: "heading-collapsed",
        })
      )
    }
  }

  // Add hide decorations for collapsed content
  for (const range of collapseRanges) {
    // Hide all top-level nodes in the collapsed range
    doc.nodesBetween(range.startPos, range.endPos, (node, nodePos) => {
      if (nodePos >= range.startPos && nodePos < range.endPos) {
        const nodeEnd = nodePos + node.nodeSize
        if (nodeEnd <= range.endPos) {
          decorations.push(
            Decoration.node(nodePos, nodeEnd, {
              class: "prosemirror-collapsed",
            })
          )
        }
        return false // Don't descend into children
      }
      return true
    })
  }

  return DecorationSet.create(doc, decorations)
}

// ============================================================================
// Extension
// ============================================================================

export interface HeadingCollapseOptions {
  /**
   * Initial collapsed heading IDs
   */
  initialCollapsedIds?: string[]
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    headingCollapse: {
      /**
       * Toggle collapse state for a heading
       */
      toggleHeadingCollapse: (headingId: string) => ReturnType
      /**
       * Collapse all headings
       */
      collapseAllHeadings: () => ReturnType
      /**
       * Expand all headings
       */
      expandAllHeadings: () => ReturnType
      /**
       * Check if a heading is collapsed
       */
      isHeadingCollapsed: (headingId: string) => ReturnType
    }
  }
}

export const HeadingCollapseExtension = Extension.create<HeadingCollapseOptions>({
  name: "headingCollapse",

  addOptions() {
    return {
      initialCollapsedIds: [],
    }
  },

  addCommands() {
    return {
      toggleHeadingCollapse:
        (headingId: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(headingCollapsePluginKey, {
              type: "toggle",
              headingId,
            })
          }
          return true
        },

      collapseAllHeadings:
        () =>
        ({ tr, dispatch, state }) => {
          if (dispatch) {
            const headings = extractHeadings(state.doc)
            const allIds = headings.map((h) => h.id)
            tr.setMeta(headingCollapsePluginKey, {
              type: "collapseAll",
              headingIds: allIds,
            })
          }
          return true
        },

      expandAllHeadings:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(headingCollapsePluginKey, {
              type: "expandAll",
            })
          }
          return true
        },

      isHeadingCollapsed:
        (headingId: string) =>
        ({ state }) => {
          const pluginState = headingCollapsePluginKey.getState(state)
          return pluginState?.collapsedIds.has(headingId) ?? false
        },
    }
  },

  addProseMirrorPlugins() {
    const initialCollapsedIds = new Set(this.options.initialCollapsedIds ?? [])

    return [
      new Plugin<CollapsePluginState>({
        key: headingCollapsePluginKey,

        state: {
          init(_, state): CollapsePluginState {
            return {
              collapsedIds: initialCollapsedIds,
              decorations: createDecorations(state.doc, initialCollapsedIds, null),
            }
          },

          apply(tr, pluginState, _oldState, newState): CollapsePluginState {
            const meta = tr.getMeta(headingCollapsePluginKey)
            let { collapsedIds } = pluginState
            let needsUpdate = false

            if (meta) {
              if (meta.type === "toggle") {
                collapsedIds = new Set(collapsedIds)
                if (collapsedIds.has(meta.headingId)) {
                  collapsedIds.delete(meta.headingId)
                } else {
                  collapsedIds.add(meta.headingId)
                }
                needsUpdate = true
              } else if (meta.type === "collapseAll") {
                collapsedIds = new Set(meta.headingIds)
                needsUpdate = true
              } else if (meta.type === "expandAll") {
                collapsedIds = new Set()
                needsUpdate = true
              }
            }

            // Also update if document changed
            if (tr.docChanged || needsUpdate) {
              return {
                collapsedIds,
                decorations: createDecorations(newState.doc, collapsedIds, null),
              }
            }

            // Map decorations if selection/cursor moved but doc didn't change
            if (pluginState.decorations) {
              return {
                ...pluginState,
                decorations: pluginState.decorations.map(tr.mapping, tr.doc),
              }
            }

            return pluginState
          },
        },

        props: {
          decorations(state) {
            const pluginState = headingCollapsePluginKey.getState(state)
            return pluginState?.decorations ?? DecorationSet.empty
          },
        },
      }),
    ]
  },
})

export default HeadingCollapseExtension
