import { Extension } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

type PlaceholderContext = {
  nodeType: string
  level?: number
}

type PlaceholderNodeContext = {
  nodeType: string
  parentType?: string
}

export function getBlockTypePlaceholderText(ctx: PlaceholderContext): string | null {
  if (ctx.nodeType === "paragraph") {
    return "段落"
  }
  if (ctx.nodeType === "heading") {
    const level = typeof ctx.level === "number" ? Math.max(1, Math.min(6, ctx.level)) : 1
    return `标题${level}`
  }
  return null
}

export function shouldDecorateBlockTypePlaceholder(
  ctx: PlaceholderNodeContext
): boolean {
  if (ctx.parentType !== "doc") {
    return false
  }
  return ctx.nodeType === "paragraph" || ctx.nodeType === "heading"
}

export const BlockTypePlaceholderExtension = Extension.create({
  name: "blockTypePlaceholder",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos, parent) => {
              if (node.content.size > 0) {
                return
              }
              if (!shouldDecorateBlockTypePlaceholder({
                nodeType: node.type.name,
                parentType: parent?.type?.name,
              })) {
                return
              }
              const placeholder = getBlockTypePlaceholderText({
                nodeType: node.type.name,
                level: node.type.name === "heading" ? Number(node.attrs?.level) : undefined,
              })
              if (!placeholder) {
                return
              }
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  class: "is-empty",
                  "data-placeholder": placeholder,
                })
              )
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
