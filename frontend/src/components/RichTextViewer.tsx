import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import { BlockIdExtension } from "DocEditor/extensions/BlockIdExtension";
import { OpenApiNode } from "DocEditor/nodes/openapi-node/openapi-node-extension";
import { OpenApiRefNode } from "DocEditor/nodes/openapi-ref-node/openapi-ref-node-extension";

const lowlight = createLowlight(common);

interface RichTextViewerProps {
  content: JSONContent;
  projectKey?: string;
}

function RichTextViewer({ content, projectKey }: RichTextViewerProps) {
  const editor = useEditor({
    extensions: [
      BlockIdExtension,
      OpenApiNode.configure({ projectKey }),
      OpenApiRefNode.configure({ projectKey }),
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
        class: "tiptap",
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
