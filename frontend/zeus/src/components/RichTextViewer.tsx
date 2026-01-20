import type { JSONContent } from "@tiptap/react";

import { BlockRefNode, DocViewer } from "@zeus/doc-editor";
import { OpenApiNode, OpenApiRefNode } from "@zeus/doc-editor-openapi";

import { apiFetch } from "../config/api";

interface RichTextViewerProps {
  content: JSONContent;
  projectKey?: string;
}

const openApiExtensions = (projectKey?: string) => [
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
  const openapi = openApiExtensions(projectKey);
  const extensions = [
    ...openapi,
    BlockRefNode.configure({
      projectKey,
      fetcher: apiFetch,
      viewerExtensions: openapi,
    }),
  ];

  return (
    <div className="rich-text-viewer">
      <DocViewer content={content} extensions={extensions} />
    </div>
  );
}

export default RichTextViewer;
