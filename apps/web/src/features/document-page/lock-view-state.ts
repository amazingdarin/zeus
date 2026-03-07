import type { DocumentLockInfo } from "../../api/documents";

export type DocumentLockViewState = {
  readonly: boolean;
  showLockBadge: boolean;
};

export function mapDocumentLockViewState(
  lock: DocumentLockInfo | null | undefined,
): DocumentLockViewState {
  const readonly = Boolean(lock?.locked);
  return {
    readonly,
    showLockBadge: readonly,
  };
}
