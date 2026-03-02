"use client"

import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent, ReactNode, ReactElement } from "react"
import type { Editor, JSONContent } from "@tiptap/react"
import { EditorContent, EditorContext, useEditor } from "@tiptap/react"
import type { Extensions } from "@tiptap/core"
import { Fragment, type Node as ProsemirrorNode } from "@tiptap/pm/model"

// --- Tiptap Core Extensions ---
import { StarterKit } from "@tiptap/starter-kit"
import { Image } from "@tiptap/extension-image"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TextAlign } from "@tiptap/extension-text-align"
import { Typography } from "@tiptap/extension-typography"
import { Highlight } from "@tiptap/extension-highlight"
import { Subscript } from "@tiptap/extension-subscript"
import { Superscript } from "@tiptap/extension-superscript"
import { Selection } from "@tiptap/extensions"

// --- UI Primitives ---
import { Button } from "../../primitives/button"
import { Spacer } from "../../primitives/spacer"
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "../../primitives/toolbar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../primitives/dropdown-menu"

// --- Tiptap Node ---
import { ImageUploadNode } from "../../nodes/image-upload-node/image-upload-node-extension"
import { HorizontalRule } from "../../nodes/horizontal-rule-node/horizontal-rule-node-extension"
import { CodeBlockNode } from "../../nodes/code-block-node/code-block-node-extension"
import { LinkPreviewNode } from "../../nodes/link-preview-node/link-preview-node-extension"
import { TocNode } from "../../nodes/toc-node/toc-node-extension"
import { MathNode } from "../../nodes/math-node/math-node-extension"
import { ChartNode } from "../../nodes/chart-node/chart-node-extension"
import { MindmapNode } from "../../nodes/mindmap-node/mindmap-node-extension"
import { ColumnNode, ColumnsNode } from "../../nodes/columns-node/columns-node-extension"
import {
  createDefaultColumnWidths,
  normalizeColumnsCount,
  normalizeColumnsWidths,
} from "../../nodes/columns-node/columns-transform"
import { createTableExtensions } from "../../nodes/table-node/table-node-extension"
import "../../nodes/blockquote-node/blockquote-node.scss"
import "../../nodes/code-block-node/code-block-node.scss"
import "../../nodes/horizontal-rule-node/horizontal-rule-node.scss"
import "../../nodes/list-node/list-node.scss"
import "../../nodes/image-node/image-node.scss"
import "../../nodes/heading-node/heading-node.scss"
import "../../nodes/paragraph-node/paragraph-node.scss"
import "../../nodes/link-preview-node/link-preview-node.scss"
import "../../nodes/toc-node/toc-node.scss"
import "../../nodes/table-node/table-node.scss"
import "../../nodes/math-node/math-node.scss"
import "../../nodes/chart-node/chart-node.scss"
import "../../nodes/mindmap-node/mindmap-node.scss"
import "../../nodes/columns-node/columns-node.scss"
import "../../nodes/edu-question-set-node/edu-question-set-node.scss"
import "../../ui/table-button/table-menu.scss"
import "../../ui/chart-button/chart-button.scss"
import "../../ui/edu-question-set-button/edu-question-set-button.scss"

// --- Tiptap UI ---
import { HeadingDropdownMenu } from "../../ui/heading-dropdown-menu"
import { ImageUploadButton } from "../../ui/image-upload-button"
import { FileBlockButton } from "../../ui/file-block-button"
import { HorizontalRuleButton } from "../../ui/horizontal-rule-button"
import { LinkPreviewButton } from "../../ui/link-preview-button"
import { ListDropdownMenu } from "../../ui/list-dropdown-menu"
import { BlockquoteButton } from "../../ui/blockquote-button"
import { CodeBlockButton } from "../../ui/code-block-button"
import { TocButton } from "../../ui/toc-button"
import { TableMenu } from "../../ui/table-button"
import { MathButton } from "../../ui/math-button"
import { ChartButton } from "../../ui/chart-button"
import { MindmapButton } from "../../ui/mindmap-button"
import {
  BlockAddMenu,
  getBuiltinBlockItems,
  getPluginBlockItems,
  type BlockMenuItem,
  type PluginBlockItem,
} from "../../ui/block-add-menu"
import {
  ColorHighlightPopover,
  ColorHighlightPopoverContent,
  ColorHighlightPopoverButton,
} from "../../ui/color-highlight-popover"
import { MarkButton } from "../../ui/mark-button"
import { TextAlignButton } from "../../ui/text-align-button"
import { UndoRedoButton } from "../../ui/undo-redo-button"
import {
  buildBlockStyleMenuState,
  collectNodeStyleValues,
  type BlockStyleAttrName,
  type BlockStyleMenuState,
} from "../../ui/block-style-menu"

// --- Icons ---
import { ArrowLeftIcon } from "../../icons/arrow-left-icon"
import { ChevronDownIcon } from "../../icons/chevron-down-icon"
import { HighlighterIcon } from "../../icons/highlighter-icon"

// --- Hooks ---
import { useIsBreakpoint } from "../../hooks/use-is-breakpoint"
import { useWindowSize } from "../../hooks/use-window-size"
import { useCursorVisibility } from "../../hooks/use-cursor-visibility"

// --- Components ---

// --- Lib ---
import {
  getSelectedNodesOfType,
  handleImageUpload,
  MAX_FILE_SIZE,
} from "../../lib/tiptap-utils"
import {
  BlockIdExtension,
  ensureBlockIds,
} from "../../extensions/BlockIdExtension"
import {
  UnsupportedPluginBlock,
  normalizeUnsupportedPluginBlocks,
} from "../../extensions/UnsupportedPluginBlockExtension"
import { BlockTypePlaceholderExtension } from "../../extensions/BlockTypePlaceholderExtension"
import {
  extractTopLevelBlocks,
} from "../../extensions/BlockCollapseExtension"
import { NodeBackground } from "../../extensions/node-background-extension"
import {
  BLOCK_BACKGROUND_COLOR_OPTIONS,
  BLOCK_TEXT_COLOR_OPTIONS,
} from "../../extensions/block-style-palette"
import { HeadingCollapseExtension } from "../../extensions/HeadingCollapseExtension"
import { TextEnterBehaviorExtension } from "../../extensions/TextEnterBehaviorExtension"
import {
  isPointerInLeftRail,
  moveMenuHighlightIndex,
  resolveHandleAnchorBlockId,
  resolveFloatingMenuPlacement,
  resolveNormalizedDropTarget,
  shouldHideControlsOnPointerExit,
  isDesktopHandleEnabled,
  isBlockActionMenuShortcut,
  resolveHoveredBlockId,
  type BuiltinBlockType,
} from "../../extensions/block-add-handle"
import {
  hasLongerShortcutPrefix,
  matchSlashShortcutToken,
  resolveDocumentBlockShortcuts,
} from "../../extensions/block-shortcuts"
import { syncEditorEditableState } from "../../extensions/editable-sync"
import { shouldApplyIncomingContentSync } from "../../extensions/content-sync"
import {
  convertTopLevelTextBlock,
  getConvertibleTargetTypes,
  resolveCurrentBlockConvertType,
  type ConvertibleTextBlockType,
} from "../../extensions/block-conversion"
import { cloneBlockNodeForDuplicate } from "../../extensions/block-duplicate"
import { buildStandaloneBuiltinBlockContent } from "../../extensions/builtin-block-content"

// --- Styles ---
import "./doc-editor.scss"

type DocEditorProps = {
  onChange?: (content: JSONContent) => void
  content?: JSONContent | null
  extensions?: Extensions
  mode?: "edit" | "view"
  docId?: string
  onLoadDocument?: (id: string) => Promise<JSONContent>
  onEditorReady?: (editor: Editor | null) => void
  linkPreviewFetchHtml?: (url: string) => Promise<string>
  /** Callback when a task item checkbox is toggled in view mode */
  onTaskCheckChange?: (blockId: string, checked: boolean) => void
  pluginContributions?: {
    extraExtensions?: Extensions
    toolbarItems?: ReactNode[]
    blockIdNodeTypes?: string[]
    pluginBlockGroups?: PluginBlockToolbarGroup[]
  }
  documentBlockShortcuts?: Record<string, string | undefined>
}

type PluginBlockToolbarAction = {
  id: string
  blockType?: string
  title: string
  toolbarButton: ReactNode
}

type PluginBlockToolbarGroup = {
  pluginId: string
  pluginTitle: string
  blocks: PluginBlockToolbarAction[]
}

type DropPlacement = "before" | "after"

type TopLevelBlock = {
  id: string
  pos: number
  endPos: number
  node: ProsemirrorNode
}

function getTopLevelBlocks(editor: Editor): TopLevelBlock[] {
  return extractTopLevelBlocks(editor.state.doc).map((block) => ({
    id: block.id,
    pos: block.pos,
    endPos: block.endPos,
    node: block.node,
  }))
}

function findCurrentTopLevelBlock(editor: Editor): TopLevelBlock | null {
  const from = editor.state.selection.from
  const blocks = getTopLevelBlocks(editor)
  for (const block of blocks) {
    if (from >= block.pos && from < block.endPos) {
      return block
    }
  }
  if (blocks.length === 0) {
    return null
  }
  return blocks[blocks.length - 1]
}

function findTopLevelBlockById(editor: Editor, blockId: string): TopLevelBlock | null {
  const blocks = getTopLevelBlocks(editor)
  return blocks.find((block) => block.id === blockId) ?? null
}

function collectExtensionNames(extensions: Extensions): string[] {
  const names = new Set<string>()
  for (const extension of extensions) {
    if (!extension || typeof extension !== "object") {
      continue
    }
    const name = "name" in extension ? String((extension as { name?: unknown }).name || "").trim() : ""
    if (name) {
      names.add(name)
    }
  }
  return Array.from(names)
}

function scheduleMicrotask(task: () => void) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(task)
    return
  }
  Promise.resolve().then(task)
}

function parseCssPx(value: string | null | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "")
  return Number.isFinite(parsed) ? parsed : fallback
}

function estimateBlockMenuHeight(itemCount: number): number {
  const count = Math.max(0, itemCount)
  return Math.min(360, Math.max(120, 56 + count * 34))
}

const DOC_EDITOR_BLOCK_STYLE_TYPES = [
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
] as const

function resolveBlockStyleSelectionState(
  editor: Editor | null,
  attrName: BlockStyleAttrName
): BlockStyleMenuState {
  if (!editor) {
    return { kind: "empty" }
  }
  const targets = getSelectedNodesOfType(
    editor.state.selection,
    Array.from(DOC_EDITOR_BLOCK_STYLE_TYPES)
  )
  if (targets.length === 0) {
    return { kind: "empty" }
  }
  return buildBlockStyleMenuState(collectNodeStyleValues(targets, attrName))
}

