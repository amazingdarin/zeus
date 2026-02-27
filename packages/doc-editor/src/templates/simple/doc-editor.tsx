"use client"

import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent, ReactNode, ReactElement } from "react"
import type { Editor, JSONContent } from "@tiptap/react"
import { EditorContent, EditorContext, useEditor } from "@tiptap/react"
import type { Extensions } from "@tiptap/core"

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
import { BlockAddMenu, getBuiltinBlockItems } from "../../ui/block-add-menu"
import {
  ColorHighlightPopover,
  ColorHighlightPopoverContent,
  ColorHighlightPopoverButton,
} from "../../ui/color-highlight-popover"
import { MarkButton } from "../../ui/mark-button"
import { TextAlignButton } from "../../ui/text-align-button"
import { UndoRedoButton } from "../../ui/undo-redo-button"

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
import { handleImageUpload, MAX_FILE_SIZE } from "../../lib/tiptap-utils"
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
import { HeadingCollapseExtension } from "../../extensions/HeadingCollapseExtension"
import {
  isPointerInLeftRail,
  moveMenuHighlightIndex,
  resolveHandleAnchorBlockId,
  resolveNormalizedDropTarget,
  shouldHideControlsOnPointerExit,
  isDesktopHandleEnabled,
  resolveHoveredBlockId,
  type BuiltinBlockType,
} from "../../extensions/block-add-handle"

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
}

type PluginBlockToolbarAction = {
  id: string
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
}

