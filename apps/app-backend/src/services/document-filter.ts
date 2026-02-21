import { extractTiptapDoc } from "../utils/tiptap-content.js";

function normalizeBlockType(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function walkNodes(node: unknown, visitor: (type: string) => boolean): boolean {
  if (!node || typeof node !== "object") {
    return false;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      if (walkNodes(item, visitor)) {
        return true;
      }
    }
    return false;
  }

  const current = node as { type?: unknown; content?: unknown };
  const type = normalizeBlockType(current.type);
  if (type && visitor(type)) {
    return true;
  }

  if (Array.isArray(current.content)) {
    for (const child of current.content) {
      if (walkNodes(child, visitor)) {
        return true;
      }
    }
  }

  return false;
}

export function normalizeBlockTypeQuery(input: string): Set<string> {
  return new Set(
    String(input || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function documentContainsAnyBlockType(body: unknown, blockTypes: Set<string>): boolean {
  if (!(blockTypes instanceof Set) || blockTypes.size === 0) {
    return false;
  }

  const doc = extractTiptapDoc(body);
  return walkNodes(doc, (type) => blockTypes.has(type));
}
