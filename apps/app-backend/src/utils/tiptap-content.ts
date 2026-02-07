import type { JSONContent } from "@tiptap/core";

/**
 * Normalize various Zeus document body shapes into a Tiptap `doc` JSONContent.
 *
 * Supported inputs:
 * - Tiptap doc: { type: "doc", content: [...] }
 * - DocumentBody wrapper: { type: "tiptap", content: { type: "doc", ... } }
 * - DocumentBody wrapper with array content: { type: "tiptap", content: [...] }
 */
export function extractTiptapDoc(input: unknown): JSONContent {
  if (!input || typeof input !== "object") {
    return { type: "doc", content: [] };
  }

  const body = input as { type?: unknown; content?: unknown };

  // Direct Tiptap doc
  if (body.type === "doc" && Array.isArray(body.content)) {
    return body as unknown as JSONContent;
  }

  // Zeus DocumentBody wrapper
  if (body.type === "tiptap") {
    const content = body.content;
    if (content && typeof content === "object") {
      const inner = content as { type?: unknown; content?: unknown };
      if (inner.type === "doc" && Array.isArray(inner.content)) {
        return inner as unknown as JSONContent;
      }
      if (Array.isArray(content)) {
        return { type: "doc", content: content as JSONContent[] };
      }
      if (typeof inner.type === "string") {
        return { type: "doc", content: [inner as unknown as JSONContent] };
      }
    }
    if (Array.isArray(content)) {
      return { type: "doc", content: content as JSONContent[] };
    }
    return { type: "doc", content: [] };
  }

  // Some callers might pass { content: { type: "doc", ... } }
  if (body.content && typeof body.content === "object") {
    const inner = body.content as { type?: unknown; content?: unknown };
    if (inner.type === "doc" && Array.isArray(inner.content)) {
      return inner as unknown as JSONContent;
    }
  }

  // Fallback: if it has a content array, wrap it.
  if (Array.isArray(body.content)) {
    return { type: "doc", content: body.content as JSONContent[] };
  }

  return { type: "doc", content: [] };
}

