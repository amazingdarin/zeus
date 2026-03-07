import type { KnowledgeBaseDocument } from "../../components/KnowledgeBaseSideNav";

export const EPHEMERAL_DRAFT_ID = "__ephemeral_draft__";
export const EPHEMERAL_DRAFT_TITLE = "无标题文档";

export function shouldEnterEphemeralDraftMode(totalDocumentCount: number): boolean {
  return totalDocumentCount === 0;
}

export function shouldRedirectToEphemeralDraft(input: {
  totalDocumentCount: number;
  routeDocId: string;
}): boolean {
  if (!shouldEnterEphemeralDraftMode(input.totalDocumentCount)) {
    return false;
  }
  const routeDocId = input.routeDocId.trim();
  if (!routeDocId) {
    return false;
  }
  return routeDocId !== EPHEMERAL_DRAFT_ID;
}

export function countProjectDocuments(input: {
  rootDocuments: KnowledgeBaseDocument[];
  childrenByParent: Record<string, KnowledgeBaseDocument[]>;
}): number {
  const rootCount = Array.isArray(input.rootDocuments) ? input.rootDocuments.length : 0;
  const childrenCount = Object.values(input.childrenByParent ?? {}).reduce(
    (sum, docs) => sum + (Array.isArray(docs) ? docs.length : 0),
    0,
  );
  return rootCount + childrenCount;
}
