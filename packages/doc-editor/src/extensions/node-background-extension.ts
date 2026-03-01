import type { NodeWithPos } from "@tiptap/core"
import { Extension } from "@tiptap/core"
import type { EditorState, Transaction } from "@tiptap/pm/state"
import {
  isAllowedBlockBackgroundColor,
  isAllowedBlockTextColor,
} from "./block-style-palette"
import { getSelectedNodesOfType } from "../lib/tiptap-utils"
import { updateNodesAttr } from "../lib/tiptap-utils"

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    nodeBackground: {
      setNodeBackgroundColor: (backgroundColor: string) => ReturnType
      unsetNodeBackgroundColor: () => ReturnType
      toggleNodeBackgroundColor: (backgroundColor: string) => ReturnType
      setNodeTextColor: (textColor: string) => ReturnType
      unsetNodeTextColor: () => ReturnType
      toggleNodeTextColor: (textColor: string) => ReturnType
    }
  }
}

export interface NodeBackgroundOptions {
  /**
   * Node types that should support background colors
   * @default ["paragraph", "heading", "blockquote", "taskList", "bulletList", "orderedList", "tableCell", "tableHeader"]
   */
  types: string[]
  /**
   * Use inline style instead of data attribute
   * @default true
   */
  useStyle?: boolean
}

type BlockStyleColorKind = "background" | "text"
type BlockStyleAttrName = "backgroundColor" | "textColor"

function resolveColorAttributeName(kind: BlockStyleColorKind): BlockStyleAttrName {
  return kind === "background" ? "backgroundColor" : "textColor"
}

/**
 * Resolves and validates incoming color values against predefined palettes.
 */
export function resolveBlockStyleColorInput(
  kind: BlockStyleColorKind,
  input: string | null | undefined
): string | null {
  if (kind === "background") {
    return isAllowedBlockBackgroundColor(input) ? input : null
  }
  return isAllowedBlockTextColor(input) ? input : null
}

function parseElementStyleColor(
  element: HTMLElement,
  kind: BlockStyleColorKind
): string | null {
  const styleColor =
    kind === "background"
      ? element.style?.backgroundColor
      : element.style?.color
  return resolveBlockStyleColorInput(kind, styleColor || null)
}

function parseDataColor(
  element: HTMLElement,
  kind: BlockStyleColorKind
): string | null {
  const dataColor = element.getAttribute(
    kind === "background" ? "data-background-color" : "data-text-color"
  )
  return resolveBlockStyleColorInput(kind, dataColor || null)
}

function resolveCombinedStyleAttributes(
  attributes: Record<string, unknown>,
  useStyle: boolean
) {
  const backgroundColor = resolveBlockStyleColorInput(
    "background",
    (attributes.backgroundColor as string | null | undefined) ?? null
  )
  const textColor = resolveBlockStyleColorInput(
    "text",
    (attributes.textColor as string | null | undefined) ?? null
  )
  const htmlAttrs: Record<string, string> = {}

  if (backgroundColor) {
    htmlAttrs["data-background-color"] = backgroundColor
  }
  if (textColor) {
    htmlAttrs["data-text-color"] = textColor
  }

  if (useStyle) {
    const styleEntries: string[] = []
    if (backgroundColor) {
      styleEntries.push(`background-color: ${backgroundColor}`)
    }
    if (textColor) {
      styleEntries.push(`color: ${textColor}`)
    }
    if (styleEntries.length > 0) {
      htmlAttrs.style = styleEntries.join("; ")
    }
  }

  return htmlAttrs
}

/**
 * Determines the target color for toggle operations
 */
function getToggleColor(
  targets: NodeWithPos[],
  inputColor: string,
  attrName: BlockStyleAttrName
): string | null {
  if (targets.length === 0) return null

  for (const target of targets) {
    const currentColor = (target.node.attrs?.[attrName] as string | null) ?? null
    if (currentColor !== inputColor) {
      return inputColor
    }
  }

  return null
}

export const NodeBackground = Extension.create<NodeBackgroundOptions>({
  name: "nodeBackground",

  addOptions() {
    return {
      types: [
        "paragraph",
        "heading",
        "blockquote",
        "bulletList",
        "orderedList",
        "taskList",
        "listItem",
        "taskItem",
        "tableCell",
        "tableHeader",
      ],
      useStyle: true,
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          backgroundColor: {
            default: null as string | null,

            parseHTML: (element: HTMLElement) => {
              return (
                parseElementStyleColor(element, "background") ??
                parseDataColor(element, "background")
              )
            },

            renderHTML: (attributes) => {
              return resolveCombinedStyleAttributes(
                attributes,
                Boolean(this.options.useStyle)
              )
            },
          },
          textColor: {
            default: null as string | null,
            parseHTML: (element: HTMLElement) => {
              return (
                parseElementStyleColor(element, "text") ??
                parseDataColor(element, "text")
              )
            },
            renderHTML: () => ({}),
          },
        },
      },
    ]
  },

  addCommands() {
    /**
     * Generic command executor for background color operations
     */
    const executeBackgroundCommand = (
      attrName: BlockStyleAttrName,
      kind: BlockStyleColorKind,
      getTargetColor: (
        targets: NodeWithPos[],
        inputColor?: string
      ) => string | null
    ) => {
      return (inputColor?: string) =>
        ({ state, tr }: { state: EditorState; tr: Transaction }) => {
          const targets = getSelectedNodesOfType(
            state.selection,
            this.options.types
          )

          if (targets.length === 0) return false

          const hasInputColor =
            typeof inputColor === "string" && inputColor.trim().length > 0
          const normalizedInputColor = resolveBlockStyleColorInput(
            kind,
            inputColor
          )
          if (hasInputColor && !normalizedInputColor) {
            return false
          }

          const targetColor = getTargetColor(
            targets,
            normalizedInputColor ?? undefined
          )

          return updateNodesAttr(tr, targets, attrName, targetColor)
        }
    }

    return {
      /**
       * Set background color to specific value
       */
      setNodeBackgroundColor: executeBackgroundCommand(
        resolveColorAttributeName("background"),
        "background",
        (_, inputColor) => inputColor || null
      ),

      /**
       * Remove background color
       */
      unsetNodeBackgroundColor: executeBackgroundCommand(
        resolveColorAttributeName("background"),
        "background",
        () => null
      ),

      /**
       * Toggle background color (set if different/missing, unset if all have it)
       */
      toggleNodeBackgroundColor: executeBackgroundCommand(
        resolveColorAttributeName("background"),
        "background",
        (targets, inputColor) => {
          if (!inputColor) return null
          return getToggleColor(
            targets,
            inputColor,
            resolveColorAttributeName("background")
          )
        }
      ),

      /**
       * Set text color to specific value
       */
      setNodeTextColor: executeBackgroundCommand(
        resolveColorAttributeName("text"),
        "text",
        (_, inputColor) => inputColor || null
      ),

      /**
       * Remove text color
       */
      unsetNodeTextColor: executeBackgroundCommand(
        resolveColorAttributeName("text"),
        "text",
        () => null
      ),

      /**
       * Toggle text color (set if different/missing, unset if all have it)
       */
      toggleNodeTextColor: executeBackgroundCommand(
        resolveColorAttributeName("text"),
        "text",
        (targets, inputColor) => {
          if (!inputColor) return null
          return getToggleColor(
            targets,
            inputColor,
            resolveColorAttributeName("text")
          )
        }
      ),
    }
  },
})
