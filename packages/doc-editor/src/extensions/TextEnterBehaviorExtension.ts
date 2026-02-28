import { Extension } from "@tiptap/core"
import type { EditorState } from "@tiptap/pm/state"

export type ManagedListItemType = "listItem" | "taskItem"

export type TextEnterBehavior =
  | "none"
  | "continue-list-item"
  | "exit-list-item"
  | "exit-blockquote"

export type TextEnterContext = {
  selectionEmpty: boolean
  inCodeBlock: boolean
  listItemType: ManagedListItemType | null
  listItemEmpty: boolean
  inBlockquote: boolean
  currentTextBlockEmpty: boolean
}

function resolveManagedListItemType(value: string | null | undefined): ManagedListItemType | null {
  if (value === "listItem" || value === "taskItem") {
    return value
  }
  return null
}

function isCurrentTextBlockEmpty(state: EditorState): boolean {
  const parent = state.selection.$from.parent
  if (!parent.isTextblock) {
    return false
  }
  return parent.content.size === 0
}

export function getTextEnterContext(state: EditorState): TextEnterContext {
  const $from = state.selection.$from
  let listItemType: ManagedListItemType | null = null
  let listItemEmpty = false
  let inBlockquote = false
  let inCodeBlock = false

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    const nodeType = node.type.name
    const managedListItemType = resolveManagedListItemType(nodeType)

    if (!listItemType && managedListItemType) {
      listItemType = managedListItemType
      listItemEmpty = node.textContent.trim().length === 0
    }

    if (nodeType === "blockquote") {
      inBlockquote = true
    }

    if (nodeType === "codeBlock") {
      inCodeBlock = true
    }
  }

  return {
    selectionEmpty: state.selection.empty,
    inCodeBlock,
    listItemType,
    listItemEmpty,
    inBlockquote,
    currentTextBlockEmpty: isCurrentTextBlockEmpty(state),
  }
}

export function resolveTextEnterBehavior(context: TextEnterContext): TextEnterBehavior {
  if (!context.selectionEmpty) {
    return "none"
  }

  if (context.inCodeBlock) {
    return "none"
  }

  if (context.listItemType) {
    return context.listItemEmpty ? "exit-list-item" : "continue-list-item"
  }

  if (context.inBlockquote && context.currentTextBlockEmpty) {
    return "exit-blockquote"
  }

  return "none"
}

export const TextEnterBehaviorExtension = Extension.create({
  name: "textEnterBehavior",
  priority: 1100,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const context = getTextEnterContext(this.editor.state)
        const behavior = resolveTextEnterBehavior(context)

        if (behavior === "continue-list-item" && context.listItemType) {
          return this.editor.chain().splitListItem(context.listItemType).run()
        }

        if (behavior === "exit-list-item" && context.listItemType) {
          return this.editor.chain().liftListItem(context.listItemType).run()
        }

        if (behavior === "exit-blockquote") {
          return this.editor.commands.liftEmptyBlock()
        }

        return false
      },
    }
  },
})

export default TextEnterBehaviorExtension
