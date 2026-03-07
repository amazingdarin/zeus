import type { DocumentScope } from "../../api/chat";

type MentionLike = {
  kind?: string;
  docId?: string;
  includeChildren?: boolean;
};

type BuildDocumentScopeOptions = {
  mentions: MentionLike[];
  defaultDocumentId?: string;
};

export const buildDocumentScopeForChat = (
  options: BuildDocumentScopeOptions,
): DocumentScope[] | undefined => {
  const explicitDocScope = options.mentions
    .filter((mention) => mention.kind !== "plugin_template")
    .map((mention) => ({
      docId: String(mention.docId ?? "").trim(),
      includeChildren: Boolean(mention.includeChildren),
    }))
    .filter((scope) => scope.docId.length > 0);

  if (explicitDocScope.length > 0) {
    return explicitDocScope;
  }

  const fallbackDocId = String(options.defaultDocumentId ?? "").trim();
  if (!fallbackDocId) {
    return undefined;
  }

  return [{ docId: fallbackDocId, includeChildren: false }];
};

