export type DocumentVersionEvent =
  | "document.create"
  | "document.update"
  | "document.delete"
  | "document.move"
  | "document.import"
  | "document.optimize";

export type DocumentVersionPayload = Record<string, unknown>;

export type DocumentVersionScope = {
  ownerType: "personal" | "team";
  ownerId: string;
  projectKey: string;
};

export type SyncMode = "local_only" | "remote_enabled";

export type RecordDocumentVersionInput = {
  userId: string;
  projectKey: string;
  event: DocumentVersionEvent;
  payload: DocumentVersionPayload;
  isAuthenticated: boolean;
  accessToken?: string;
  scope?: DocumentVersionScope;
};

export type SyncOnOpenInput = {
  userId: string;
  projectKey: string;
  isAuthenticated: boolean;
  accessToken?: string;
  scope?: DocumentVersionScope;
};

