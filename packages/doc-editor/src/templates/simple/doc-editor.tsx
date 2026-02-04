"use client"

"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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

// --- Tiptap Node ---
import { ImageUploadNode } from "../../nodes/image-upload-node/image-upload-node-extension"
import { HorizontalRule } from "../../nodes/horizontal-rule-node/horizontal-rule-node-extension"
import { CodeBlockNode } from "../../nodes/code-block-node/code-block-node-extension"
import { LinkPreviewNode } from "../../nodes/link-preview-node/link-preview-node-extension"
import { TocNode } from "../../nodes/toc-node/toc-node-extension"
import { MathNode } from "../../nodes/math-node/math-node-extension"
import { MusicNode } from "../../nodes/music-node/music-node-extension"
import { ChartNode } from "../../nodes/chart-node/chart-node-extension"
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
import "../../nodes/music-node/music-node.scss"
import "../../nodes/chart-node/chart-node.scss"
import "../../ui/table-button/table-menu.scss"
import "../../ui/music-button/music-button.scss"
import "../../ui/chart-button/chart-button.scss"

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
import { MusicButton } from "../../ui/music-button"
import { ChartButton } from "../../ui/chart-button"
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
import { HeadingCollapseExtension } from "../../extensions/HeadingCollapseExtension"

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
}

const defaultContent: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
    },
  ],
}

const MainToolbarContent = ({
  onHighlighterClick,
  isMobile,
}: {
  onHighlighterClick: () => void
  isMobile: boolean
}) => {
  return (
    <>
      <Spacer />

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
        <MusicButton />
        <ChartButton />
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

      <Spacer />

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
}: DocEditorProps) {
  const isEditable = mode === "edit"
  const isMobile = useIsBreakpoint()
  const { height } = useWindowSize()
  const [mobileView, setMobileView] = useState<"main" | "highlighter">(
    "main"
  )
  const toolbarRef = useRef<HTMLDivElement>(null)
  const lastContentRef = useRef<string | null>(null)
  const taskCheckChangeRef = useRef(onTaskCheckChange)
  taskCheckChangeRef.current = onTaskCheckChange

  const initialContent = useMemo(
    () => ensureBlockIds(content ?? defaultContent),
    [content]
  )

  const editor = useEditor({
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
      BlockIdExtension,
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
      MusicNode,
      ChartNode,
      ...createTableExtensions(),
      ...extensions,
    ],
    content: initialContent,
    editable: isEditable,
  })

  useEffect(() => {
    onEditorReady?.(editor)
  }, [editor, onEditorReady])

  const rect = useCursorVisibility({
    editor,
    overlayHeight: toolbarRef.current?.getBoundingClientRect().height ?? 0,
  })

  useEffect(() => {
    if (!isMobile && mobileView !== "main") {
      setMobileView("main")
    }
  }, [isMobile, mobileView])

  useEffect(() => {
    if (!editor || !isEditable) {
      return
    }
    const handleUpdate = () => {
      const nextContent = editor.getJSON()
      const serialized = JSON.stringify(nextContent)
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
  }, [editor, isEditable, onChange])

  useEffect(() => {
    if (!editor || !content) {
      return
    }
    
    const nextContent = ensureBlockIds(content)
    const serialized = JSON.stringify(nextContent)
    if (serialized === lastContentRef.current) {
      return
    }
    editor.commands.setContent(nextContent)
    lastContentRef.current = serialized
  }, [content, editor])

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
          const nextContent = ensureBlockIds(loadedContent)
          editor.commands.setContent(nextContent)
          lastContentRef.current = JSON.stringify(nextContent)
          // Notify parent of the loaded content using ref
          onChangeRef.current?.(nextContent)
        }
      } catch (error) {
        console.error("Failed to load document content:", error)
      }
    }
    load()

    return () => {
      isMounted = false
    }
  }, [docId, onLoadDocument, editor])

  return (
    <div className="doc-editor-wrapper">
      <EditorContext.Provider value={{ editor }}>
        {isEditable ? (
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
              />
            ) : (
              <MobileToolbarContent onBack={() => setMobileView("main")} />
            )}
          </Toolbar>
        ) : null}

        <EditorContent
          editor={editor}
          role="presentation"
          className="doc-editor-content"
        />
      </EditorContext.Provider>
    </div>
  )
}
