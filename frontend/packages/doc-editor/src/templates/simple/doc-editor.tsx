"use client"

"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { JSONContent } from "@tiptap/react"
import { EditorContent, EditorContext, type Extension, useEditor } from "@tiptap/react"

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
import "../../nodes/blockquote-node/blockquote-node.scss"
import "../../nodes/code-block-node/code-block-node.scss"
import "../../nodes/horizontal-rule-node/horizontal-rule-node.scss"
import "../../nodes/list-node/list-node.scss"
import "../../nodes/image-node/image-node.scss"
import "../../nodes/heading-node/heading-node.scss"
import "../../nodes/paragraph-node/paragraph-node.scss"

// --- Tiptap UI ---
import { HeadingDropdownMenu } from "../../ui/heading-dropdown-menu"
import { ImageUploadButton } from "../../ui/image-upload-button"
import { ListDropdownMenu } from "../../ui/list-dropdown-menu"
import { BlockquoteButton } from "../../ui/blockquote-button"
import { CodeBlockButton } from "../../ui/code-block-button"
import { OpenApiDropdownMenu } from "../../ui/openapi-dropdown-menu"
import {
  ColorHighlightPopover,
  ColorHighlightPopoverContent,
  ColorHighlightPopoverButton,
} from "../../ui/color-highlight-popover"
import {
  LinkPopover,
  LinkContent,
  LinkButton,
} from "../../ui/link-popover"
import { MarkButton } from "../../ui/mark-button"
import { TextAlignButton } from "../../ui/text-align-button"
import { UndoRedoButton } from "../../ui/undo-redo-button"

// --- Icons ---
import { ArrowLeftIcon } from "../../icons/arrow-left-icon"
import { HighlighterIcon } from "../../icons/highlighter-icon"
import { LinkIcon } from "../../icons/link-icon"

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

// --- Styles ---
import "./doc-editor.scss"

type DocEditorProps = {
  onChange?: (content: JSONContent) => void
  content?: JSONContent | null
  extensions?: Extension[]
  mode?: "edit" | "view"
  docId?: string
  onLoadDocument?: (id: string) => Promise<JSONContent>
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
  onLinkClick,
  isMobile,
}: {
  onHighlighterClick: () => void
  onLinkClick: () => void
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
        <CodeBlockButton />
        <OpenApiDropdownMenu portal={isMobile} hideWhenUnavailable />
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
        {!isMobile ? <LinkPopover /> : <LinkButton onClick={onLinkClick} />}
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

      <ToolbarSeparator />

      <ToolbarGroup>
        <ImageUploadButton text="Add" />
      </ToolbarGroup>

      <Spacer />

      {isMobile && <ToolbarSeparator />}

    </>
  )
}

const MobileToolbarContent = ({
  type,
  onBack,
}: {
  type: "highlighter" | "link"
  onBack: () => void
}) => (
  <>
    <ToolbarGroup>
      <Button data-style="ghost" onClick={onBack}>
        <ArrowLeftIcon className="tiptap-button-icon" />
        {type === "highlighter" ? (
          <HighlighterIcon className="tiptap-button-icon" />
        ) : (
          <LinkIcon className="tiptap-button-icon" />
        )}
      </Button>
    </ToolbarGroup>

    <ToolbarSeparator />

    {type === "highlighter" ? (
      <ColorHighlightPopoverContent />
    ) : (
      <LinkContent />
    )}
  </>
)

export function DocEditor({ onChange, content, mode = "edit", extensions = [], docId, onLoadDocument }: DocEditorProps) {
  const isEditable = mode === "edit"
  const isMobile = useIsBreakpoint()
  const { height } = useWindowSize()
  const [mobileView, setMobileView] = useState<"main" | "highlighter" | "link">(
    "main"
  )
  const toolbarRef = useRef<HTMLDivElement>(null)
  const lastContentRef = useRef<string | null>(null)
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
      StarterKit.configure({
        horizontalRule: false,
        link: {
          openOnClick: false,
          enableClickSelection: true,
        },
      }),
      HorizontalRule,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
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
      ...extensions,
    ],
    content: initialContent,
    editable: isEditable,
  })

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
                onLinkClick={() => setMobileView("link")}
                isMobile={isMobile}
              />
            ) : (
              <MobileToolbarContent
                type={mobileView === "highlighter" ? "highlighter" : "link"}
                onBack={() => setMobileView("main")}
              />
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
