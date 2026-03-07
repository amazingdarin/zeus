import { Extension } from "@tiptap/core"
import type { Node as ProsemirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"

type TopLevelBlock = {
  id: string
  pos: number
  endPos: number
  node: ProsemirrorNode
}

type BlockCollapseState = {
  collapsedIds: Set<string>
  decorations: DecorationSet
}

type BlockCollapseMeta =
  | { type: "toggle"; blockId: string }
  | { type: "expandAll" }

export const blockCollapsePluginKey = new PluginKey<BlockCollapseState>("blockCollapse")

export function extractTopLevelBlocks(doc: ProsemirrorNode): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = []
  doc.forEach((node, pos) => {
    if (!node.isBlock) {
      return
    }
    const id = String(node.attrs?.id ?? "").trim()
    if (!id) {
      return
    }
    blocks.push({
      id,
      pos,
      endPos: pos + node.nodeSize,
      node,
    })
  })
  return blocks
}

export function isBlockCollapsed(state: EditorState, blockId: string): boolean {
  const pluginState = blockCollapsePluginKey.getState(state)
  return pluginState?.collapsedIds.has(blockId) ?? false
}

function normalizeSummaryText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim()
  if (!text) {
    return ""
  }
  if (text.length <= 72) {
    return text
  }
  return `${text.slice(0, 72)}...`
}

function buildBlockSummary(node: ProsemirrorNode): string {
  const text = normalizeSummaryText(node.textContent || "")
  if (text) {
    return text
  }
  switch (node.type.name) {
    case "image":
    case "imageUpload":
      return "图片块"
    case "file_block":
      return "文件块"
    case "codeBlock":
      return "代码块"
    case "table":
      return "表格块"
    case "horizontalRule":
      return "分割线"
    case "bulletList":
    case "orderedList":
    case "taskList":
      return "列表块"
    default:
      return "空内容"
  }
}

function createSummaryWidget(
  block: TopLevelBlock,
  summary: string,
  view: EditorView,
) {
  const button = document.createElement("button")
  button.className = "doc-editor-collapsed-summary"
  button.type = "button"
  button.setAttribute("aria-label", "展开块")
  button.setAttribute("data-block-id", block.id)
  button.textContent = `▸ ${summary}`
  button.addEventListener("mousedown", (event) => {
    event.preventDefault()
    event.stopPropagation()
    const tr = view.state.tr.setMeta(blockCollapsePluginKey, {
      type: "toggle",
      blockId: block.id,
    } as BlockCollapseMeta)
    view.dispatch(tr)
  })
  return button
}

function createDecorations(
  doc: ProsemirrorNode,
  collapsedIds: Set<string>,
): DecorationSet {
  if (collapsedIds.size === 0) {
    return DecorationSet.empty
  }

  const decorations: Decoration[] = []
  const blocks = extractTopLevelBlocks(doc)
  const blockById = new Map(blocks.map((block) => [block.id, block]))

  for (const blockId of collapsedIds) {
    const block = blockById.get(blockId)
    if (!block) {
      continue
    }
    const summary = buildBlockSummary(block.node)
    decorations.push(
      Decoration.widget(
        block.pos,
        (view) => createSummaryWidget(block, summary, view),
        { side: -1, key: `collapsed-summary-${block.id}` },
      ),
    )
    decorations.push(
      Decoration.node(block.pos, block.endPos, {
        class: "doc-editor-block-collapsed-hidden",
      }),
    )
  }

  return DecorationSet.create(doc, decorations)
}

function filterExistingIds(doc: ProsemirrorNode, source: Set<string>): Set<string> {
  if (source.size === 0) {
    return source
  }
  const availableIds = new Set(extractTopLevelBlocks(doc).map((block) => block.id))
  const next = new Set<string>()
  for (const id of source) {
    if (availableIds.has(id)) {
      next.add(id)
    }
  }
  return next
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockCollapse: {
      toggleBlockCollapse: (blockId: string) => ReturnType
      expandAllBlocks: () => ReturnType
    }
  }
}

export const BlockCollapseExtension = Extension.create({
  name: "blockCollapse",

  addCommands() {
    return {
      toggleBlockCollapse:
        (blockId: string) =>
        ({ tr, dispatch }) => {
          if (!dispatch) {
            return true
          }
          tr.setMeta(blockCollapsePluginKey, {
            type: "toggle",
            blockId,
          } as BlockCollapseMeta)
          dispatch(tr)
          return true
        },
      expandAllBlocks:
        () =>
        ({ tr, dispatch }) => {
          if (!dispatch) {
            return true
          }
          tr.setMeta(blockCollapsePluginKey, {
            type: "expandAll",
          } as BlockCollapseMeta)
          dispatch(tr)
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<BlockCollapseState>({
        key: blockCollapsePluginKey,
        state: {
          init(_, state) {
            return {
              collapsedIds: new Set<string>(),
              decorations: createDecorations(state.doc, new Set<string>()),
            }
          },
          apply(tr, pluginState, _oldState, newState) {
            const meta = tr.getMeta(blockCollapsePluginKey) as BlockCollapseMeta | undefined
            let nextCollapsedIds = pluginState.collapsedIds

            if (meta?.type === "toggle") {
              const normalized = String(meta.blockId || "").trim()
              if (normalized) {
                nextCollapsedIds = new Set(nextCollapsedIds)
                if (nextCollapsedIds.has(normalized)) {
                  nextCollapsedIds.delete(normalized)
                } else {
                  nextCollapsedIds.add(normalized)
                }
              }
            } else if (meta?.type === "expandAll") {
              nextCollapsedIds = new Set<string>()
            }

            if (!tr.docChanged && !meta) {
              return pluginState
            }

            nextCollapsedIds = filterExistingIds(newState.doc, nextCollapsedIds)
            return {
              collapsedIds: nextCollapsedIds,
              decorations: createDecorations(newState.doc, nextCollapsedIds),
            }
          },
        },
        props: {
          decorations(state) {
            const pluginState = this.getState(state)
            return pluginState?.decorations ?? DecorationSet.empty
          },
        },
      }),
    ]
  },
})

export default BlockCollapseExtension
