import type { Document } from "../../storage/types.js";

export type DocumentTrashEntityType = "document" | "directory";

export type DocumentTrashEntry = {
  trashId: string;
  rootDocId: string;
  title: string;
  entityType: DocumentTrashEntityType;
  originalPath: string;
  originalParentId: string;
  deletedAt: string;
  deletedBy: string;
  deletedIds: string[];
};

export type DocumentTrashSnapshot = {
  rootDocId: string;
  docs: Document[];
};

export type MoveToTrashInput = {
  userId: string;
  projectKey: string;
  docId: string;
  recursive?: boolean;
  deletedBy: string;
};

export type MoveToTrashResult = {
  entry: DocumentTrashEntry;
  deletedIds: string[];
};

export type ListTrashInput = {
  userId: string;
  projectKey: string;
};

export type GetTrashSnapshotInput = {
  userId: string;
  projectKey: string;
  trashId: string;
};

export type RestoreTrashInput = {
  userId: string;
  projectKey: string;
  trashId: string;
};

export type RestoreTrashResult = {
  root: Document;
  fallbackToRoot: boolean;
  restoredIds: string[];
};

export type PurgeOneTrashInput = {
  userId: string;
  projectKey: string;
  trashId: string;
};

export type PurgeOneTrashResult = {
  purged: boolean;
};

export type PurgeAllTrashInput = {
  userId: string;
  projectKey: string;
};

export type PurgeAllTrashResult = {
  count: number;
};

export type SweepExpiredTrashInput = {
  userId: string;
  projectKey: string;
  maxAgeDays: number;
};

export type SweepExpiredTrashResult = {
  count: number;
};

export type DocumentTrashStore = {
  moveToTrash(input: MoveToTrashInput): Promise<MoveToTrashResult>;
  list(input: ListTrashInput): Promise<DocumentTrashEntry[]>;
  getSnapshot(input: GetTrashSnapshotInput): Promise<DocumentTrashSnapshot>;
  restore(input: RestoreTrashInput): Promise<RestoreTrashResult>;
  purgeOne(input: PurgeOneTrashInput): Promise<PurgeOneTrashResult>;
  purgeAll(input: PurgeAllTrashInput): Promise<PurgeAllTrashResult>;
  sweepExpired(input: SweepExpiredTrashInput): Promise<SweepExpiredTrashResult>;
};
