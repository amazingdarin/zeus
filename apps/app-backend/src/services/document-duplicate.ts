import { v4 as uuidv4 } from "uuid";

import { documentStore } from "../storage/document-store.js";
import type { Document, DocumentBody } from "../storage/types.js";

type DuplicateDocumentInput = {
  userId: string;
  projectKey: string;
  docId: string;
};

function normalizeSourceTitle(title: string): string {
  const normalized = String(title ?? "").trim();
  return normalized || "无标题文档";
}

function resolveDuplicateTitle(sourceTitle: string, siblingTitles: Set<string>): string {
  const baseTitle = normalizeSourceTitle(sourceTitle);
  const firstCandidate = `${baseTitle}（副本）`;
  if (!siblingTitles.has(firstCandidate)) {
    return firstCandidate;
  }

  let index = 2;
  while (siblingTitles.has(`${baseTitle}（副本${index}）`)) {
    index += 1;
  }
  return `${baseTitle}（副本${index}）`;
}

function cloneDocumentBody(body: DocumentBody): DocumentBody {
  return JSON.parse(JSON.stringify(body)) as DocumentBody;
}

function cloneDocumentExtra(
  extra: Document["meta"]["extra"],
): Document["meta"]["extra"] | undefined {
  if (!extra || typeof extra !== "object") {
    return undefined;
  }
  return JSON.parse(JSON.stringify(extra)) as Record<string, unknown>;
}

export async function duplicateDocument(input: DuplicateDocumentInput): Promise<Document> {
  const source = await documentStore.get(input.userId, input.projectKey, input.docId);
  const parentId = source.meta.parent_id || "root";

  const siblings = await documentStore.getChildren(input.userId, input.projectKey, parentId);
  const siblingTitles = new Set(
    siblings
      .map((item) => String(item.title ?? "").trim())
      .filter(Boolean),
  );
  const duplicateTitle = resolveDuplicateTitle(source.meta.title, siblingTitles);

  const duplicatedDoc: Document = {
    meta: {
      id: uuidv4(),
      schema_version: source.meta.schema_version || "v1",
      title: duplicateTitle,
      slug: "",
      path: "",
      parent_id: parentId,
      created_at: "",
      updated_at: "",
      extra: cloneDocumentExtra(source.meta.extra),
    },
    body: cloneDocumentBody(source.body),
  };

  return documentStore.save(input.userId, input.projectKey, duplicatedDoc);
}

