import type { JSONContent } from "@tiptap/react";

import { DocEditor } from "@zeus/doc-editor";
import { OpenApiNode, OpenApiRefNode } from "@zeus/doc-editor-openapi";

import { apiFetch } from "../config/api";

interface RichTextEditorProps {
  onChange?: (content: JSONContent) => void;
  content?: JSONContent | null;
  projectKey?: string;
  docId?: string;
  onLoadDocument?: (id: string) => Promise<JSONContent>;
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

function RichTextEditor({ onChange, content, projectKey, docId, onLoadDocument }: RichTextEditorProps) {
  return (
    <DocEditor
      onChange={onChange}
      content={content}
      extensions={openApiExtensions(projectKey)}
      mode="edit"
      docId={docId}
      onLoadDocument={onLoadDocument}
    />
  );
}

export default RichTextEditor;
