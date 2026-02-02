/**
 * Block ID utilities for ensuring all blocks have unique IDs
 */

import { randomUUID } from "crypto";

// Block types that should have IDs
const BLOCK_ID_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "codeBlock",
  "plantuml",
  "listItem",
  "taskItem",
  "blockquote",
  "image",
  "imageUpload",
  "horizontalRule",
  "linkPreview",
  "fileBlock",
  "file_block", // Backend uses snake_case
  "blockRef",
  "openapi",
  "openapiRef",
  "toc",
  // List containers - need IDs for accurate DIFF matching
  "bulletList",
  "orderedList",
  "taskList",
]);

type JSONContent = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JSONContent[];
  [key: string]: unknown;
};

const createBlockId = (): string => {
  return randomUUID();
};

const normalizeId = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

/**
 * Ensure all blocks in the content have unique IDs
 * This is a pure function that returns a new content object if changes are made
 */
export function ensureBlockIds(content: JSONContent): JSONContent {
  const usedIds = new Set<string>();

  const visit = (node: JSONContent): JSONContent => {
    if (!node) {
      return node;
    }

    let nextNode = node;
    let mutated = false;

    // Recursively process children
    if (Array.isArray(node.content)) {
      const nextContent = node.content.map(visit);
      const contentChanged = nextContent.some(
        (child, index) => child !== node.content?.[index]
      );
      if (contentChanged) {
        nextNode = { ...nextNode };
        nextNode.content = nextContent;
        mutated = true;
      }
    }

    // Check if this node type should have an ID
    const type = node.type ?? "";
    if (BLOCK_ID_NODE_TYPES.has(type)) {
      const currentId = normalizeId(node.attrs?.id);
      if (!currentId || usedIds.has(currentId)) {
        // Generate new ID
        const nextId = createBlockId();
        const nextAttrs = { ...(node.attrs ?? {}), id: nextId };
        if (!mutated) {
          nextNode = { ...nextNode };
          mutated = true;
        }
        nextNode.attrs = nextAttrs;
        usedIds.add(nextId);
      } else {
        usedIds.add(currentId);
      }
    }

    return nextNode;
  };

  return visit(content);
}
