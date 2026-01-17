import type { JSONContent } from "@tiptap/react";

import { DocEditor } from "@zeus/doc-editor";
import { OpenApiNode, OpenApiRefNode } from "@zeus/doc-editor-openapi";

import { apiFetch } from "../config/api";

interface RichTextEditorProps {
  onChange?: (content: JSONContent) => void;
  content?: JSONContent | null;
  projectKey?: string;
}

const openApiExtensions = (
  projectKey?: string
) => [
  OpenApiNode.configure({
    projectKey,
    fetcher: apiFetch,
  }),
  OpenApiRefNode.configure({
    projectKey,
    fetcher: apiFetch,
  }),
];

function RichTextEditor({ onChange, content, projectKey }: RichTextEditorProps) {
  return (
    <DocEditor
      onChange={onChange}
      content={content}
      extensions={openApiExtensions(projectKey)}
      mode="edit"
    />
  );
}

export default RichTextEditor;
