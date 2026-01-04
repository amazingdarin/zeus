import type { JSONContent } from "@tiptap/react";

import { SimpleEditor } from "@/components/tiptap-templates/simple/simple-editor";

interface RichTextEditorProps {
  onChange?: (content: JSONContent) => void;
  content?: JSONContent | null;
}

function RichTextEditor({ onChange, content }: RichTextEditorProps) {
  return <SimpleEditor onChange={onChange} content={content} />;
}

export default RichTextEditor;
