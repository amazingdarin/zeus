import type { Document, DocumentMeta } from "../storage/types.js";
import { documentStore } from "../storage/document-store.js";
import { extractTiptapDoc } from "../utils/tiptap-content.js";

export type DocumentInspectBlockSnapshot = {
  id?: string;
  type: string;
  attrs: Record<string, unknown>;
};

export type DocumentInspectSnapshot = {
  docId: string;
  title: string;
  meta: DocumentMeta;
  body?: Document["body"];
  blocks: DocumentInspectBlockSnapshot[];
};

export type InspectDocumentInput = {
  userId: string;
  projectKey: string;
  docId: string;
  includeContent?: boolean;
  includeBlockAttrs?: boolean;
  blockTypes?: string[];
};

export type InspectDocumentsInput = {
  userId: string;
  projectKey: string;
  docIds: string[];
  includeContent?: boolean;
  includeBlockAttrs?: boolean;
  blockTypes?: string[];
  maxDocs?: number;
};

type InspectDeps = {
  getDocument?: (userId: string, projectKey: string, docId: string) => Promise<Document>;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function walkTiptapNodes(
  node: unknown,
  visit: (node: { type?: unknown; attrs?: unknown; content?: unknown }) => void,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) {
      walkTiptapNodes(item, visit);
    }
    return;
  }

  const current = node as { type?: unknown; attrs?: unknown; content?: unknown };
  visit(current);
  if (Array.isArray(current.content)) {
    for (const child of current.content) {
      walkTiptapNodes(child, visit);
    }
  }
}

function normalizeBlockTypeSet(blockTypes?: string[]): Set<string> | null {
  if (!Array.isArray(blockTypes) || blockTypes.length === 0) {
    return null;
  }
  const normalized = blockTypes
    .map((value) => normalizeString(value))
    .filter(Boolean);
  if (normalized.length === 0) return null;
  return new Set(normalized);
}

function collectBlockSnapshots(
  body: Document["body"],
  blockTypeSet: Set<string> | null,
): DocumentInspectBlockSnapshot[] {
  const snapshots: DocumentInspectBlockSnapshot[] = [];
  const tiptapDoc = extractTiptapDoc(body);

  walkTiptapNodes(tiptapDoc, (node) => {
    const type = normalizeString(node.type);
    if (!type) return;
    if (blockTypeSet && !blockTypeSet.has(type)) return;

    const attrs = node.attrs && typeof node.attrs === "object"
      ? (node.attrs as Record<string, unknown>)
      : {};
    const blockId = normalizeString(attrs.id);

    snapshots.push({
      type,
      attrs,
      ...(blockId ? { id: blockId } : {}),
    });
  });

  return snapshots;
}

export async function inspectDocumentSnapshot(
  input: InspectDocumentInput,
  deps?: InspectDeps,
): Promise<DocumentInspectSnapshot> {
  const doc = await (deps?.getDocument || documentStore.get)(
    input.userId,
    input.projectKey,
    input.docId,
  );

  const includeContent = input.includeContent === true;
  const includeBlockAttrs = input.includeBlockAttrs !== false;
  const blockTypeSet = normalizeBlockTypeSet(input.blockTypes);

  const blocks = includeBlockAttrs
    ? collectBlockSnapshots(doc.body, blockTypeSet)
    : [];

  return {
    docId: doc.meta.id,
    title: normalizeString(doc.meta.title) || doc.meta.id,
    meta: doc.meta,
    ...(includeContent ? { body: doc.body } : {}),
    blocks,
  };
}

export async function inspectDocumentSnapshots(
  input: InspectDocumentsInput,
  deps?: InspectDeps,
): Promise<DocumentInspectSnapshot[]> {
  const docIds = Array.from(
    new Set(
      (Array.isArray(input.docIds) ? input.docIds : [])
        .map((docId) => normalizeString(docId))
        .filter(Boolean),
    ),
  );
  if (docIds.length === 0) {
    return [];
  }

  const maxDocs = Number.isFinite(input.maxDocs) && (input.maxDocs || 0) > 0
    ? Math.trunc(input.maxDocs || 50)
    : 50;

  const snapshots: DocumentInspectSnapshot[] = [];
  for (const docId of docIds.slice(0, maxDocs)) {
    try {
      const snapshot = await inspectDocumentSnapshot(
        {
          userId: input.userId,
          projectKey: input.projectKey,
          docId,
          includeContent: input.includeContent,
          includeBlockAttrs: input.includeBlockAttrs,
          blockTypes: input.blockTypes,
        },
        deps,
      );
      snapshots.push(snapshot);
    } catch {
      // Ignore per-document failures; caller handles empty snapshots.
    }
  }

  return snapshots;
}