const defaultContent: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
    },
  ],
}

type BuiltinColumnsLayout = {
  count?: number
}

function resolveBuiltinColumnsLayout(
  layout: BuiltinColumnsLayout | undefined,
  fallbackCount = 2,
): { count: number } {
  const count = normalizeColumnsCount(layout?.count ?? fallbackCount)
  return { count }
}

function insertBuiltinBlock(
  editor: Editor,
  type: BuiltinBlockType,
  options?: { columns?: BuiltinColumnsLayout }
): void {
  const chain = editor.chain().focus()
  switch (type) {
    case "paragraph":
      chain.setParagraph().run()
      return
    case "heading-1":
      chain.setHeading({ level: 1 }).run()
      return
    case "collapsible-heading-1":
      chain
        .setHeading({ level: 1 })
        .updateAttributes("heading", { collapsible: true })
        .run()
      return
    case "heading-2":
      chain.setHeading({ level: 2 }).run()
      return
    case "collapsible-heading-2":
      chain
        .setHeading({ level: 2 })
        .updateAttributes("heading", { collapsible: true })
        .run()
      return
    case "heading-3":
      chain.setHeading({ level: 3 }).run()
      return
    case "collapsible-heading-3":
      chain
        .setHeading({ level: 3 })
        .updateAttributes("heading", { collapsible: true })
        .run()
      return
    case "toggle-block":
      chain.insertContent([
        {
          type: "heading",
          attrs: { level: 3, collapsible: true },
          content: [{ type: "text", text: "可折叠块" }],
        },
        {
          type: "paragraph",
        },
      ]).run()
      return
    case "bullet-list":
      chain.toggleBulletList().run()
      return
    case "ordered-list":
      chain.toggleOrderedList().run()
      return
    case "task-list":
      chain.toggleTaskList().run()
      return
    case "blockquote":
      chain.toggleBlockquote().run()
      return
    case "horizontal-rule":
      chain.setHorizontalRule().run()
      return
    case "code-block":
      chain.setCodeBlock().run()
      return
    case "math":
      chain.insertMath({ latex: "", display: true }).run()
      return
    case "chart":
      chain.insertChart({ chartType: "bar", mode: "simple" }).run()
      return
    case "mindmap":
      chain.insertMindmap().run()
      return
    case "toc":
      chain.insertToc().run()
      return
    case "link-preview":
      chain.insertLinkPreview({ url: "", status: "idle" }).run()
      return
    case "image":
      chain.setImageUploadNode().run()
      return
    case "file":
      chain.insertFileBlock().run()
      return
    case "table":
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      return
    case "columns": {
      const { count } = resolveBuiltinColumnsLayout(options?.columns, 2)
      chain.insertColumns({ count }).run()
      return
    }
    case "columns-2":
      chain.insertColumns({ count: 2 }).run()
      return
    case "columns-3":
      chain.insertColumns({ count: 3 }).run()
      return
    case "columns-4":
      chain.insertColumns({ count: 4 }).run()
      return
    case "columns-5":
      chain.insertColumns({ count: 5 }).run()
      return
    default:
      return
  }
}

function insertStandaloneBuiltinBlockAtPos(
  editor: Editor,
  type: BuiltinBlockType,
  insertPos: number,
  options?: { columns?: BuiltinColumnsLayout },
): boolean {
  try {
    const content = buildStandaloneBuiltinBlockContent(type, options)
    const contentItems = Array.isArray(content) ? content : [content]
    const lastInsertedType = String(contentItems[contentItems.length - 1]?.type ?? "")
    const insertedEndsWithParagraph = lastInsertedType === "paragraph"
    const beforeDoc = editor.state.doc
    const beforeTrailingEmptyParagraph =
      beforeDoc.lastChild?.type.name === "paragraph" &&
      beforeDoc.lastChild.content.size === 0

    const schema = editor.state.schema
    const nodes = contentItems.map((item) =>
      schema.nodeFromJSON(item)
    )
    const fragment = Fragment.fromArray(nodes)
    const tr = editor.state.tr.insert(insertPos, fragment)
    editor.view.dispatch(tr)

    if (!insertedEndsWithParagraph && !beforeTrailingEmptyParagraph) {
      const afterDoc = editor.state.doc
      const afterLast = afterDoc.lastChild
      if (
        afterDoc.childCount >= 2 &&
        afterLast?.type.name === "paragraph" &&
        afterLast.content.size === 0
      ) {
        const removeFrom = afterDoc.content.size - afterLast.nodeSize
        editor.view.dispatch(editor.state.tr.delete(removeFrom, afterDoc.content.size))
      }
    }

    editor.view.focus()
    return true
  } catch {
    return false
  }
}

function replaceRangeWithStandaloneBuiltinBlock(
  editor: Editor,
  type: BuiltinBlockType,
  from: number,
  to: number,
  options?: { columns?: BuiltinColumnsLayout },
): boolean {
  try {
    const content = buildStandaloneBuiltinBlockContent(type, options)
    const contentItems = Array.isArray(content) ? content : [content]
    const lastInsertedType = String(contentItems[contentItems.length - 1]?.type ?? "")
    const insertedEndsWithParagraph = lastInsertedType === "paragraph"
    const beforeDoc = editor.state.doc
    const beforeTrailingEmptyParagraph =
      beforeDoc.lastChild?.type.name === "paragraph" &&
      beforeDoc.lastChild.content.size === 0

    const schema = editor.state.schema
    const nodes = contentItems.map((item) =>
      schema.nodeFromJSON(item)
    )
    const fragment = Fragment.fromArray(nodes)
    const tr = editor.state.tr.replaceWith(from, to, fragment)
    editor.view.dispatch(tr)

    if (!insertedEndsWithParagraph && !beforeTrailingEmptyParagraph) {
      const afterDoc = editor.state.doc
      const afterLast = afterDoc.lastChild
      if (
        afterDoc.childCount >= 2 &&
        afterLast?.type.name === "paragraph" &&
        afterLast.content.size === 0
      ) {
        const removeFrom = afterDoc.content.size - afterLast.nodeSize
        editor.view.dispatch(editor.state.tr.delete(removeFrom, afterDoc.content.size))
      }
    }

    editor.view.focus()
    return true
  } catch {
    return false
  }
}

function renderToolbarNodeWithEditor(node: ReactNode, editor: Editor | null): ReactNode {
  if (isValidElement(node) && typeof node.type !== "string") {
    return cloneElement(
      node as ReactElement<Record<string, unknown>>,
      { editor },
    )
  }
  return node
}

function tryInvokeToolbarButton(node: ReactNode, editor: Editor): boolean {
  const rendered = renderToolbarNodeWithEditor(node, editor)
  if (!isValidElement(rendered)) {
    return false
  }
  const onClick = (rendered.props as { onClick?: unknown }).onClick
  if (typeof onClick !== "function") {
    return false
  }
  try {
    onClick({
      preventDefault: () => {},
      stopPropagation: () => {},
      defaultPrevented: false,
    })
    return true
  } catch {
    return false
  }
}

function tryInsertPluginBlock(editor: Editor, action: PluginBlockToolbarAction): boolean {
  const blockType = String(action.blockType || "").trim()
  if (blockType) {
    const insertedByBlockType = editor
      .chain()
      .focus()
      .insertContent({ type: blockType })
      .run()
    if (insertedByBlockType) {
      return true
    }
  }
  return tryInvokeToolbarButton(action.toolbarButton, editor)
}

