import type { DocumentVersionEvent, DocumentVersionPayload } from "./types.js";

function pickString(payload: DocumentVersionPayload, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

export function buildDocumentCommitMessage(
  event: DocumentVersionEvent,
  payload: DocumentVersionPayload,
): string {
  const docId = pickString(payload, ["docId", "doc_id", "id"], "unknown");
  const title = pickString(payload, ["title"], "");

  switch (event) {
    case "document.create":
      return `docs(create): ${docId}${title ? ` ${title}` : ""}`;
    case "document.update":
      return `docs(update): ${docId}${title ? ` ${title}` : ""}`;
    case "document.delete":
      return `docs(delete): ${docId}`;
    case "document.move": {
      const fromParentId = pickString(payload, ["fromParentId", "from_parent_id"], "unknown");
      const toParentId = pickString(payload, ["toParentId", "to_parent_id"], "unknown");
      return `docs(move): ${docId} ${fromParentId} -> ${toParentId}`;
    }
    case "document.import": {
      const count = payload.count;
      const normalizedCount = typeof count === "number" && Number.isFinite(count) ? count : 1;
      return `docs(import): ${normalizedCount}`;
    }
    case "document.optimize":
      return `docs(optimize): ${docId}`;
    default:
      return `docs(update): ${docId}`;
  }
}

