export function buildLegacyEditRedirect(input: { documentId?: string; parentId?: string }): string {
  const documentId = (input.documentId || "").trim();
  if (documentId) {
    return `/documents/${encodeURIComponent(documentId)}`;
  }
  return "/documents";
}