const PluginBlockDropdown = ({
  editor,
  groups,
  isMobile,
}: {
  editor: Editor | null
  groups: PluginBlockToolbarGroup[]
  isMobile: boolean
}) => {
  if (groups.length === 0) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          data-style="ghost"
          data-active-state="off"
          role="button"
          tabIndex={-1}
          aria-label="Insert plugin block"
          tooltip="插件 Block"
        >
          <span className="tiptap-button-text">插件 Block</span>
          <ChevronDownIcon className="tiptap-button-dropdown-small" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={isMobile ? "start" : "end"}
        sideOffset={6}
        className="doc-editor-plugin-block-dropdown"
        portal={isMobile}
      >
        <div className="doc-editor-plugin-block-root">
          {groups.map((group) => (
            <DropdownMenuSub key={`plugin-block-group-${group.pluginId}`}>
              <DropdownMenuSubTrigger className="doc-editor-plugin-block-subtrigger">
                <span>{group.pluginTitle}</span>
                <span aria-hidden className="doc-editor-plugin-block-subtrigger-arrow">›</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                className="doc-editor-plugin-block-subcontent"
                sideOffset={4}
                portal={isMobile}
              >
                <div className="doc-editor-plugin-block-list">
                  {group.blocks.map((block) => (
                    <div
                      key={`plugin-block-item-${group.pluginId}-${block.id}`}
                      className="doc-editor-plugin-block-item"
                    >
                      <span className="doc-editor-plugin-block-item-title">
                        {block.title}
                      </span>
                      <span className="doc-editor-plugin-block-item-action">
                        {renderToolbarNodeWithEditor(block.toolbarButton, editor)}
                      </span>
                    </div>
                  ))}
                </div>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const MainToolbarContent = ({
  onHighlighterClick,
  isMobile,
  editor,
  pluginToolbarItems,
  pluginBlockGroups,
}: {
  onHighlighterClick: () => void
  isMobile: boolean
  editor: Editor | null
  pluginToolbarItems: ReactNode[]
  pluginBlockGroups: PluginBlockToolbarGroup[]
}) => {
  return (
    <>
      {!isMobile && <Spacer />}

      <ToolbarGroup>
        <UndoRedoButton action="undo" />
        <UndoRedoButton action="redo" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <HeadingDropdownMenu levels={[1, 2, 3, 4]} portal={isMobile} />
        <ListDropdownMenu
          types={["bulletList", "orderedList", "taskList"]}
          portal={isMobile}
        />
        <BlockquoteButton />
        <HorizontalRuleButton />
        <CodeBlockButton />
        <MathButton />
        <ChartButton />
        <MindmapButton />
        <TableMenu />
        <TocButton />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="bold" />
        <MarkButton type="italic" />
        <MarkButton type="strike" />
        <MarkButton type="code" />
        <MarkButton type="underline" />
        {!isMobile ? (
          <ColorHighlightPopover />
        ) : (
          <ColorHighlightPopoverButton onClick={onHighlighterClick} />
        )}
        <LinkPreviewButton />
        <ImageUploadButton />
        <FileBlockButton />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="superscript" />
        <MarkButton type="subscript" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <TextAlignButton align="left" />
        <TextAlignButton align="center" />
        <TextAlignButton align="right" />
        <TextAlignButton align="justify" />
      </ToolbarGroup>

      {pluginToolbarItems.length > 0 ? (
        <>
          <ToolbarSeparator />
          <ToolbarGroup>
            {pluginToolbarItems.map((item, index) => (
              <span key={`plugin-toolbar-item-${index}`} className="doc-editor-plugin-toolbar-item">
                {renderToolbarNodeWithEditor(item, editor)}
              </span>
            ))}
          </ToolbarGroup>
        </>
      ) : null}

      {!isMobile && <Spacer />}

      {pluginBlockGroups.length > 0 ? (
        <ToolbarGroup>
          <PluginBlockDropdown
            editor={editor}
            groups={pluginBlockGroups}
            isMobile={isMobile}
          />
        </ToolbarGroup>
      ) : null}

      {isMobile && <ToolbarSeparator />}

    </>
  )
}

const MobileToolbarContent = ({
  onBack,
}: {
  onBack: () => void
}) => (
  <>
    <ToolbarGroup>
      <Button data-style="ghost" onClick={onBack}>
        <ArrowLeftIcon className="tiptap-button-icon" />
        <HighlighterIcon className="tiptap-button-icon" />
      </Button>
    </ToolbarGroup>

    <ToolbarSeparator />

    <ColorHighlightPopoverContent />
  </>
)

export function DocEditor({
  onChange,
  content,
  mode = "edit",
  extensions = [],
  docId,
  onLoadDocument,
  onEditorReady,
  linkPreviewFetchHtml,
  onTaskCheckChange,
  pluginContributions,
  documentBlockShortcuts,
}: DocEditorProps) {
  const isEditable = mode === "edit"
  const showTopToolbar = false
  const isMobile = useIsBreakpoint()
  const { height } = useWindowSize()
  const [mobileView, setMobileView] = useState<"main" | "highlighter">(
    "main"
  )
  const toolbarRef = useRef<HTMLDivElement>(null)
  const editorShellRef = useRef<HTMLDivElement>(null)
  const blockAddContainerRef = useRef<HTMLDivElement>(null)
  const lastContentRef = useRef<string | null>(null)
  const taskCheckChangeRef = useRef(onTaskCheckChange)
  const [blockAddMenuOpen, setBlockAddMenuOpen] = useState(false)
  const [blockActionMenuOpen, setBlockActionMenuOpen] = useState(false)
  const [blockActionConvertMenuOpen, setBlockActionConvertMenuOpen] = useState(false)
  const [blockActionBackgroundMenuOpen, setBlockActionBackgroundMenuOpen] = useState(false)
  const [blockActionTextMenuOpen, setBlockActionTextMenuOpen] = useState(false)
  const [blockMenuHighlightIndex, setBlockMenuHighlightIndex] = useState(0)
  const [blockControlsVisible, setBlockControlsVisible] = useState(false)
  const [blockHandleTop, setBlockHandleTop] = useState(16)
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null)
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null)
  const [dropIndicatorTop, setDropIndicatorTop] = useState<number | null>(null)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashMenuHighlightIndex, setSlashMenuHighlightIndex] = useState(0)
  const [slashMenuQuery, setSlashMenuQuery] = useState("")
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 })
  const [blockAddMenuPosition, setBlockAddMenuPosition] = useState({ top: 34, left: 0 })
  const [columnsConfigOpen, setColumnsConfigOpen] = useState(false)
  const [columnsConfigCount, setColumnsConfigCount] = useState(2)
  const columnsConfigSourceRef = useRef<"block" | "slash">("block")
  const dragSourceIdRef = useRef<string | null>(null)
  const dragDropTargetRef = useRef<{ blockId: string; placement: DropPlacement } | null>(null)
  const pendingSlashMenuOpenRef = useRef(false)
  const slashTriggerPosRef = useRef<number | null>(null)
  const slashMenuOpenRef = useRef(false)
  const slashShortcutCommitTimerRef = useRef<number | null>(null)
  const hoverClientYRef = useRef<number | null>(null)
  const applyingInlineSlashShortcutRef = useRef(false)
  taskCheckChangeRef.current = onTaskCheckChange
  const desktopHandleEnabled = isDesktopHandleEnabled({ isMobile, mode })

  const extraExtensions = useMemo<Extensions>(
    () => pluginContributions?.extraExtensions || [],
    [pluginContributions?.extraExtensions]
  )
  const pluginToolbarItems = useMemo<ReactNode[]>(
    () => pluginContributions?.toolbarItems || [],
    [pluginContributions?.toolbarItems]
  )
  const pluginBlockIdTypes = useMemo<string[]>(
    () => pluginContributions?.blockIdNodeTypes || [],
    [pluginContributions?.blockIdNodeTypes]
  )
  const pluginBlockGroups = useMemo<PluginBlockToolbarGroup[]>(
    () => pluginContributions?.pluginBlockGroups || [],
    [pluginContributions?.pluginBlockGroups]
  )
  const knownExtensionNodeTypes = useMemo<string[]>(
    () => collectExtensionNames([...(extensions || []), ...(extraExtensions || [])]),
    [extensions, extraExtensions]
  )
  const extensionSignature = useMemo(
    () => knownExtensionNodeTypes.join("|"),
    [knownExtensionNodeTypes]
  )
  const pluginBlockIdSignature = useMemo(
    () => pluginBlockIdTypes.join("|"),
    [pluginBlockIdTypes]
  )
  const resolvedBlockShortcuts = useMemo(
    () => resolveDocumentBlockShortcuts(documentBlockShortcuts),
    [documentBlockShortcuts]
  )
  const builtinBlockItems = useMemo(
    () => getBuiltinBlockItems(resolvedBlockShortcuts.blockToKeyMap),
    [resolvedBlockShortcuts.blockToKeyMap]
  )
  const pluginBlockMenuItems = useMemo<PluginBlockItem[]>(
    () =>
      getPluginBlockItems(
        pluginBlockGroups.map((group) => ({
          pluginId: group.pluginId,
          pluginTitle: group.pluginTitle,
          blocks: group.blocks.map((block) => ({
            id: block.id,
            title: block.title,
          })),
        }))
      ),
    [pluginBlockGroups]
  )
  const blockMenuItems = useMemo<BlockMenuItem[]>(
    () => [...builtinBlockItems, ...pluginBlockMenuItems],
    [builtinBlockItems, pluginBlockMenuItems]
  )
  const slashMenuItems = useMemo<BlockMenuItem[]>(
    () => {
      const query = slashMenuQuery.trim()
      if (!query) {
        return blockMenuItems
      }
      return blockMenuItems.filter((item) => {
        const shortcut = String(item.shortcut ?? "").trim()
        return Boolean(shortcut) && shortcut.startsWith(query)
      })
    },
    [blockMenuItems, slashMenuQuery]
  )
  const builtinBlockLabelMap = useMemo(
    () => new Map(builtinBlockItems.map((item) => [item.id, item.label] as const)),
    [builtinBlockItems]
  )
  const pluginBlockActionMap = useMemo(() => {
    const map = new Map<string, PluginBlockToolbarAction>()
    for (const group of pluginBlockGroups) {
      for (const block of group.blocks) {
        const key = `${group.pluginId}:${block.id}`
        map.set(key, block)
      }
    }
    return map
  }, [pluginBlockGroups])

  const initialContent = useMemo(
    () =>
      ensureBlockIds(
        normalizeUnsupportedPluginBlocks(content ?? defaultContent, {
          knownNodeTypes: knownExtensionNodeTypes,
        }),
        { extraNodeTypes: pluginBlockIdTypes }
      ),
    [content, knownExtensionNodeTypes, pluginBlockIdTypes]
  )

  const editor = useEditor(
    {
      immediatelyRender: false,
      editorProps: {
        attributes: {
          autocomplete: "off",
          autocorrect: "off",
          autocapitalize: "off",
          "aria-label": "Main content area, start typing to enter text.",
          class: "doc-editor",
        },
        handlePaste(view, event) {
          const text = event.clipboardData?.getData("text/plain")
          if (!text) {
            return false
          }
          const { tr } = view.state
          view.dispatch(tr.insertText(text))
          return true
        },
      },
      extensions: [
        BlockIdExtension.configure({
          extraNodeTypes: pluginBlockIdTypes,
        }),
        UnsupportedPluginBlock,
        ...(isEditable ? [BlockTypePlaceholderExtension] : []),
        ...(isEditable ? [TextEnterBehaviorExtension] : []),
        HeadingCollapseExtension,
        StarterKit.configure({
          horizontalRule: false,
          codeBlock: false,
          trailingNode: false,
          link: {
            openOnClick: false,
            enableClickSelection: true,
          },
        }),
        CodeBlockNode,
        HorizontalRule,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        TaskList,
        TaskItem.configure({
          nested: true,
          onReadOnlyChecked: (node, checked) => {
            const blockId = node.attrs?.id as string | undefined
            if (blockId && taskCheckChangeRef.current) {
              taskCheckChangeRef.current(blockId, checked)
            }
            return true // Allow visual update
          },
        }),
        NodeBackground.configure({
          types: Array.from(DOC_EDITOR_BLOCK_STYLE_TYPES),
        }),
        Highlight.configure({ multicolor: true }),
        Image,
        Typography,
        Superscript,
        Subscript,
        Selection,
        ImageUploadNode.configure({
          accept: "image/*",
          maxSize: MAX_FILE_SIZE,
          limit: 3,
          upload: handleImageUpload,
          onError: (error) => console.error("Upload failed:", error),
        }),
        LinkPreviewNode.configure({
          fetchHtml: linkPreviewFetchHtml,
        }),
        TocNode,
        MathNode,
        ChartNode,
        MindmapNode,
        ColumnNode,
        ColumnsNode,
        ...createTableExtensions(),
        ...extensions,
        ...extraExtensions,
      ],
      content: initialContent,
      editable: isEditable,
    },
    [extensionSignature, pluginBlockIdSignature]
  )

  useEffect(() => {
    syncEditorEditableState(editor, isEditable)
  }, [editor, isEditable])

  const currentTopLevelBlock =
    editor && currentBlockId
      ? findTopLevelBlockById(editor, currentBlockId)
      : null

  const currentColumnsBlock =
    currentTopLevelBlock && currentTopLevelBlock.node.type.name === "columns"
      ? currentTopLevelBlock
      : null

  const currentColumnsCount =
    currentColumnsBlock != null
      ? normalizeColumnsCount(currentColumnsBlock.node.attrs?.count)
      : null

  const currentBlockConvertType: ConvertibleTextBlockType | null = (() => {
    if (!currentTopLevelBlock) {
      return null
    }
    return resolveCurrentBlockConvertType(currentTopLevelBlock.node.toJSON() as JSONContent)
  })()

  const blockConvertTargetItems = useMemo<
    Array<{ type: ConvertibleTextBlockType; label: string }>
  >(() => {
    if (!currentBlockConvertType) {
      return []
    }
    return getConvertibleTargetTypes(currentBlockConvertType).map((type) => ({
      type,
      label: builtinBlockLabelMap.get(type) ?? type,
    }))
  }, [builtinBlockLabelMap, currentBlockConvertType])

  const blockBackgroundStyleState = useMemo(
    () => resolveBlockStyleSelectionState(editor, "backgroundColor"),
    [editor, blockActionMenuOpen, currentBlockId]
  )
  const blockTextStyleState = useMemo(
    () => resolveBlockStyleSelectionState(editor, "textColor"),
    [editor, blockActionMenuOpen, currentBlockId]
  )

  const closeBlockActionSubmenus = useCallback(() => {
    setBlockActionConvertMenuOpen(false)
    setBlockActionBackgroundMenuOpen(false)
    setBlockActionTextMenuOpen(false)
  }, [])

  const handleToggleBlockActionConvertMenu = useCallback(() => {
    setBlockActionConvertMenuOpen((prev) => {
      const next = !prev
      if (next) {
        setBlockActionBackgroundMenuOpen(false)
        setBlockActionTextMenuOpen(false)
      }
      return next
    })
  }, [])

  const handleToggleBlockActionBackgroundMenu = useCallback(() => {
    setBlockActionBackgroundMenuOpen((prev) => {
      const next = !prev
      if (next) {
        setBlockActionConvertMenuOpen(false)
        setBlockActionTextMenuOpen(false)
      }
      return next
    })
  }, [])

  const handleToggleBlockActionTextMenu = useCallback(() => {
    setBlockActionTextMenuOpen((prev) => {
      const next = !prev
      if (next) {
        setBlockActionConvertMenuOpen(false)
        setBlockActionBackgroundMenuOpen(false)
      }
      return next
    })
  }, [])

  useEffect(() => {
    onEditorReady?.(editor)
  }, [editor, onEditorReady])

  useEffect(() => {
    slashMenuOpenRef.current = slashMenuOpen
  }, [slashMenuOpen])

  useEffect(() => {
    return () => {
      if (slashShortcutCommitTimerRef.current != null) {
        window.clearTimeout(slashShortcutCommitTimerRef.current)
        slashShortcutCommitTimerRef.current = null
      }
    }
  }, [])

  const rect = useCursorVisibility({
    editor,
    overlayHeight: toolbarRef.current?.getBoundingClientRect().height ?? 0,
  })

  useEffect(() => {
    if (!isMobile && mobileView !== "main") {
      setMobileView("main")
    }
  }, [isMobile, mobileView])

  const clearPendingSlashShortcutCommit = useCallback(() => {
    if (slashShortcutCommitTimerRef.current != null) {
      window.clearTimeout(slashShortcutCommitTimerRef.current)
      slashShortcutCommitTimerRef.current = null
    }
  }, [])

  const readActiveSlashToken = useCallback((): {
    triggerPos: number
    selectionPos: number
    token: string
    shortcut: string
  } | null => {
    if (!editor) {
      return null
    }
    const triggerPos = slashTriggerPosRef.current
    if (triggerPos == null) {
      return null
    }
    const selection = editor.state.selection
    if (selection.from !== selection.to || selection.from < triggerPos + 1) {
      return null
    }
    const slashText = editor.state.doc.textBetween(triggerPos, triggerPos + 1, "\0", "\0")
    if (slashText !== "/") {
      return null
    }
    const token = editor.state.doc.textBetween(triggerPos, selection.from, "\0", "\0")
    if (!token.startsWith("/")) {
      return null
    }
    return {
      triggerPos,
      selectionPos: selection.from,
      token,
      shortcut: token.slice(1),
    }
  }, [editor])

  const closeSlashMenu = useCallback(() => {
    clearPendingSlashShortcutCommit()
    pendingSlashMenuOpenRef.current = false
    slashTriggerPosRef.current = null
    setSlashMenuQuery("")
    setSlashMenuOpen(false)
  }, [clearPendingSlashShortcutCommit])

  const handleColumnsConfigCountChange = useCallback((nextRaw: string) => {
    setColumnsConfigCount(normalizeColumnsCount(nextRaw))
  }, [])

  const openSlashMenuNearCursor = useCallback(() => {
    if (!editor) {
      return
    }
    const triggerPos = slashTriggerPosRef.current
    if (triggerPos == null) {
      return
    }
    const triggerText = editor.state.doc.textBetween(triggerPos, triggerPos + 1, "\0", "\0")
    if (triggerText !== "/") {
      closeSlashMenu()
      return
    }

    const shell = editorShellRef.current
    const contentEl = shell?.querySelector(".doc-editor-content") as HTMLElement | null
    if (!shell || !contentEl) {
      return
    }

    try {
      const coords = editor.view.coordsAtPos(editor.state.selection.from)
      const shellRect = shell.getBoundingClientRect()
      const leftRaw = coords.left - shellRect.left
      const topRaw = coords.bottom - shellRect.top
      const placement = resolveFloatingMenuPlacement({
        anchorX: leftRaw,
        anchorY: topRaw,
        menuWidth: 236,
        menuHeight: estimateBlockMenuHeight(slashMenuItems.length),
        viewportLeft: 0,
        viewportTop: 0,
        viewportWidth: shell.clientWidth,
        viewportHeight: shell.clientHeight,
        offsetX: 0,
        offsetY: 6,
        margin: 8,
      })
      setSlashMenuPosition({
        top: placement.top,
        left: placement.left,
      })
      const tokenInfo = readActiveSlashToken()
      setSlashMenuQuery(tokenInfo?.shortcut ?? "")
      setBlockAddMenuOpen(false)
      setBlockActionMenuOpen(false)
      closeBlockActionSubmenus()
      setSlashMenuHighlightIndex(0)
      setSlashMenuOpen(true)
    } catch {
      closeSlashMenu()
    }
  }, [
    closeBlockActionSubmenus,
    closeSlashMenu,
    editor,
    readActiveSlashToken,
    slashMenuItems.length,
  ])

  const updateBlockAddMenuPosition = useCallback((force = false) => {
    if ((!blockAddMenuOpen && !force) || draggingBlockId) {
      return
    }
    const shell = editorShellRef.current
    const contentEl = shell?.querySelector(".doc-editor-content") as HTMLElement | null
    const container = blockAddContainerRef.current
    if (!shell || !contentEl || !container) {
      return
    }

    const shellRect = shell.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const anchorX = containerRect.right - shellRect.left + contentEl.scrollLeft
    const anchorY = containerRect.top - shellRect.top + contentEl.scrollTop + containerRect.height / 2
    const placement = resolveFloatingMenuPlacement({
      anchorX,
      anchorY,
      menuWidth: 236,
      menuHeight: estimateBlockMenuHeight(blockMenuItems.length),
      viewportLeft: contentEl.scrollLeft,
      viewportTop: contentEl.scrollTop,
      viewportWidth: shell.clientWidth,
      viewportHeight: shell.clientHeight,
      offsetX: 6,
      offsetY: 16,
      margin: 8,
    })

    const containerOriginLeft = containerRect.left - shellRect.left + contentEl.scrollLeft
    const containerOriginTop = containerRect.top - shellRect.top + contentEl.scrollTop
    setBlockAddMenuPosition({
      left: placement.left - containerOriginLeft,
      top: placement.top - containerOriginTop,
    })
  }, [blockAddMenuOpen, blockMenuItems.length, draggingBlockId])

  const removeSlashTriggerCharacter = useCallback(() => {
    if (!editor) {
      return
    }
    const triggerPos = slashTriggerPosRef.current
    if (triggerPos == null) {
      return
    }
    const selection = editor.state.selection
    if (selection.from !== selection.to || selection.from < triggerPos + 1) {
      return
    }
    const triggerText = editor.state.doc.textBetween(triggerPos, triggerPos + 1, "\0", "\0")
    if (triggerText !== "/") {
      return
    }
    const tr = editor.state.tr.delete(triggerPos, selection.from)
    editor.view.dispatch(tr)
  }, [editor])

  const syncBlockHandleToBlock = useCallback((block: TopLevelBlock | null): boolean => {
    if (!editor || !desktopHandleEnabled || !block) {
      if (!block) {
        setCurrentBlockId(null)
      }
      return false
    }
    const shell = editorShellRef.current
    if (!shell) {
      return false
    }
    const contentEl = shell.querySelector(".doc-editor-content") as HTMLElement | null
    if (!contentEl) {
      return false
    }
    try {
      const topCoords = editor.view.coordsAtPos(block.pos)
      const bottomCoords = editor.view.coordsAtPos(Math.max(block.pos, block.endPos - 1))
      const shellRect = shell.getBoundingClientRect()
      const centerY = (topCoords.top + bottomCoords.bottom) / 2
      const top = centerY - shellRect.top + contentEl.scrollTop
      setCurrentBlockId(block.id)
      setBlockHandleTop(Math.max(12, top))
      return true
    } catch {
      // Ignore transient selection position errors.
      return false
    }
  }, [desktopHandleEnabled, editor])

  const resolveHoveredBlockForClientY = useCallback((clientY: number): TopLevelBlock | null => {
    if (!editor || !desktopHandleEnabled) {
      return null
    }
    const blocks = getTopLevelBlocks(editor)
    if (blocks.length === 0) {
      return null
    }
    const ranges = blocks.flatMap((block) => {
      try {
        const topCoords = editor.view.coordsAtPos(block.pos)
        const bottomCoords = editor.view.coordsAtPos(Math.max(block.pos, block.endPos - 1))
        return [{ id: block.id, top: topCoords.top, bottom: bottomCoords.bottom }]
      } catch {
        return []
      }
    })
    const hoveredBlockId = resolveHoveredBlockId(ranges, clientY)
    if (!hoveredBlockId) {
      return null
    }
    return blocks.find((block) => block.id === hoveredBlockId) ?? null
  }, [desktopHandleEnabled, editor])

  const updateBlockHandleFromClientY = useCallback((clientY: number): boolean => {
    const hoveredBlock = resolveHoveredBlockForClientY(clientY)
    if (!hoveredBlock) {
      setCurrentBlockId(null)
      return false
    }
    return syncBlockHandleToBlock(hoveredBlock)
  }, [resolveHoveredBlockForClientY, syncBlockHandleToBlock])

  const updateBlockHandlePosition = useCallback(() => {
    if (!editor || !desktopHandleEnabled) {
      return
    }
    const hoveredBlockId =
      hoverClientYRef.current != null && blockControlsVisible
        ? resolveHoveredBlockForClientY(hoverClientYRef.current)?.id ?? null
        : null
    const selectionBlockId = findCurrentTopLevelBlock(editor)?.id ?? null
    const anchorBlockId = resolveHandleAnchorBlockId({
      draggingBlockId,
      hoveredBlockId,
      selectionBlockId,
      controlsVisible: blockControlsVisible,
    })
    if (!anchorBlockId) {
      setCurrentBlockId(null)
      return
    }
    const anchorBlock = findTopLevelBlockById(editor, anchorBlockId)
    syncBlockHandleToBlock(anchorBlock)
  }, [blockControlsVisible, desktopHandleEnabled, draggingBlockId, editor, resolveHoveredBlockForClientY, syncBlockHandleToBlock])

  const handleApplyBlockColorStyle = useCallback(
    (attrName: BlockStyleAttrName, value: string | null) => {
      if (!editor) {
        return
      }
      const command = editor.chain().focus()
      const success =
        attrName === "backgroundColor"
          ? value
            ? command.setNodeBackgroundColor(value).run()
            : command.unsetNodeBackgroundColor().run()
          : value
            ? command.setNodeTextColor(value).run()
            : command.unsetNodeTextColor().run()

      if (!success) {
        return
      }
      closeBlockActionSubmenus()
      setBlockActionMenuOpen(false)
      setBlockAddMenuOpen(false)
      closeSlashMenu()
      updateBlockHandlePosition()
    },
    [closeBlockActionSubmenus, closeSlashMenu, editor, updateBlockHandlePosition]
  )

  const insertBuiltinBlockFromHandle = useCallback(
    (type: BuiltinBlockType, options?: { columns?: BuiltinColumnsLayout }) => {
      if (!editor) {
        return
      }
      const anchorBlock =
        (currentBlockId ? findTopLevelBlockById(editor, currentBlockId) : null) ??
        findCurrentTopLevelBlock(editor)
      const insertPos = anchorBlock ? anchorBlock.endPos : editor.state.selection.to
      const inserted = insertStandaloneBuiltinBlockAtPos(editor, type, insertPos, options)
      if (!inserted) {
        insertBuiltinBlock(editor, type, options)
      }
    },
    [currentBlockId, editor]
  )

  const insertBuiltinBlockFromSlash = useCallback(
    (type: BuiltinBlockType, options?: { columns?: BuiltinColumnsLayout }) => {
      if (!editor) {
        return
      }
      const currentBlock = findCurrentTopLevelBlock(editor)
      if (currentBlock) {
        const currentNode = editor.state.doc.nodeAt(currentBlock.pos)
        const shouldReplaceCurrentParagraph =
          currentNode?.type.name === "paragraph" && currentNode.content.size === 0
        if (shouldReplaceCurrentParagraph) {
          const replaced = replaceRangeWithStandaloneBuiltinBlock(
            editor,
            type,
            currentBlock.pos,
            currentBlock.endPos,
            options,
          )
          if (replaced) {
            return
          }
        }
      }
      insertBuiltinBlock(editor, type, options)
    },
    [editor]
  )

  const findBuiltinMenuItem = useCallback(
    (type: BuiltinBlockType): BlockMenuItem | null =>
      blockMenuItems.find(
        (item) => item.kind === "builtin" && item.id === type
      ) ?? null,
    [blockMenuItems]
  )

  const openColumnsConfigDialog = useCallback(
    (source: "block" | "slash") => {
      columnsConfigSourceRef.current = source
      setColumnsConfigCount(2)
      setColumnsConfigOpen(true)
      setBlockAddMenuOpen(false)
      setBlockActionMenuOpen(false)
      closeBlockActionSubmenus()
      closeSlashMenu()
      setBlockControlsVisible(true)
    },
    [closeBlockActionSubmenus, closeSlashMenu]
  )

  const closeColumnsConfigDialog = useCallback(() => {
    setColumnsConfigOpen(false)
  }, [])

  const confirmColumnsConfigInsert = useCallback(() => {
    const source = columnsConfigSourceRef.current
    const count = normalizeColumnsCount(columnsConfigCount)

    if (source === "block") {
      insertBuiltinBlockFromHandle("columns", {
        columns: { count },
      })
    } else {
      insertBuiltinBlockFromSlash("columns", {
        columns: { count },
      })
    }

    setColumnsConfigOpen(false)
    updateBlockHandlePosition()
  }, [
    columnsConfigCount,
    insertBuiltinBlockFromHandle,
    insertBuiltinBlockFromSlash,
    updateBlockHandlePosition,
  ])

  const selectBlockMenuItem = useCallback(
    (item: BlockMenuItem, source: "block" | "slash") => {
      if (!editor) {
        return
      }

      if (item.kind === "builtin") {
        if (item.id === "columns") {
          if (source === "slash") {
            removeSlashTriggerCharacter()
          }
          openColumnsConfigDialog(source)
          return
        }
        if (source === "block") {
          insertBuiltinBlockFromHandle(item.id)
        } else {
          removeSlashTriggerCharacter()
          insertBuiltinBlockFromSlash(item.id)
        }
      } else {
        if (source === "slash") {
          removeSlashTriggerCharacter()
        }
        const pluginAction = pluginBlockActionMap.get(item.id)
        if (pluginAction) {
          tryInsertPluginBlock(editor, pluginAction)
        }
      }

      setBlockAddMenuOpen(false)
      setBlockActionMenuOpen(false)
      closeBlockActionSubmenus()
      closeSlashMenu()
      updateBlockHandlePosition()
    },
    [
      closeBlockActionSubmenus,
      closeSlashMenu,
      editor,
      insertBuiltinBlockFromHandle,
      insertBuiltinBlockFromSlash,
      openColumnsConfigDialog,
      pluginBlockActionMap,
      removeSlashTriggerCharacter,
      updateBlockHandlePosition,
    ]
  )

  const applyInlineSlashShortcut = useCallback(
    (tokenInfo: { triggerPos: number; selectionPos: number }, type: BuiltinBlockType) => {
      if (!editor) {
        return
      }
      applyingInlineSlashShortcutRef.current = true
      try {
        editor.view.dispatch(editor.state.tr.delete(tokenInfo.triggerPos, tokenInfo.selectionPos))
        if (type === "columns") {
          openColumnsConfigDialog("slash")
          return
        }
        insertBuiltinBlockFromSlash(type)
        closeSlashMenu()
        setBlockAddMenuOpen(false)
        setBlockActionMenuOpen(false)
        closeBlockActionSubmenus()
        updateBlockHandlePosition()
      } finally {
        applyingInlineSlashShortcutRef.current = false
      }
    },
    [
      closeBlockActionSubmenus,
      closeSlashMenu,
      editor,
      insertBuiltinBlockFromSlash,
      openColumnsConfigDialog,
      updateBlockHandlePosition,
    ]
  )

  useEffect(() => {
    if (!editor || !isEditable) {
      closeSlashMenu()
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) {
        return
      }
      if (columnsConfigOpen) {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          closeColumnsConfigDialog()
          return
        }
        if (event.key === "Enter") {
          event.preventDefault()
          event.stopPropagation()
          confirmColumnsConfigInsert()
          return
        }
      }

      const target = event.target as HTMLElement | null
      const inEditorContent = Boolean(
        target?.closest(".doc-editor-content .tiptap.ProseMirror")
      )

      if (
        inEditorContent &&
        desktopHandleEnabled &&
        !draggingBlockId &&
        currentBlockId &&
        isBlockActionMenuShortcut({
          key: event.key,
          code: event.code,
          metaKey: event.metaKey,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
        })
      ) {
        event.preventDefault()
        event.stopPropagation()
        closeSlashMenu()
        setBlockAddMenuOpen(false)
        setBlockActionMenuOpen((prev) => !prev)
        closeBlockActionSubmenus()
        setBlockControlsVisible(true)
        updateBlockHandlePosition()
        return
      }

      const menuOpen = (blockAddMenuOpen || slashMenuOpenRef.current) && !draggingBlockId
      if (menuOpen) {
        if (blockAddMenuOpen) {
          const mappedShortcutType =
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.shiftKey &&
            event.key.length >= 1
              ? resolvedBlockShortcuts.keyToBlockMap[event.key]
              : undefined
          if (mappedShortcutType) {
            event.preventDefault()
            event.stopPropagation()
            const mappedItem = findBuiltinMenuItem(mappedShortcutType)
            if (mappedItem) {
              selectBlockMenuItem(mappedItem, "block")
            }
            return
          }
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          event.stopPropagation()
          if (!blockAddMenuOpen) {
            clearPendingSlashShortcutCommit()
          }
          const direction = event.key === "ArrowDown" ? "down" : "up"
          if (blockAddMenuOpen) {
            setBlockMenuHighlightIndex((prev) =>
              moveMenuHighlightIndex({
                current: prev,
                total: blockMenuItems.length,
                direction,
              })
            )
          } else {
            setSlashMenuHighlightIndex((prev) =>
              moveMenuHighlightIndex({
                current: prev,
                total: slashMenuItems.length,
                direction,
              })
            )
          }
          return
        }
        if (event.key === "Enter") {
          event.preventDefault()
          event.stopPropagation()
          if (!blockAddMenuOpen) {
            clearPendingSlashShortcutCommit()
          }
          const activeIndex = blockAddMenuOpen ? blockMenuHighlightIndex : slashMenuHighlightIndex
          const currentItems = blockAddMenuOpen ? blockMenuItems : slashMenuItems
          const item = currentItems[activeIndex] ?? currentItems[0]
          if (item) {
            selectBlockMenuItem(item, blockAddMenuOpen ? "block" : "slash")
          }
          return
        }
      }

      if (event.key === "Escape" && slashMenuOpenRef.current) {
        event.preventDefault()
        event.stopPropagation()
        closeSlashMenu()
        return
      }
      if (event.key === "Escape" && blockAddMenuOpen) {
        event.preventDefault()
        event.stopPropagation()
        setBlockAddMenuOpen(false)
        return
      }
      if (event.key === "Escape" && blockActionMenuOpen) {
        event.preventDefault()
        event.stopPropagation()
        setBlockActionMenuOpen(false)
        closeBlockActionSubmenus()
        return
      }

      if (!inEditorContent) {
        return
      }
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        pendingSlashMenuOpenRef.current = true
        slashTriggerPosRef.current = editor.state.selection.from
        return
      }
    }

    const shell = editorShellRef.current
    if (!shell) {
      return
    }
    shell.addEventListener("keydown", handleKeyDown, true)
    return () => {
      shell.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [blockActionMenuOpen, blockAddMenuOpen, blockMenuHighlightIndex, blockMenuItems, clearPendingSlashShortcutCommit, closeBlockActionSubmenus, closeColumnsConfigDialog, closeSlashMenu, columnsConfigOpen, confirmColumnsConfigInsert, currentBlockId, desktopHandleEnabled, draggingBlockId, editor, findBuiltinMenuItem, isEditable, resolvedBlockShortcuts.keyToBlockMap, selectBlockMenuItem, slashMenuHighlightIndex, slashMenuItems, updateBlockHandlePosition])

  useEffect(() => {
    if (slashMenuHighlightIndex < slashMenuItems.length) {
      return
    }
    setSlashMenuHighlightIndex(0)
  }, [slashMenuHighlightIndex, slashMenuItems.length])

  useEffect(() => {
    if (!blockAddMenuOpen || draggingBlockId) {
      return
    }
    updateBlockAddMenuPosition()
    const shell = editorShellRef.current
    const contentEl = shell?.querySelector(".doc-editor-content") as HTMLElement | null
    if (!contentEl) {
      return
    }
    const handleLayout = () => {
      updateBlockAddMenuPosition()
    }
    contentEl.addEventListener("scroll", handleLayout, { passive: true })
    window.addEventListener("resize", handleLayout)
    return () => {
      contentEl.removeEventListener("scroll", handleLayout)
      window.removeEventListener("resize", handleLayout)
    }
  }, [blockAddMenuOpen, currentBlockId, draggingBlockId, blockHandleTop, updateBlockAddMenuPosition])

  const moveBlockRelative = useCallback(
    (
      sourceBlockId: string,
      targetBlockId: string,
      placement: DropPlacement
    ) => {
      if (!editor || sourceBlockId === targetBlockId) {
        return
      }

      const blocks = getTopLevelBlocks(editor)
      const source = blocks.find((block) => block.id === sourceBlockId)
      const target = blocks.find((block) => block.id === targetBlockId)
      if (!source || !target) {
        return
      }

      const sourceSlice = editor.state.doc.slice(source.pos, source.endPos)
      let tr = editor.state.tr.delete(source.pos, source.endPos)
      const blocksAfterDelete = extractTopLevelBlocks(tr.doc)
      const targetAfterDelete = blocksAfterDelete.find((block) => block.id === targetBlockId)
      if (!targetAfterDelete) {
        return
      }

      const insertPos =
        placement === "before"
          ? targetAfterDelete.pos
          : targetAfterDelete.endPos

      tr = tr.insert(insertPos, sourceSlice.content)
      editor.view.dispatch(tr)
    },
    [editor]
  )

  const handleDeleteCurrentBlock = useCallback(() => {
    if (!editor || !currentBlockId) {
      return
    }

    const blocks = getTopLevelBlocks(editor)
    const targetBlock = blocks.find((block) => block.id === currentBlockId)
    if (!targetBlock) {
      return
    }

    if (blocks.length <= 1) {
      editor.commands.setContent(defaultContent)
    } else {
      const tr = editor.state.tr.delete(targetBlock.pos, targetBlock.endPos)
      editor.view.dispatch(tr)
    }

    setBlockActionMenuOpen(false)
    closeBlockActionSubmenus()
    setBlockAddMenuOpen(false)
    closeSlashMenu()
    updateBlockHandlePosition()
  }, [
    closeBlockActionSubmenus,
    closeSlashMenu,
    currentBlockId,
    editor,
    updateBlockHandlePosition,
  ])

  const handleDuplicateCurrentBlock = useCallback(() => {
    if (!editor || !currentBlockId) {
      return
    }

    const sourceBlock = findTopLevelBlockById(editor, currentBlockId)
    if (!sourceBlock) {
      return
    }

    try {
      const sourceJson = sourceBlock.node.toJSON() as JSONContent
      const duplicatedJson = cloneBlockNodeForDuplicate(sourceJson)
      const duplicatedNode = editor.state.schema.nodeFromJSON(duplicatedJson)
      const tr = editor.state.tr.insert(sourceBlock.endPos, duplicatedNode)
      editor.view.dispatch(tr)
      editor.commands.focus()
    } catch (error) {
      console.warn("[doc-editor] duplicate block failed", error)
      return
    }

    setBlockActionMenuOpen(false)
    closeBlockActionSubmenus()
    setBlockAddMenuOpen(false)
    closeSlashMenu()
    updateBlockHandlePosition()
  }, [
    closeBlockActionSubmenus,
    closeSlashMenu,
    currentBlockId,
    editor,
    updateBlockHandlePosition,
  ])

  const handleConvertCurrentBlock = useCallback(
    (targetType: ConvertibleTextBlockType) => {
      if (!editor || !currentBlockId) {
        return
      }

      const sourceBlock = findTopLevelBlockById(editor, currentBlockId)
      if (!sourceBlock) {
        return
      }

      const sourceNodeJson = sourceBlock.node.toJSON() as JSONContent
      const convertedJson = convertTopLevelTextBlock({
        source: sourceNodeJson,
        targetType,
      })

      try {
        const convertedNode = editor.state.schema.nodeFromJSON(convertedJson)
        const tr = editor.state.tr.replaceWith(
          sourceBlock.pos,
          sourceBlock.endPos,
          convertedNode
        )
        editor.view.dispatch(tr)
        editor.commands.focus()
      } catch (error) {
        console.warn("[doc-editor] block conversion failed", error)
        return
      }

      setBlockActionMenuOpen(false)
      closeBlockActionSubmenus()
      setBlockAddMenuOpen(false)
      closeSlashMenu()
      updateBlockHandlePosition()
    },
    [
      closeBlockActionSubmenus,
      closeSlashMenu,
      currentBlockId,
      editor,
      updateBlockHandlePosition,
    ]
  )

  const handleSetCurrentColumnsCount = useCallback(
    (nextRaw: string) => {
      if (!editor || !currentColumnsBlock || currentColumnsCount == null) {
        return
      }
      const nextCount = normalizeColumnsCount(nextRaw)
      const currentWidths = normalizeColumnsWidths(
        currentColumnsBlock.node.attrs?.widths,
        currentColumnsCount
      )
      const nextWidths =
        nextCount === currentColumnsCount
          ? normalizeColumnsWidths(currentWidths, nextCount)
          : createDefaultColumnWidths(nextCount)
      editor.commands.setColumnsCount({
        pos: currentColumnsBlock.pos,
        count: nextCount,
        widths: nextWidths,
      })
      updateBlockHandlePosition()
    },
    [currentColumnsBlock, currentColumnsCount, editor, updateBlockHandlePosition]
  )

  const resolveDropTarget = useCallback(
    (clientY: number): { blockId: string; placement: DropPlacement; indicatorTop: number } | null => {
      if (!editor) {
        return null
      }

      const blocks = getTopLevelBlocks(editor)
      if (blocks.length === 0) {
        return null
      }

      const ranges = blocks.flatMap((block) => {
        try {
          const topCoords = editor.view.coordsAtPos(block.pos)
          const bottomCoords = editor.view.coordsAtPos(Math.max(block.pos, block.endPos - 1))
          return [{ id: block.id, top: topCoords.top, bottom: bottomCoords.bottom }]
        } catch {
          return []
        }
      })
      return resolveNormalizedDropTarget(ranges, clientY)
    },
    [editor]
  )

  const handleDragHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!editor || !currentBlockId) {
        return
      }
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      const wasActionMenuOpen = blockActionMenuOpen
      const pointerStartX = event.clientX
      const pointerStartY = event.clientY
      let dragging = false
      const sourceBlockId = currentBlockId
      const DRAG_START_DISTANCE = 4
      setBlockAddMenuOpen(false)
      setBlockActionMenuOpen(false)
      closeBlockActionSubmenus()
      closeSlashMenu()

      const shell = editorShellRef.current
      const contentEl = shell?.querySelector(".doc-editor-content") as HTMLElement | null

      const updateDropIndicator = (clientY: number) => {
        const drop = resolveDropTarget(clientY)
        if (!drop || drop.blockId === dragSourceIdRef.current) {
          dragDropTargetRef.current = null
          setDropIndicatorTop(null)
          return
        }
        dragDropTargetRef.current = {
          blockId: drop.blockId,
          placement: drop.placement,
        }
        if (!shell || !contentEl) {
          return
        }
        const shellRect = shell.getBoundingClientRect()
        const top = drop.indicatorTop - shellRect.top + contentEl.scrollTop
        setDropIndicatorTop(top)
      }

      const startDragging = (clientY: number) => {
        if (dragging) {
          return
        }
        dragging = true
        dragSourceIdRef.current = sourceBlockId
        dragDropTargetRef.current = null
        setDraggingBlockId(sourceBlockId)
        setDropIndicatorTop(null)
        updateDropIndicator(clientY)
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (!dragging) {
          const deltaX = Math.abs(moveEvent.clientX - pointerStartX)
          const deltaY = Math.abs(moveEvent.clientY - pointerStartY)
          if (Math.max(deltaX, deltaY) < DRAG_START_DISTANCE) {
            return
          }
          startDragging(moveEvent.clientY)
        }
        if (!dragging) {
          return
        }
        moveEvent.preventDefault()
        updateDropIndicator(moveEvent.clientY)
      }

      const cleanupListeners = () => {
        document.removeEventListener("pointermove", handlePointerMove)
        document.removeEventListener("pointerup", handlePointerUp)
        document.removeEventListener("pointercancel", handlePointerCancel)
      }

      const handlePointerUp = () => {
        cleanupListeners()

        if (!dragging) {
          setBlockActionMenuOpen(!wasActionMenuOpen)
          closeBlockActionSubmenus()
          updateBlockHandlePosition()
          return
        }

        const sourceBlockId = dragSourceIdRef.current
        const dropTarget = dragDropTargetRef.current
        if (sourceBlockId && dropTarget && dropTarget.blockId !== sourceBlockId) {
          moveBlockRelative(sourceBlockId, dropTarget.blockId, dropTarget.placement)
        }
        dragSourceIdRef.current = null
        dragDropTargetRef.current = null
        setDraggingBlockId(null)
        setDropIndicatorTop(null)
        updateBlockHandlePosition()
      }

      const handlePointerCancel = () => {
        cleanupListeners()
        if (!dragging) {
          return
        }
        dragSourceIdRef.current = null
        dragDropTargetRef.current = null
        setDraggingBlockId(null)
        setDropIndicatorTop(null)
        updateBlockHandlePosition()
      }

      document.addEventListener("pointermove", handlePointerMove)
      document.addEventListener("pointerup", handlePointerUp)
      document.addEventListener("pointercancel", handlePointerCancel)
    },
    [blockActionMenuOpen, closeBlockActionSubmenus, closeSlashMenu, currentBlockId, editor, moveBlockRelative, resolveDropTarget, updateBlockHandlePosition]
  )

  const handleInsertBlockFromHandleMenu = useCallback(
    (item: BlockMenuItem) => {
      selectBlockMenuItem(item, "block")
    },
    [selectBlockMenuItem]
  )

  const handleInsertBlockFromSlashMenu = useCallback(
    (item: BlockMenuItem) => {
      selectBlockMenuItem(item, "slash")
    },
    [selectBlockMenuItem]
  )

  const handleControlsPointerLeave = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as HTMLElement | null
    const movingToEditorContent = Boolean(nextTarget?.closest(".doc-editor-content .tiptap.ProseMirror"))
    if (
      !shouldHideControlsOnPointerExit({
        dragging: Boolean(draggingBlockId),
        menuOpen: blockAddMenuOpen || blockActionMenuOpen,
        movingIntoControls: movingToEditorContent,
      })
    ) {
      return
    }
    setBlockControlsVisible(false)
    hoverClientYRef.current = null
  }, [blockActionMenuOpen, blockAddMenuOpen, draggingBlockId])

  useEffect(() => {
    if (!editor || !desktopHandleEnabled) {
      setBlockAddMenuOpen(false)
      setBlockActionMenuOpen(false)
      closeBlockActionSubmenus()
      setColumnsConfigOpen(false)
      setBlockControlsVisible(false)
      return
    }
    updateBlockHandlePosition()
    editor.on("selectionUpdate", updateBlockHandlePosition)
    editor.on("update", updateBlockHandlePosition)
    const shell = editorShellRef.current
    const contentEl = shell?.querySelector(".doc-editor-content") as HTMLElement | null
    contentEl?.addEventListener("scroll", updateBlockHandlePosition, { passive: true })
    return () => {
      editor.off("selectionUpdate", updateBlockHandlePosition)
      editor.off("update", updateBlockHandlePosition)
      contentEl?.removeEventListener("scroll", updateBlockHandlePosition)
    }
  }, [closeBlockActionSubmenus, desktopHandleEnabled, editor, updateBlockHandlePosition])

  useEffect(() => {
    if (!editor || !desktopHandleEnabled) {
      setBlockControlsVisible(false)
      hoverClientYRef.current = null
      return
    }
    const shell = editorShellRef.current
    const contentEl = shell?.querySelector(".doc-editor-content") as HTMLElement | null
    if (!contentEl || !shell) {
      return
    }
    const shellStyle = window.getComputedStyle(shell)
    const railLeft = parseCssPx(shellStyle.getPropertyValue("--doc-editor-rail-left"), 4)
    const railButtonSize = parseCssPx(shellStyle.getPropertyValue("--doc-editor-rail-button-size"), 26)
    const railGap = parseCssPx(shellStyle.getPropertyValue("--doc-editor-rail-gap"), 0)

    const handlePointerMove = (event: PointerEvent) => {
      if (draggingBlockId) {
        return
      }
      const shellRect = shell.getBoundingClientRect()
      const relativeX = event.clientX - shellRect.left
      if (!isPointerInLeftRail({ relativeX, railLeft, railButtonSize, railGap })) {
        setBlockControlsVisible(false)
        hoverClientYRef.current = null
        return
      }
      hoverClientYRef.current = event.clientY
      const hovered = updateBlockHandleFromClientY(event.clientY)
      setBlockControlsVisible(hovered)
    }

    const handlePointerLeave = (event: PointerEvent) => {
      const nextTarget = event.relatedTarget as Node | null
      const movingIntoControls = Boolean(
        nextTarget && blockAddContainerRef.current?.contains(nextTarget)
      )
      if (
        !shouldHideControlsOnPointerExit({
          dragging: Boolean(draggingBlockId),
          menuOpen: blockAddMenuOpen || blockActionMenuOpen,
          movingIntoControls,
        })
      ) {
        return
      }
      setBlockControlsVisible(false)
      hoverClientYRef.current = null
    }

    contentEl.addEventListener("pointermove", handlePointerMove, { passive: true })
    contentEl.addEventListener("pointerleave", handlePointerLeave)
    return () => {
      contentEl.removeEventListener("pointermove", handlePointerMove)
      contentEl.removeEventListener("pointerleave", handlePointerLeave)
    }
  }, [blockActionMenuOpen, blockAddMenuOpen, desktopHandleEnabled, draggingBlockId, editor, updateBlockHandleFromClientY])

  useEffect(() => {
    if (!desktopHandleEnabled || (!blockAddMenuOpen && !blockActionMenuOpen)) {
      return
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (blockAddContainerRef.current?.contains(target)) {
        return
      }
      setBlockAddMenuOpen(false)
      setBlockActionMenuOpen(false)
      closeBlockActionSubmenus()
    }
    document.addEventListener("mousedown", handlePointerDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
    }
  }, [blockActionMenuOpen, blockAddMenuOpen, closeBlockActionSubmenus, desktopHandleEnabled])

  useEffect(() => {
    if (!slashMenuOpen) {
      return
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest(".doc-editor-slash-menu")) {
        return
      }
      closeSlashMenu()
    }
    document.addEventListener("mousedown", handlePointerDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
    }
  }, [closeSlashMenu, slashMenuOpen])

  useEffect(() => {
    if (!editor || !isEditable) {
      return
    }
    const handleUpdate = () => {
      const nextContent = editor.getJSON()
      const serialized = JSON.stringify(nextContent)
      const keyToBlockMap = resolvedBlockShortcuts.keyToBlockMap
      const view = editor.view as { composing?: boolean }

      if (slashMenuOpenRef.current) {
        const tokenInfo = readActiveSlashToken()
        if (!tokenInfo) {
          closeSlashMenu()
        } else {
          setSlashMenuQuery(tokenInfo.shortcut)
        }
      }

      if (pendingSlashMenuOpenRef.current) {
        pendingSlashMenuOpenRef.current = false
        openSlashMenuNearCursor()
      }

      if (!applyingInlineSlashShortcutRef.current) {
        const tokenInfo = readActiveSlashToken()
        if (
          tokenInfo &&
          Object.keys(keyToBlockMap).length > 0 &&
          !view.composing
        ) {
          const slashShortcutType = matchSlashShortcutToken({
            token: tokenInfo.token,
            keyToBlockMap,
          })
          if (slashShortcutType) {
            const hasLongerPrefix = hasLongerShortcutPrefix({
              shortcut: tokenInfo.shortcut,
              keyToBlockMap,
            })
            if (hasLongerPrefix) {
              clearPendingSlashShortcutCommit()
              const tokenSnapshot = tokenInfo.token
              slashShortcutCommitTimerRef.current = window.setTimeout(() => {
                if (!editor || editor.isDestroyed) {
                  return
                }
                const latestTokenInfo = readActiveSlashToken()
                if (!latestTokenInfo || latestTokenInfo.token !== tokenSnapshot) {
                  return
                }
                const latestShortcutType = matchSlashShortcutToken({
                  token: latestTokenInfo.token,
                  keyToBlockMap,
                })
                if (latestShortcutType) {
                  applyInlineSlashShortcut(latestTokenInfo, latestShortcutType)
                }
              }, 180)
              // Keep normal update flow for slash query filtering while waiting for disambiguation.
            } else {
              clearPendingSlashShortcutCommit()
              applyInlineSlashShortcut(tokenInfo, slashShortcutType)
              return
            }
          } else {
            clearPendingSlashShortcutCommit()
          }
        } else {
          clearPendingSlashShortcutCommit()
        }
      }

      if (serialized === lastContentRef.current) {
        return
      }
      lastContentRef.current = serialized
      onChange?.(nextContent)
    }
    handleUpdate()
    editor.on("update", handleUpdate)
    return () => {
      editor.off("update", handleUpdate)
    }
  }, [applyInlineSlashShortcut, clearPendingSlashShortcutCommit, closeSlashMenu, editor, isEditable, onChange, openSlashMenuNearCursor, readActiveSlashToken, resolvedBlockShortcuts.keyToBlockMap])

  useEffect(() => {
    if (!editor || !content) {
      return
    }
    let cancelled = false

    const nextContent = ensureBlockIds(
      normalizeUnsupportedPluginBlocks(content, {
        knownNodeTypes: knownExtensionNodeTypes,
      }),
      { extraNodeTypes: pluginBlockIdTypes }
    )
    const serialized = JSON.stringify(nextContent)
    const editorSerialized = JSON.stringify(editor.getJSON())
    if (
      !shouldApplyIncomingContentSync({
        incomingSerialized: serialized,
        lastSerialized: lastContentRef.current,
        editorSerialized,
        editorHasFocus: Boolean(editor.isFocused),
      })
    ) {
      if (serialized === editorSerialized) {
        lastContentRef.current = serialized
      }
      return
    }

    scheduleMicrotask(() => {
      if (cancelled || editor.isDestroyed) {
        return
      }
      editor.commands.setContent(nextContent, { emitUpdate: false })
      lastContentRef.current = serialized
    })

    return () => {
      cancelled = true
    }
  }, [content, editor, extensionSignature, pluginBlockIdSignature])

  // Store onChange in a ref to avoid it as a dependency
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!editor || !docId || !onLoadDocument) {
      return
    }

    let isMounted = true
    const load = async () => {
      try {
        const loadedContent = await onLoadDocument(docId)
        if (isMounted && loadedContent) {
          const nextContent = ensureBlockIds(
            normalizeUnsupportedPluginBlocks(loadedContent, {
              knownNodeTypes: knownExtensionNodeTypes,
            }),
            { extraNodeTypes: pluginBlockIdTypes }
          )
          const serialized = JSON.stringify(nextContent)
          const editorSerialized = JSON.stringify(editor.getJSON())
          if (
            !shouldApplyIncomingContentSync({
              incomingSerialized: serialized,
              lastSerialized: lastContentRef.current,
              editorSerialized,
              editorHasFocus: Boolean(editor.isFocused),
            })
          ) {
            if (serialized === editorSerialized) {
              lastContentRef.current = serialized
            }
            return
          }

          scheduleMicrotask(() => {
            if (!isMounted || editor.isDestroyed) {
              return
            }
            editor.commands.setContent(nextContent, { emitUpdate: false })
            lastContentRef.current = serialized
            // Notify parent of the loaded content using ref
            onChangeRef.current?.(nextContent)
          })
        }
      } catch (error) {
        console.error("Failed to load document content:", error)
      }
    }
    load()

    return () => {
      isMounted = false
    }
  }, [docId, onLoadDocument, editor, extensionSignature, pluginBlockIdSignature])

  return (
    <div className="doc-editor-wrapper">
      <EditorContext.Provider value={{ editor }}>
        {isEditable && showTopToolbar ? (
          <Toolbar
            ref={toolbarRef}
            style={{
              ...(isMobile
                ? {
                    bottom: `calc(100% - ${height - rect.y}px)`,
                  }
                : {}),
            }}
          >
            {mobileView === "main" ? (
              <MainToolbarContent
                onHighlighterClick={() => setMobileView("highlighter")}
                isMobile={isMobile}
                editor={editor}
                pluginToolbarItems={pluginToolbarItems}
                pluginBlockGroups={pluginBlockGroups}
              />
            ) : (
              <MobileToolbarContent onBack={() => setMobileView("main")} />
            )}
          </Toolbar>
        ) : null}

        <div className="doc-editor-content-shell" ref={editorShellRef}>
          {desktopHandleEnabled && isEditable ? (
            <div
              className="doc-editor-block-add-container"
              ref={blockAddContainerRef}
              onPointerLeave={handleControlsPointerLeave}
              data-visible={blockControlsVisible || blockAddMenuOpen || blockActionMenuOpen || Boolean(draggingBlockId) ? "true" : "false"}
              style={{ top: `${Math.round(blockHandleTop)}px` }}
            >
              <button
                className={`doc-editor-block-add-trigger${blockAddMenuOpen ? " active" : ""}`}
                type="button"
                aria-label="插入块"
                disabled={!currentBlockId || Boolean(draggingBlockId)}
                onClick={() => {
                  closeSlashMenu()
                  setBlockActionMenuOpen(false)
                  closeBlockActionSubmenus()
                  setBlockAddMenuOpen((prev) => {
                    const next = !prev
                    if (next) {
                      setBlockMenuHighlightIndex(0)
                      scheduleMicrotask(() => {
                        updateBlockAddMenuPosition(true)
                      })
                    }
                    return next
                  })
                }}
              >
                +
              </button>
              <button
                className={`doc-editor-block-drag-trigger${draggingBlockId || blockActionMenuOpen ? " active" : ""}`}
                type="button"
                aria-label="移动块"
                disabled={!currentBlockId}
                onPointerDown={handleDragHandlePointerDown}
              >
                ⋮⋮
              </button>
              <BlockAddMenu
                open={blockAddMenuOpen && !draggingBlockId}
                onSelect={handleInsertBlockFromHandleMenu}
                items={blockMenuItems}
                highlightedIndex={blockMenuHighlightIndex}
                onHighlightIndexChange={setBlockMenuHighlightIndex}
                style={{
                  top: `${Math.round(blockAddMenuPosition.top)}px`,
                  left: `${Math.round(blockAddMenuPosition.left)}px`,
                }}
              />
              {blockActionMenuOpen && !draggingBlockId ? (
                <div className="doc-editor-block-action-menu" role="menu" aria-label="块菜单">
                  {blockConvertTargetItems.length > 0 ? (
                    <>
                      <button
                        className={
                          blockActionConvertMenuOpen
                            ? "doc-editor-block-action-menu-item active"
                            : "doc-editor-block-action-menu-item"
                        }
                        type="button"
                        role="menuitem"
                        aria-haspopup="menu"
                        aria-expanded={blockActionConvertMenuOpen}
                        onClick={handleToggleBlockActionConvertMenu}
                      >
                        <span className="doc-editor-block-action-menu-item-main">
                          <span>转换为</span>
                          <span className="doc-editor-block-action-menu-item-arrow" aria-hidden>
                            ›
                          </span>
                        </span>
                      </button>
                      {blockActionConvertMenuOpen ? (
                        <div className="doc-editor-block-action-menu-submenu" role="menu" aria-label="转换为">
                          {blockConvertTargetItems.map((item) => (
                            <button
                              key={`block-convert-target-${item.type}`}
                              className="doc-editor-block-action-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                handleConvertCurrentBlock(item.type)
                              }}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {currentColumnsCount != null ? (
                    <>
                      <div
                        className="doc-editor-block-action-menu-specific"
                        role="group"
                        aria-label="块专属设置"
                      >
                        <div className="doc-editor-block-action-menu-specific-title">
                          块专属设置
                        </div>
                        <label
                          className="doc-editor-block-action-menu-specific-row"
                          htmlFor="doc-editor-block-columns-count"
                        >
                          <span>列数（2-8）</span>
                          <input
                            id="doc-editor-block-columns-count"
                            className="doc-editor-block-action-menu-specific-input"
                            type="number"
                            min={2}
                            max={8}
                            step={1}
                            value={currentColumnsCount}
                            onChange={(event) => {
                              handleSetCurrentColumnsCount(event.target.value)
                            }}
                            onClick={(event) => {
                              event.stopPropagation()
                            }}
                          />
                        </label>
                      </div>
                      <div className="doc-editor-block-action-menu-divider" />
                    </>
                  ) : null}
                  <button
                    className={
                      blockActionBackgroundMenuOpen
                        ? "doc-editor-block-action-menu-item active"
                        : "doc-editor-block-action-menu-item"
                    }
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={blockActionBackgroundMenuOpen}
                    onClick={handleToggleBlockActionBackgroundMenu}
                  >
                    <span className="doc-editor-block-action-menu-item-main">
                      <span>
                        块背景色
                        {blockBackgroundStyleState.kind === "mixed"
                          ? "（混合）"
                          : ""}
                      </span>
                      <span
                        className="doc-editor-block-action-menu-item-arrow"
                        aria-hidden
                      >
                        ›
                      </span>
                    </span>
                  </button>
                  {blockActionBackgroundMenuOpen ? (
                    <div
                      className="doc-editor-block-action-menu-submenu"
                      role="menu"
                      aria-label="块背景色"
                    >
                      <div
                        className="doc-editor-block-action-menu-color-grid"
                        role="list"
                      >
                        {BLOCK_BACKGROUND_COLOR_OPTIONS.map((color) => {
                          const active =
                            blockBackgroundStyleState.kind === "single" &&
                            blockBackgroundStyleState.value === color.value
                          return (
                            <button
                              key={`block-background-color-${color.value}`}
                              className={`doc-editor-block-color-swatch${active ? " active" : ""}`}
                              type="button"
                              role="menuitem"
                              aria-label={color.label}
                              title={color.label}
                              onClick={() => {
                                handleApplyBlockColorStyle(
                                  "backgroundColor",
                                  color.value
                                )
                              }}
                            >
                              <span
                                className="doc-editor-block-color-swatch-fill"
                                style={{
                                  backgroundColor: color.value,
                                  borderColor:
                                    color.border ??
                                    "var(--tt-dropdown-menu-border-color)",
                                }}
                              />
                            </button>
                          )
                        })}
                      </div>
                      <button
                        className="doc-editor-block-action-menu-item"
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          handleApplyBlockColorStyle("backgroundColor", null)
                        }}
                      >
                        清除背景色
                      </button>
                    </div>
                  ) : null}
                  <button
                    className={
                      blockActionTextMenuOpen
                        ? "doc-editor-block-action-menu-item active"
                        : "doc-editor-block-action-menu-item"
                    }
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={blockActionTextMenuOpen}
                    onClick={handleToggleBlockActionTextMenu}
                  >
                    <span className="doc-editor-block-action-menu-item-main">
                      <span>
                        块文字色
                        {blockTextStyleState.kind === "mixed" ? "（混合）" : ""}
                      </span>
                      <span
                        className="doc-editor-block-action-menu-item-arrow"
                        aria-hidden
                      >
                        ›
                      </span>
                    </span>
                  </button>
                  {blockActionTextMenuOpen ? (
                    <div
                      className="doc-editor-block-action-menu-submenu"
                      role="menu"
                      aria-label="块文字色"
                    >
                      <div
                        className="doc-editor-block-action-menu-color-grid"
                        role="list"
                      >
                        {BLOCK_TEXT_COLOR_OPTIONS.map((color) => {
                          const active =
                            blockTextStyleState.kind === "single" &&
                            blockTextStyleState.value === color.value
                          return (
                            <button
                              key={`block-text-color-${color.value}`}
                              className={`doc-editor-block-color-swatch text${active ? " active" : ""}`}
                              type="button"
                              role="menuitem"
                              aria-label={color.label}
                              title={color.label}
                              onClick={() => {
                                handleApplyBlockColorStyle(
                                  "textColor",
                                  color.value
                                )
                              }}
                            >
                              <span
                                className="doc-editor-block-color-swatch-fill text"
                                style={{
                                  color: color.value,
                                  borderColor:
                                    color.border ??
                                    "var(--tt-dropdown-menu-border-color)",
                                }}
                              >
                                A
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      <button
                        className="doc-editor-block-action-menu-item"
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          handleApplyBlockColorStyle("textColor", null)
                        }}
                      >
                        清除文字色
                      </button>
                    </div>
                  ) : null}
                  <button
                    className="doc-editor-block-action-menu-item"
                    type="button"
                    role="menuitem"
                    onClick={handleDuplicateCurrentBlock}
                  >
                    创建副本
                  </button>
                  <div className="doc-editor-block-action-menu-divider" />
                  <button
                    className="doc-editor-block-action-menu-item danger"
                    type="button"
                    role="menuitem"
                    onClick={handleDeleteCurrentBlock}
                  >
                    删除块
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {columnsConfigOpen ? (
            <div
              className="doc-editor-columns-config-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closeColumnsConfigDialog()
                }
              }}
            >
              <div
                className="doc-editor-columns-config-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="多列块配置"
                onMouseDown={(event) => {
                  event.stopPropagation()
                }}
              >
                <div className="doc-editor-columns-config-title">多列块配置</div>
                <div className="doc-editor-columns-config-row">
                  <label
                    className="doc-editor-columns-config-label"
                    htmlFor="doc-editor-columns-config-count"
                  >
                    列数（2-8）
                  </label>
                  <input
                    id="doc-editor-columns-config-count"
                    className="doc-editor-columns-config-input"
                    type="number"
                    min={2}
                    max={8}
                    step={1}
                    value={columnsConfigCount}
                    onChange={(event) => {
                      handleColumnsConfigCountChange(event.target.value)
                    }}
                  />
                </div>
                <div className="doc-editor-columns-config-actions">
                  <button
                    type="button"
                    className="doc-editor-columns-config-btn secondary"
                    onClick={closeColumnsConfigDialog}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="doc-editor-columns-config-btn"
                    onClick={confirmColumnsConfigInsert}
                  >
                    插入多列块
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {isEditable ? (
            <BlockAddMenu
              open={slashMenuOpen && !draggingBlockId}
              onSelect={handleInsertBlockFromSlashMenu}
              items={slashMenuItems}
              className="doc-editor-slash-menu"
              highlightedIndex={slashMenuHighlightIndex}
              onHighlightIndexChange={setSlashMenuHighlightIndex}
              style={{
                top: `${Math.round(slashMenuPosition.top)}px`,
                left: `${Math.round(slashMenuPosition.left)}px`,
              }}
            />
          ) : null}
          {desktopHandleEnabled && dropIndicatorTop != null && draggingBlockId ? (
            <div
              className="doc-editor-block-drop-indicator"
              style={{ top: `${Math.round(dropIndicatorTop)}px` }}
            />
          ) : null}
          <EditorContent
            editor={editor}
            role="presentation"
            className="doc-editor-content"
          />
        </div>
      </EditorContext.Provider>
    </div>
  )
}
