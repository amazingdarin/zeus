"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { JSONContent } from "@tiptap/react"
import { EditorContent, EditorContext, useEditor } from "@tiptap/react"

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
import { Button } from "DocEditor/primitives/button"
import { Spacer } from "DocEditor/primitives/spacer"
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "DocEditor/primitives/toolbar"

// --- Tiptap Node ---
import { ImageUploadNode } from "DocEditor/nodes/image-upload-node/image-upload-node-extension"
import { OpenApiNode } from "DocEditor/nodes/openapi-node/openapi-node-extension"
import { OpenApiRefNode } from "DocEditor/nodes/openapi-ref-node/openapi-ref-node-extension"
import { HorizontalRule } from "DocEditor/nodes/horizontal-rule-node/horizontal-rule-node-extension"
import "DocEditor/nodes/blockquote-node/blockquote-node.scss"
import "DocEditor/nodes/code-block-node/code-block-node.scss"
import "DocEditor/nodes/horizontal-rule-node/horizontal-rule-node.scss"
import "DocEditor/nodes/list-node/list-node.scss"
import "DocEditor/nodes/image-node/image-node.scss"
import "DocEditor/nodes/heading-node/heading-node.scss"
import "DocEditor/nodes/paragraph-node/paragraph-node.scss"

// --- Tiptap UI ---
import { HeadingDropdownMenu } from "DocEditor/ui/heading-dropdown-menu"
import { ImageUploadButton } from "DocEditor/ui/image-upload-button"
import { ListDropdownMenu } from "DocEditor/ui/list-dropdown-menu"
import { BlockquoteButton } from "DocEditor/ui/blockquote-button"
import { CodeBlockButton } from "DocEditor/ui/code-block-button"
import {
  ColorHighlightPopover,
  ColorHighlightPopoverContent,
  ColorHighlightPopoverButton,
} from "DocEditor/ui/color-highlight-popover"
import {
  LinkPopover,
  LinkContent,
  LinkButton,
} from "DocEditor/ui/link-popover"
import { MarkButton } from "DocEditor/ui/mark-button"
import { TextAlignButton } from "DocEditor/ui/text-align-button"
import { UndoRedoButton } from "DocEditor/ui/undo-redo-button"

// --- Icons ---
import { ArrowLeftIcon } from "DocEditor/icons/arrow-left-icon"
import { HighlighterIcon } from "DocEditor/icons/highlighter-icon"
import { LinkIcon } from "DocEditor/icons/link-icon"

// --- Hooks ---
import { useIsBreakpoint } from "DocEditor/hooks/use-is-breakpoint"
import { useWindowSize } from "DocEditor/hooks/use-window-size"
import { useCursorVisibility } from "DocEditor/hooks/use-cursor-visibility"

// --- Components ---
import { ThemeToggle } from "DocEditor/templates/simple/theme-toggle"

// --- Lib ---
import { handleImageUpload, MAX_FILE_SIZE } from "DocEditor/lib/tiptap-utils"
import {
  BlockIdExtension,
  ensureBlockIds,
} from "DocEditor/extensions/BlockIdExtension"

// --- Styles ---
import "DocEditor/templates/simple/simple-editor.scss"

type SimpleEditorProps = {
  onChange?: (content: JSONContent) => void
  content?: JSONContent | null
  projectKey?: string
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

      <ToolbarGroup>
        <ThemeToggle />
      </ToolbarGroup>
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

export function SimpleEditor({ onChange, content, projectKey }: SimpleEditorProps) {
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
        class: "simple-editor",
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
      OpenApiNode.configure({ projectKey }),
      OpenApiRefNode.configure({ projectKey }),
    ],
    content: initialContent,
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
    if (!editor) {
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
  }, [editor, onChange])

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

  return (
    <div className="simple-editor-wrapper">
      <EditorContext.Provider value={{ editor }}>
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

        <EditorContent
          editor={editor}
          role="presentation"
          className="simple-editor-content"
        />
      </EditorContext.Provider>
    </div>
  )
}
