import type { JSONContent } from "@tiptap/react";

import { DocViewer } from "@zeus/doc-editor";
import { OpenApiNode, OpenApiRefNode } from "@zeus/doc-editor-openapi";

import { apiFetch } from "../config/api";

interface RichTextViewerProps {
  content: JSONContent;
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

function RichTextViewer({ content, projectKey }: RichTextViewerProps) {
  return (
    <DocViewer
      content={content}
      extensions={openApiExtensions(projectKey)}
    />
  );
}

export default RichTextViewer;
