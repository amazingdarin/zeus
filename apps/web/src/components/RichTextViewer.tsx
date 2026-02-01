import type { JSONContent, Editor } from "@tiptap/react";
import type { Extensions } from "@tiptap/core";

import {
  BlockRefNode,
  DocViewer,
  FileBlockNode,
  OpenApiNode,
  OpenApiRefNode,
} from "@zeus/doc-editor";

import { apiFetch } from "../config/api";
import { fetchUrlHtml } from "../api/documents";

interface RichTextViewerProps {
  content: JSONContent;
  projectKey?: string;
  onEditorReady?: (editor: Editor | null) => void;
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
  FileBlockNode.configure({
    projectKey,
    fetcher: apiFetch,
  }),
];

function RichTextViewer({ content, projectKey, onEditorReady }: RichTextViewerProps) {
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
      <DocViewer
        content={content}
        extensions={extensions}
        linkPreviewFetchHtml={async (url: string) => {
          if (!projectKey) {
            throw new Error("Missing project key")
          }
          const data = await fetchUrlHtml(projectKey, url)
          return data.html
        }}
        onEditorReady={onEditorReady}
      />
    </div>
  );
}

export default RichTextViewer;
