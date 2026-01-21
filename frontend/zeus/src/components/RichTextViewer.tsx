import type { JSONContent } from "@tiptap/react";
import type { Extensions } from "@tiptap/core";

import { BlockRefNode, DocViewer, OpenApiNode, OpenApiRefNode } from "@zeus/doc-editor";

import { apiFetch } from "../config/api";

interface RichTextViewerProps {
  content: JSONContent;
  projectKey?: string;
}

const openApiExtensions = (projectKey?: string): Extensions => [
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
  const extensions: Extensions = [
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
