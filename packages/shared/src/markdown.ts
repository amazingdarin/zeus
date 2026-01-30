import type { JSONContent } from "@tiptap/react";
import { markdownToTiptapJson as toTiptap, tiptapJsonToMarkdown as toMarkdown } from "@zeus/doc-editor";

export type MarkdownOptions = {
  extensions?: string[];
};

export const markdownToTiptapJson = (
  markdown: string,
  options?: MarkdownOptions,
): JSONContent => {
  return toTiptap(markdown, options);
};

export const tiptapJsonToMarkdown = (content: JSONContent): string => {
  return toMarkdown(content);
};
