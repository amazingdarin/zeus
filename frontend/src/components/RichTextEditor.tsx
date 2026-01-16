import type { JSONContent } from "@tiptap/react";

import { SimpleEditor } from "DocEditor/templates/simple/simple-editor";

interface RichTextEditorProps {
  onChange?: (content: JSONContent) => void;
  content?: JSONContent | null;
  projectKey?: string;
}

function RichTextEditor({ onChange, content, projectKey }: RichTextEditorProps) {
  return <SimpleEditor onChange={onChange} content={content} projectKey={projectKey} />;
}

export default RichTextEditor;
