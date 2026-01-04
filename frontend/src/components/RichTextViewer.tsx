import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";

const lowlight = createLowlight(common);

interface RichTextViewerProps {
  content: JSONContent;
}

function RichTextViewer({ content }: RichTextViewerProps) {
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
    content,
    editable: false,
    editorProps: {
      attributes: {
        class: "rich-editor-content",
      },
    },
  });

  return (
    <div className="rich-viewer">
      <EditorContent editor={editor} />
    </div>
  );
}

export default RichTextViewer;
