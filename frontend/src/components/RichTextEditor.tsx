import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import { useEffect, useMemo, useRef } from "react";

const lowlight = createLowlight(common);

interface RichTextEditorProps {
  onChange?: (content: JSONContent) => void;
  content?: JSONContent | null;
}

const defaultContent: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Untitled Document" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Start writing your document..." }],
    },
  ],
};

function RichTextEditor({ onChange, content }: RichTextEditorProps) {
  const lastContentRef = useRef<string | null>(null);
  const initialContent = useMemo(() => {
    return content ?? defaultContent;
  }, [content]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: {
          levels: [1, 2, 3],
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
    ],
    content: initialContent,
    onCreate({ editor }) {
      onChange?.(editor.getJSON());
    },
    onUpdate({ editor }) {
      onChange?.(editor.getJSON());
    },
    editorProps: {
      attributes: {
        class: "rich-editor-content",
      },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) {
          return false;
        }
        const { tr } = view.state;
        view.dispatch(tr.insertText(text));
        return true;
      },
    },
  });

  useEffect(() => {
    if (!editor || !content) {
      return;
    }
    const serialized = JSON.stringify(content);
    if (serialized === lastContentRef.current) {
      return;
    }
    editor.commands.setContent(content);
    lastContentRef.current = serialized;
  }, [content, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    lastContentRef.current = JSON.stringify(editor.getJSON());
  }, [editor]);

  return (
    <div className="rich-editor">
      <div className="rich-editor-toolbar">
        <button
          type="button"
          className={`rich-editor-btn${editor?.isActive("heading", { level: 1 }) ? " active" : ""}`}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </button>
        <button
          type="button"
          className={`rich-editor-btn${editor?.isActive("heading", { level: 2 }) ? " active" : ""}`}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </button>
        <button
          type="button"
          className={`rich-editor-btn${editor?.isActive("heading", { level: 3 }) ? " active" : ""}`}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          H3
        </button>
        <button
          type="button"
          className={`rich-editor-btn${editor?.isActive("paragraph") ? " active" : ""}`}
          onClick={() => editor?.chain().focus().setParagraph().run()}
        >
          Body
        </button>
        <button
          type="button"
          className={`rich-editor-btn${editor?.isActive("blockquote") ? " active" : ""}`}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          Quote
        </button>
        <button
          type="button"
          className={`rich-editor-btn${editor?.isActive("codeBlock") ? " active" : ""}`}
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        >
          Code
        </button>
      </div>
      <div className="rich-editor-surface">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export default RichTextEditor;