function getTopLevelBlocks(editor: Editor): TopLevelBlock[] {
  return extractTopLevelBlocks(editor.state.doc).map((block) => ({
    id: block.id,
    pos: block.pos,
    endPos: block.endPos,
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

const defaultContent: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
    },
  ],
}

function insertBuiltinBlock(editor: Editor, type: BuiltinBlockType): void {
  const chain = editor.chain().focus()
  switch (type) {
    case "paragraph":
      chain.setParagraph().run()
      return
    case "heading-1":
      chain.setHeading({ level: 1 }).run()
      return
    case "heading-2":
      chain.setHeading({ level: 2 }).run()
      return
    case "heading-3":
      chain.setHeading({ level: 3 }).run()
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
    case "image":
      chain.setImageUploadNode().run()
      return
    case "file":
      chain.insertFileBlock().run()
      return
    case "table":
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      return
    default:
      return
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
  const [blockMenuHighlightIndex, setBlockMenuHighlightIndex] = useState(0)
  const [blockControlsVisible, setBlockControlsVisible] = useState(false)
  const [blockHandleTop, setBlockHandleTop] = useState(16)
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null)
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null)
  const [dropIndicatorTop, setDropIndicatorTop] = useState<number | null>(null)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashMenuHighlightIndex, setSlashMenuHighlightIndex] = useState(0)
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 })
  const dragSourceIdRef = useRef<string | null>(null)
  const dragDropTargetRef = useRef<{ blockId: string; placement: DropPlacement } | null>(null)
  const pendingSlashMenuOpenRef = useRef(false)
  const slashTriggerPosRef = useRef<number | null>(null)
  const slashMenuOpenRef = useRef(false)
  const hoverClientYRef = useRef<number | null>(null)
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
  const builtinBlockItems = useMemo(() => getBuiltinBlockItems(), [])

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
        HeadingCollapseExtension,
        StarterKit.configure({
          horizontalRule: false,
          codeBlock: false,
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
    onEditorReady?.(editor)
  }, [editor, onEditorReady])

  useEffect(() => {
    slashMenuOpenRef.current = slashMenuOpen
  }, [slashMenuOpen])

  const rect = useCursorVisibility({
    editor,
    overlayHeight: toolbarRef.current?.getBoundingClientRect().height ?? 0,
  })

  useEffect(() => {
    if (!isMobile && mobileView !== "main") {
      setMobileView("main")
    }
  }, [isMobile, mobileView])

  const closeSlashMenu = useCallback(() => {
    pendingSlashMenuOpenRef.current = false
    slashTriggerPosRef.current = null
    setSlashMenuOpen(false)
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
      const menuWidth = 180
      const leftRaw = coords.left - shellRect.left + contentEl.scrollLeft
      const left = Math.max(8, Math.min(leftRaw, shell.clientWidth - menuWidth - 8))
      const top = coords.bottom - shellRect.top + contentEl.scrollTop + 6
      setSlashMenuPosition({
        top: Math.max(8, top),
        left,
      })
      setBlockAddMenuOpen(false)
      setSlashMenuHighlightIndex(0)
      setSlashMenuOpen(true)
    } catch {
      closeSlashMenu()
    }
  }, [closeSlashMenu, editor])

  const removeSlashTriggerCharacter = useCallback(() => {
    if (!editor) {
      return
    }
    const triggerPos = slashTriggerPosRef.current
    if (triggerPos == null) {
      return
    }
    const triggerText = editor.state.doc.textBetween(triggerPos, triggerPos + 1, "\0", "\0")
    if (triggerText !== "/") {
      return
    }
    const tr = editor.state.tr.delete(triggerPos, triggerPos + 1)
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

  const focusCurrentBlockForInsert = useCallback(() => {
    if (!editor || !currentBlockId) {
      return
    }
    const block = findTopLevelBlockById(editor, currentBlockId)
    if (!block) {
      return
    }
    try {
      editor.chain().focus(Math.max(block.pos, block.endPos - 1)).run()
    } catch {
      // Ignore transient focus errors.
    }
  }, [currentBlockId, editor])

  const selectBuiltinBlockFromMenu = useCallback(
    (type: BuiltinBlockType, source: "block" | "slash") => {
      if (!editor) {
        return
      }
      if (source === "block") {
        focusCurrentBlockForInsert()
      } else {
        removeSlashTriggerCharacter()
      }
      insertBuiltinBlock(editor, type)
      setBlockAddMenuOpen(false)
      closeSlashMenu()
      updateBlockHandlePosition()
    },
    [closeSlashMenu, editor, focusCurrentBlockForInsert, removeSlashTriggerCharacter, updateBlockHandlePosition]
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

      const menuOpen = (blockAddMenuOpen || slashMenuOpenRef.current) && !draggingBlockId
      if (menuOpen) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          event.stopPropagation()
          const direction = event.key === "ArrowDown" ? "down" : "up"
          if (blockAddMenuOpen) {
            setBlockMenuHighlightIndex((prev) =>
              moveMenuHighlightIndex({
                current: prev,
                total: builtinBlockItems.length,
                direction,
              })
            )
          } else {
            setSlashMenuHighlightIndex((prev) =>
              moveMenuHighlightIndex({
                current: prev,
                total: builtinBlockItems.length,
                direction,
              })
            )
          }
          return
        }
        if (event.key === "Enter") {
          event.preventDefault()
          event.stopPropagation()
          const activeIndex = blockAddMenuOpen ? blockMenuHighlightIndex : slashMenuHighlightIndex
          const item = builtinBlockItems[activeIndex] ?? builtinBlockItems[0]
          if (item) {
            selectBuiltinBlockFromMenu(item.id, blockAddMenuOpen ? "block" : "slash")
          }
          return
        }
      }

      const target = event.target as HTMLElement | null
      if (!target || !target.closest(".doc-editor-content .tiptap.ProseMirror")) {
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
  }, [blockAddMenuOpen, blockMenuHighlightIndex, builtinBlockItems, closeSlashMenu, draggingBlockId, editor, isEditable, selectBuiltinBlockFromMenu, slashMenuHighlightIndex])

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

      event.preventDefault()
      setBlockAddMenuOpen(false)
      closeSlashMenu()
      dragSourceIdRef.current = currentBlockId
      dragDropTargetRef.current = null
      setDraggingBlockId(currentBlockId)
      setDropIndicatorTop(null)

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

      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault()
        updateDropIndicator(moveEvent.clientY)
      }

      const handlePointerUp = () => {
        document.removeEventListener("pointermove", handlePointerMove)
        document.removeEventListener("pointerup", handlePointerUp)
        document.removeEventListener("pointercancel", handlePointerUp)

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

      document.addEventListener("pointermove", handlePointerMove)
      document.addEventListener("pointerup", handlePointerUp)
      document.addEventListener("pointercancel", handlePointerUp)
    },
    [closeSlashMenu, currentBlockId, editor, moveBlockRelative, resolveDropTarget, updateBlockHandlePosition]
  )

  const handleInsertBuiltinBlock = useCallback(
    (type: BuiltinBlockType) => {
      selectBuiltinBlockFromMenu(type, "block")
    },
    [selectBuiltinBlockFromMenu]
  )

  const handleInsertBuiltinBlockFromSlash = useCallback(
    (type: BuiltinBlockType) => {
      selectBuiltinBlockFromMenu(type, "slash")
    },
    [selectBuiltinBlockFromMenu]
  )

  const handleControlsPointerLeave = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as HTMLElement | null
    const movingToEditorContent = Boolean(nextTarget?.closest(".doc-editor-content .tiptap.ProseMirror"))
    if (
      !shouldHideControlsOnPointerExit({
        dragging: Boolean(draggingBlockId),
        menuOpen: blockAddMenuOpen,
        movingIntoControls: movingToEditorContent,
      })
    ) {
      return
    }
    setBlockControlsVisible(false)
    hoverClientYRef.current = null
  }, [blockAddMenuOpen, draggingBlockId])

  useEffect(() => {
    if (!editor || !desktopHandleEnabled) {
      setBlockAddMenuOpen(false)
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
  }, [desktopHandleEnabled, editor, updateBlockHandlePosition])

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
          menuOpen: blockAddMenuOpen,
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
  }, [blockAddMenuOpen, desktopHandleEnabled, draggingBlockId, editor, updateBlockHandleFromClientY])

  useEffect(() => {
    if (!desktopHandleEnabled || !blockAddMenuOpen) {
      return
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (blockAddContainerRef.current?.contains(target)) {
        return
      }
      setBlockAddMenuOpen(false)
    }
    document.addEventListener("mousedown", handlePointerDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
    }
  }, [blockAddMenuOpen, desktopHandleEnabled])

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

      if (slashMenuOpenRef.current) {
        const triggerPos = slashTriggerPosRef.current
        if (triggerPos == null) {
          closeSlashMenu()
        } else {
          const triggerText = editor.state.doc.textBetween(triggerPos, triggerPos + 1, "\0", "\0")
          if (triggerText !== "/") {
            closeSlashMenu()
          }
        }
      }

      if (pendingSlashMenuOpenRef.current) {
        pendingSlashMenuOpenRef.current = false
        openSlashMenuNearCursor()
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
  }, [closeSlashMenu, editor, isEditable, onChange, openSlashMenuNearCursor])

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
    if (serialized === lastContentRef.current) {
      return
    }
    const editorSerialized = JSON.stringify(editor.getJSON())
    if (serialized === editorSerialized) {
      lastContentRef.current = serialized
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
  }, [content, editor, knownExtensionNodeTypes, pluginBlockIdTypes])

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
          if (serialized === lastContentRef.current) {
            return
          }
          const editorSerialized = JSON.stringify(editor.getJSON())
          if (serialized === editorSerialized) {
            lastContentRef.current = serialized
            onChangeRef.current?.(nextContent)
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
  }, [docId, onLoadDocument, editor, knownExtensionNodeTypes, pluginBlockIdTypes])

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
              data-visible={blockControlsVisible || blockAddMenuOpen || Boolean(draggingBlockId) ? "true" : "false"}
              style={{ top: `${Math.round(blockHandleTop)}px` }}
            >
              <button
                className={`doc-editor-block-add-trigger${blockAddMenuOpen ? " active" : ""}`}
                type="button"
                aria-label="插入块"
                disabled={!currentBlockId || Boolean(draggingBlockId)}
                onClick={() => {
                  closeSlashMenu()
                  focusCurrentBlockForInsert()
                  setBlockAddMenuOpen((prev) => {
                    const next = !prev
                    if (next) {
                      setBlockMenuHighlightIndex(0)
                    }
                    return next
                  })
                }}
              >
                +
              </button>
              <button
                className={`doc-editor-block-drag-trigger${draggingBlockId ? " active" : ""}`}
                type="button"
                aria-label="移动块"
                disabled={!currentBlockId}
                onPointerDown={handleDragHandlePointerDown}
              >
                ⋮⋮
              </button>
              <BlockAddMenu
                open={blockAddMenuOpen && !draggingBlockId}
                onSelect={handleInsertBuiltinBlock}
                highlightedIndex={blockMenuHighlightIndex}
                onHighlightIndexChange={setBlockMenuHighlightIndex}
              />
            </div>
          ) : null}
          {isEditable ? (
            <BlockAddMenu
              open={slashMenuOpen && !draggingBlockId}
              onSelect={handleInsertBuiltinBlockFromSlash}
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
