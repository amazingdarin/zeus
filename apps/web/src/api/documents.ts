import { apiFetch, encodeProjectRef } from "../config/api";
import type { JSONContent } from "@tiptap/react";

export class DocumentApiError extends Error {
    status: number;
    code: string;
    data?: unknown;

    constructor(message: string, status: number, code = "DOCUMENT_API_ERROR", data?: unknown) {
        super(message);
        this.name = "DocumentApiError";
        this.status = status;
        this.code = code;
        this.data = data;
    }
}

export function isDocumentNotFoundError(error: unknown): boolean {
    return error instanceof DocumentApiError && error.status === 404;
}

export type DocumentLockInfo = {
    locked: true;
    lockedBy: string;
    lockedAt: string;
};

export function isDocumentLockedError(error: unknown): boolean {
    return error instanceof DocumentApiError
        && (error.status === 423 || error.code === "DOCUMENT_LOCKED");
}

function toDocumentApiError(
    response: Response,
    payload: Record<string, unknown> | null,
    fallbackCode: string,
    fallbackMessage: string,
): DocumentApiError {
    const message = String(payload?.message ?? fallbackMessage);
    const code = String(payload?.code ?? fallbackCode);
    const data = payload?.data;
    return new DocumentApiError(message, response.status, code, data);
}

export type DocumentListItem = {
    id?: string;
    slug?: string;
    title?: string;
    kind?: string;
    type?: string;
    doc_type?: string;
    parent?: string;
    parent_id?: string;
    meta?: {
        id?: string;
        title?: string;
        parent_id?: string;
        parent?: string;
        doc_type?: string;
    };
    has_child?: boolean;
};

export type DocumentHierarchyItem = {
    id?: string;
    title?: string;
    parent_id?: string;
};

export type EditorMeta = {
    zeus?: boolean;
    format?: string;
    schema_version?: number;
    editor?: string;
    created_at?: string;
    updated_at?: string;
};

export type DocumentDetail = {
    meta?: {
        id?: string;
        slug?: string;
        title?: string;
        parent_id?: string;
        extra?: {
            status?: string;
            tags?: string[];
            lock?: DocumentLockInfo;
            [key: string]: unknown;
        };
        doc_type?: string;
        parent?: string; // legacy support
    };
    body?: {
        type?: string;
        content?: {
            meta?: EditorMeta;
            content?: JSONContent;
        };
    };
    // Flattened accessors for convenience
    content?: {
        meta?: EditorMeta;
        content?: JSONContent;
    };
    id?: string;
    title?: string;
    parent_id?: string;
    storage_object_id?: string;
    doc_type?: string;
    hierarchy?: DocumentHierarchyItem[];
};

export type FilterDocumentItem = {
    id: string;
    title: string;
    slug: string;
    created_at: string;
    updated_at: string;
    extra: {
        doc_type?: string;
        generated_by?: string;
        source_doc_ids?: string[];
        knowledge_queries?: string[];
    };
};

export type FilterDocumentsParams = {
    generatedBy?: string;
    docType?: string;
    q?: string;
    limit?: number;
    containsBlockType?: string | string[];
};

export type CreateDocumentMeta = {
    id?: string;
    slug?: string;
    title: string;
    parent_id: string;
    extra?: {
        status?: string;
        tags?: string[];
        doc_type?: string;
        generated_by?: string;
        [key: string]: unknown;
    };
};

export type CreateDocumentBody = {
    type: string;
    content: { meta: EditorMeta; content: JSONContent } | JSONContent;
};

export type MoveDocumentInput = {
    target_parent_id: string;
    before_doc_id?: string;
    after_doc_id?: string;
};

export const fetchDocumentList = async (projectKey: string, parentId: string): Promise<DocumentListItem[]> => {
    const params = new URLSearchParams();
    if (parentId) {
        params.set("parent_id", parentId);
    }
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents?${params.toString()}`,
    );
    if (!response.ok) {
        throw new Error("Failed to load documents");
    }
    const payload = await response.json();
    return Array.isArray(payload?.data) ? payload.data : [];
};

export type DocumentTreeItem = {
    id: string;
    slug: string;
    title: string;
    kind: "file" | "dir";
    children?: DocumentTreeItem[];
};

export type FavoriteDocumentItem = {
    doc_id: string;
    title: string;
    favorited_at: string;
};

export type RecentEditedDocumentItem = {
    doc_id: string;
    title: string;
    edited_at: string;
};

export const fetchDocumentTree = async (projectKey: string): Promise<DocumentTreeItem[]> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/tree`,
    );
    if (!response.ok) {
        throw new Error("Failed to load document tree");
    }
    const payload = await response.json();
    return Array.isArray(payload?.data) ? payload.data : [];
};

export const syncProjectDocuments = async (projectKey: string): Promise<void> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/sync`,
        {
            method: "POST",
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to sync project documents");
    }
};

export const fetchFavoriteDocuments = async (
    projectKey: string,
): Promise<FavoriteDocumentItem[]> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/favorites`,
    );
    if (!response.ok) {
        throw new Error("Failed to load favorite documents");
    }
    const payload = await response.json();
    return Array.isArray(payload?.data) ? payload.data : [];
};

export const fetchRecentEditedDocuments = async (
    projectKey: string,
): Promise<RecentEditedDocumentItem[]> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/recent-edits`,
    );
    if (!response.ok) {
        throw new Error("Failed to load recent edited documents");
    }
    const payload = await response.json();
    return Array.isArray(payload?.data) ? payload.data : [];
};

export const favoriteDocument = async (
    projectKey: string,
    docId: string,
): Promise<FavoriteDocumentItem[]> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(docId)}/favorite`,
        {
            method: "PUT",
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to favorite document");
    }
    const payload = await response.json();
    return Array.isArray(payload?.data) ? payload.data : [];
};

export const unfavoriteDocument = async (
    projectKey: string,
    docId: string,
): Promise<FavoriteDocumentItem[]> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(docId)}/favorite`,
        {
            method: "DELETE",
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to unfavorite document");
    }
    const payload = await response.json();
    return Array.isArray(payload?.data) ? payload.data : [];
};

export const fetchDocument = async (projectKey: string, documentId: string): Promise<DocumentDetail> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(
            documentId,
        )}`,
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        throw toDocumentApiError(response, payload, "DOCUMENT_FETCH_FAILED", "failed to load document");
    }
    const payload = await response.json();
    return payload?.data ?? null;
};

export type UpdateDocumentContentInput = {
    title: string;
    content: JSONContent;
};

export const updateDocumentContent = async (
    projectKey: string,
    documentId: string,
    input: UpdateDocumentContentInput,
): Promise<DocumentDetail> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(documentId)}`,
        {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                meta: {
                    title: input.title,
                },
                body: {
                    type: "tiptap",
                    content: input.content,
                },
            }),
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        throw toDocumentApiError(response, payload, "DOCUMENT_UPDATE_FAILED", "save document failed");
    }
    const payload = await response.json().catch(() => null);
    return payload?.data ?? payload ?? null;
};

export const lockDocument = async (
    projectKey: string,
    documentId: string,
): Promise<DocumentLockInfo> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(documentId)}/lock`,
        {
            method: "PUT",
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        throw toDocumentApiError(response, payload, "DOCUMENT_LOCK_FAILED", "Failed to lock document");
    }
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const lock = payload?.data && typeof payload.data === "object"
        ? (payload.data as { lock?: unknown }).lock
        : null;
    if (!lock || typeof lock !== "object") {
        throw new DocumentApiError("Failed to lock document", response.status, "DOCUMENT_LOCK_FAILED");
    }
    const record = lock as Record<string, unknown>;
    return {
        locked: true,
        lockedBy: String(record.lockedBy ?? ""),
        lockedAt: String(record.lockedAt ?? ""),
    };
};

export const unlockDocument = async (
    projectKey: string,
    documentId: string,
): Promise<null> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(documentId)}/lock`,
        {
            method: "DELETE",
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        throw toDocumentApiError(response, payload, "DOCUMENT_UNLOCK_FAILED", "Failed to unlock document");
    }
    return null;
};

export const exportDocumentDocx = async (
    projectKey: string,
    documentId: string,
): Promise<Blob> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(
            documentId,
        )}/export-docx`,
        {
            method: "POST",
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to export Word document");
    }
    return response.blob();
};

export const filterDocuments = async (
    projectKey: string,
    params: FilterDocumentsParams = {},
): Promise<FilterDocumentItem[]> => {
    const query = new URLSearchParams();
    if (params.generatedBy) {
        query.set("generated_by", params.generatedBy);
    }
    if (params.docType) {
        query.set("doc_type", params.docType);
    }
    if (params.q) {
        query.set("q", params.q);
    }
    if (typeof params.limit === "number" && Number.isFinite(params.limit)) {
        query.set("limit", String(Math.trunc(params.limit)));
    }
    if (params.containsBlockType) {
        const normalized = Array.isArray(params.containsBlockType)
            ? params.containsBlockType.map((item) => String(item || "").trim()).filter(Boolean)
            : [String(params.containsBlockType || "").trim()].filter(Boolean);
        if (normalized.length > 0) {
            query.set("contains_block_type", normalized.join(","));
        }
    }

    const url = query.size > 0
        ? `/api/projects/${encodeProjectRef(projectKey)}/documents/filter?${query.toString()}`
        : `/api/projects/${encodeProjectRef(projectKey)}/documents/filter`;
    const response = await apiFetch(url);
    if (!response.ok) {
        throw new Error("Failed to filter documents");
    }
    const payload = await response.json().catch(() => null);
    return Array.isArray(payload?.data) ? payload.data as FilterDocumentItem[] : [];
};

export const fetchDocumentHierarchy = async (
    projectKey: string,
    documentId: string,
): Promise<DocumentHierarchyItem[]> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(
            documentId,
        )}/hierarchy`,
    );
    if (!response.ok) {
        throw new Error("failed to load document hierarchy");
    }
    const payload = await response.json();
    return Array.isArray(payload?.data) ? payload.data : [];
};

export const createDocument = async (
    projectKey: string,
    meta: CreateDocumentMeta,
    body: CreateDocumentBody,
): Promise<DocumentDetail> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                meta,
                body,
            }),
        },
    );
    if (!response.ok) {
        throw new Error("save document failed");
    }
    const payload = await response.json();
    return payload?.data ?? payload;
};

export const duplicateDocument = async (
    projectKey: string,
    docId: string,
): Promise<DocumentDetail> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(docId)}/duplicate`,
        {
            method: "POST",
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to duplicate document");
    }
    const payload = await response.json().catch(() => null);
    return payload?.data ?? payload ?? null;
};

export const moveDocument = async (
    projectKey: string,
    docId: string,
    input: MoveDocumentInput,
): Promise<void> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(docId)}/move`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        throw toDocumentApiError(response, payload, "DOCUMENT_MOVE_FAILED", "Failed to move document");
    }
};

export type DeleteDocumentResult = {
    deleted_ids: string[];
    count: number;
    trash_id?: string;
};

export const deleteDocument = async (
    projectKey: string,
    docId: string,
    recursive = true,
): Promise<DeleteDocumentResult> => {
    const params = new URLSearchParams();
    if (recursive) {
        params.set("recursive", "true");
    }
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(docId)}?${params.toString()}`,
        {
            method: "DELETE",
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        throw toDocumentApiError(response, payload, "DOCUMENT_DELETE_FAILED", "Failed to delete document");
    }
    const payload = await response.json();
    return payload?.data ?? { deleted_ids: [], count: 0 };
};

export type DocumentTrashItem = {
    trashId: string;
    rootDocId: string;
    title: string;
    entityType: "document" | "directory";
    originalPath: string;
    originalParentId: string;
    deletedAt: string;
    deletedBy: string;
    deletedIds: string[];
};

export type RestoreDocumentTrashResult = {
    root: DocumentDetail;
    fallback_to_root: boolean;
    restored_ids: string[];
};

export type DocumentTrashSnapshot = {
    rootDocId: string;
    docs: DocumentDetail[];
};

export const fetchDocumentTrash = async (
    projectKey: string,
): Promise<DocumentTrashItem[]> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/trash`,
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to load trash");
    }
    const payload = await response.json();
    const list = Array.isArray(payload?.data) ? payload.data : [];
    return list.map((item: Record<string, unknown>) => ({
        trashId: String(item?.trashId ?? ""),
        rootDocId: String(item?.rootDocId ?? ""),
        title: String(item?.title ?? ""),
        entityType: item?.entityType === "directory" ? "directory" : "document",
        originalPath: String(item?.originalPath ?? ""),
        originalParentId: String(item?.originalParentId ?? "root"),
        deletedAt: String(item?.deletedAt ?? ""),
        deletedBy: String(item?.deletedBy ?? ""),
        deletedIds: Array.isArray(item?.deletedIds)
            ? (item.deletedIds as unknown[]).map((id) => String(id)).filter(Boolean)
            : [],
    }));
};

export const restoreDocumentTrash = async (
    projectKey: string,
    trashId: string,
): Promise<RestoreDocumentTrashResult> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/trash/${encodeURIComponent(trashId)}/restore`,
        {
            method: "POST",
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to restore trash item");
    }
    const payload = await response.json();
    return payload?.data ?? {};
};

export const fetchDocumentTrashSnapshot = async (
    projectKey: string,
    trashId: string,
): Promise<DocumentTrashSnapshot> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/trash/${encodeURIComponent(trashId)}/snapshot`,
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to load trash snapshot");
    }
    const payload = await response.json().catch(() => null);
    const data = payload?.data ?? {};
    const docs = Array.isArray(data.docs) ? data.docs as DocumentDetail[] : [];
    return {
        rootDocId: String(data.root_doc_id ?? data.rootDocId ?? "").trim(),
        docs,
    };
};

export const purgeDocumentTrash = async (
    projectKey: string,
    trashId: string,
): Promise<{ purged: boolean }> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/trash/${encodeURIComponent(trashId)}`,
        {
            method: "DELETE",
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to purge trash item");
    }
    const payload = await response.json();
    return payload?.data ?? { purged: false };
};

export const purgeAllDocumentTrash = async (
    projectKey: string,
): Promise<{ count: number }> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/trash`,
        {
            method: "DELETE",
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to clear trash");
    }
    const payload = await response.json();
    return payload?.data ?? { count: 0 };
};

export const uploadDocument = async (
    projectKey: string,
    formData: FormData,
    parentId: string = "",
): Promise<void> => {
    const params = new URLSearchParams();
    if (parentId) {
        params.set("parent_id", parentId);
    }
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/upload?${params.toString()}`,
        {
            method: "POST",
            body: formData,
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Upload failed");
    }
};

export const importDocument = async (
  projectKey: string,
  formData: FormData,
): Promise<void> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/import`,
        {
            method: "POST",
            body: formData,
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Import failed");
    }
};

export type SmartImportType = "markdown" | "word" | "pdf" | "image";
export type FileTypeFilter = "all" | "images" | "office" | "text" | "markdown";

export type ImportFileMode = "smart" | "fallback";

export type ImportFileAsDocumentRequest = {
  parent_id?: string;
  title?: string;
  smart_import?: boolean;
  smart_import_types?: SmartImportType[];
  enable_format_optimize?: boolean;
};

export type ImportFileAsDocumentResult = {
  id: string;
  title: string;
  mode: ImportFileMode;
};

/**
 * Import a single file and create a document.
 * When smart import is enabled, the backend will parse the file content and
 * insert it into the created document; otherwise it will fall back to an asset-only doc.
 */
export const importFileAsDocument = async (
  projectKey: string,
  file: File,
  req: ImportFileAsDocumentRequest,
): Promise<ImportFileAsDocumentResult> => {
  const form = new FormData();
  form.append("file", file);
  if (req.parent_id) {
    form.append("parent_id", req.parent_id);
  }
  if (req.title) {
    form.append("title", req.title);
  }
  form.append("smart_import", req.smart_import ? "true" : "false");
  if (req.smart_import_types) {
    form.append("smart_import_types", JSON.stringify(req.smart_import_types));
  }
  form.append("enable_format_optimize", req.enable_format_optimize ? "true" : "false");

  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/documents/import-file`,
    {
      method: "POST",
      body: form,
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Import failed");
  }

  const payload = await response.json().catch(() => null);
  const data = payload?.data ?? payload ?? {};
  const mode = String(data.mode ?? "");
  return {
    id: String(data.id ?? ""),
    title: String(data.title ?? ""),
    mode: mode === "smart" ? "smart" : "fallback",
  };
};

export type ImportGitRequest = {
  repo_url: string;
  branch?: string;
  subdir?: string;
  parent_id?: string;
  submodule_parent_repo?: string;
  submodule_parent_branch?: string;
  submodule_path?: string;
  auto_import_submodules?: boolean;
  smart_import?: boolean;
  smart_import_types?: SmartImportType[];
  file_types?: FileTypeFilter[];
  // Enable format optimization using LLM (optional, fail-safe)
  enable_format_optimize?: boolean;
};

export type ImportGitTaskResponse = {
  taskId: string;
};

export type ImportFolderRequest = {
  parent_id?: string;
  smart_import?: boolean;
  smart_import_types?: SmartImportType[];
  enable_format_optimize?: boolean;
};

export type ImportFolderTaskResponse = {
  taskId: string;
};

export const createImportGitTask = async (
  projectKey: string,
  payload: ImportGitRequest,
): Promise<ImportGitTaskResponse> => {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/documents/import-git`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Git import failed");
  }
  const data = await response.json().catch(() => null);
  const result = data?.data ?? data ?? {};
  return { taskId: String(result.taskId ?? "") };
};

export const createImportFolderTask = async (
  projectKey: string,
  files: File[],
  payload: ImportFolderRequest,
): Promise<ImportFolderTaskResponse> => {
  const form = new FormData();
  for (const file of files) {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    form.append("files", file, relativePath && relativePath.trim() ? relativePath : file.name);
  }
  if (payload.parent_id) {
    form.append("parent_id", payload.parent_id);
  }
  form.append("smart_import", payload.smart_import ? "true" : "false");
  if (payload.smart_import_types && payload.smart_import_types.length > 0) {
    form.append("smart_import_types", JSON.stringify(payload.smart_import_types));
  }
  form.append("enable_format_optimize", payload.enable_format_optimize ? "true" : "false");

  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/documents/import-folder`,
    {
      method: "POST",
      body: form,
    },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Folder import failed");
  }
  const data = await response.json().catch(() => null);
  const result = data?.data ?? data ?? {};
  return { taskId: String(result.taskId ?? "") };
};

export type FetchUrlResult = {
  url: string;
  html: string;
  fetched_at: string;
};

export const fetchUrlHtml = async (
  projectKey: string,
  url: string,
): Promise<FetchUrlResult> => {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/documents/fetch-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Fetch URL failed");
  }
  const payload = await response.json();
  const data = payload?.data ?? payload ?? {};
  return {
    url: String(data.url ?? url),
    html: String(data.html ?? ""),
    fetched_at: String(data.fetched_at ?? ""),
  };
};

export type ProposalDiff = {
    metaDiff: string;
    contentDiff: string;
};

export const fetchProposalDiff = async (
    projectKey: string,
    documentId: string,
    proposalId: string,
): Promise<ProposalDiff> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(
            documentId,
        )}/proposals/${encodeURIComponent(proposalId)}/diff`,
    );
    if (!response.ok) {
        throw new Error("failed to load diff");
    }
    const payload = await response.json();
    const data = payload?.data ?? payload ?? {};
    return {
        metaDiff: String(data.meta_diff ?? ""),
        contentDiff: String(data.content_diff ?? ""),
    };
};

export const applyProposal = async (
    projectKey: string,
    documentId: string,
    proposalId: string,
): Promise<DocumentDetail> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(
            documentId,
        )}/proposals/${encodeURIComponent(proposalId)}/apply`,
        { method: "POST" },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        throw toDocumentApiError(response, payload, "PROPOSAL_APPLY_FAILED", "failed to apply proposal");
    }
    const payload = await response.json();
    return payload?.data ?? payload;
};

export const rejectProposal = async (
    projectKey: string,
    documentId: string,
    proposalId: string,
): Promise<void> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(
            documentId,
        )}/proposals/${encodeURIComponent(proposalId)}/reject`,
        { method: "POST" },
    );
    if (!response.ok) {
        throw new Error("failed to reject proposal");
    }
};

export type OptimizeFormatResult = {
    markdown: string;
    optimized: boolean;
};

/**
 * Optimize markdown format using LLM
 * This is a fail-safe API: if optimization fails, returns original markdown
 */
export const optimizeFormat = async (
    projectKey: string,
    markdown: string,
): Promise<OptimizeFormatResult> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/optimize-format`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ markdown }),
        },
    );
    if (!response.ok) {
        // Fail-safe: return original markdown if API fails
        console.warn("Format optimization failed, using original markdown");
        return { markdown, optimized: false };
    }
    const payload = await response.json();
    return {
        markdown: String(payload?.data?.markdown ?? markdown),
        optimized: Boolean(payload?.data?.optimized ?? false),
    };
};

/**
 * Document suggestion for @ mention autocomplete
 */
export type DocumentSuggestion = {
    id: string;
    title: string;
    titlePath: string;
    hasChildren: boolean;
};

/**
 * Get document suggestions matching a query
 * @param parentId - Optional: Only search children of this parent ("root" or "" for root level)
 */
export const suggestDocuments = async (
    projectKey: string,
    query: string,
    limit = 10,
    parentId?: string,
): Promise<DocumentSuggestion[]> => {
    const params = new URLSearchParams({
        q: query,
        limit: String(limit),
    });
    if (parentId !== undefined) {
        params.set("parentId", parentId);
    }
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/suggest?${params.toString()}`,
    );
    if (!response.ok) {
        console.warn("Document suggest failed");
        return [];
    }
    const payload = await response.json();
    const data = payload?.data;
    if (!Array.isArray(data)) return [];
    return data.map((item: Record<string, unknown>) => ({
        id: String(item.id ?? ""),
        title: String(item.title ?? ""),
        titlePath: String(item.titlePath ?? ""),
        hasChildren: Boolean(item.hasChildren),
    }));
};

/**
 * Update block attributes in a document (e.g., taskItem checked state)
 */
export const updateBlockAttrs = async (
    projectKey: string,
    docId: string,
    blockId: string,
    attrs: Record<string, unknown>,
): Promise<void> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(docId)}/blocks/${encodeURIComponent(blockId)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attrs }),
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        throw toDocumentApiError(response, payload, "BLOCK_UPDATE_FAILED", "Failed to update block attributes");
    }
};

export type CodeExecLanguage = "python" | "javascript" | "bash";

export type DocumentCodeRunResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    truncated: boolean;
    timedOut: boolean;
};

export type DocumentCodeRun = {
    runId: string;
    status: "queued" | "running" | "completed" | "failed" | "timeout";
    result: DocumentCodeRunResult;
};

export type RunDocumentCodeInput = {
    blockId: string;
    language: CodeExecLanguage;
    code: string;
    timeoutMs?: number;
};

export type ListDocumentCodeRunsInput = {
    blockId?: string;
    cursor?: string;
    limit?: number;
};

export type ListDocumentCodeRunsResult = {
    items: DocumentCodeRun[];
    nextCursor?: string;
};

export function buildCodeExecRunPath(projectKey: string, documentId: string): string {
    return `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(documentId)}/code-exec/run`;
}

function buildCodeExecRunsPath(
    projectKey: string,
    documentId: string,
    input?: ListDocumentCodeRunsInput,
): string {
    const params = new URLSearchParams();
    if (input?.blockId) {
        params.set("blockId", input.blockId);
    }
    if (input?.cursor) {
        params.set("cursor", input.cursor);
    }
    if (typeof input?.limit === "number" && Number.isFinite(input.limit)) {
        params.set("limit", String(Math.max(1, Math.floor(input.limit))));
    }
    const query = params.toString();
    const base = `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(documentId)}/code-exec/runs`;
    return query ? `${base}?${query}` : base;
}

export function mapDocumentCodeRun(raw: unknown): DocumentCodeRun {
    const node = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const result = (node.result && typeof node.result === "object"
        ? node.result
        : {}) as Record<string, unknown>;
    return {
        runId: String(node.runId ?? ""),
        status: String(node.status ?? "failed") as DocumentCodeRun["status"],
        result: {
            stdout: String(result.stdout ?? ""),
            stderr: String(result.stderr ?? ""),
            exitCode: Number(result.exitCode ?? 1),
            durationMs: Number(result.durationMs ?? 0),
            truncated: Boolean(result.truncated),
            timedOut: Boolean(result.timedOut),
        },
    };
}

export const runDocumentCodeBlock = async (
    projectKey: string,
    documentId: string,
    input: RunDocumentCodeInput,
): Promise<DocumentCodeRun> => {
    const response = await apiFetch(buildCodeExecRunPath(projectKey, documentId), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            blockId: input.blockId,
            language: input.language,
            code: input.code,
            timeoutMs: input.timeoutMs,
        }),
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        throw toDocumentApiError(response, payload, "CODE_EXEC_RUN_FAILED", "Failed to run code block");
    }
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    return mapDocumentCodeRun(payload?.data);
};

export const listDocumentCodeRuns = async (
    projectKey: string,
    documentId: string,
    input?: ListDocumentCodeRunsInput,
): Promise<ListDocumentCodeRunsResult> => {
    const response = await apiFetch(buildCodeExecRunsPath(projectKey, documentId, input));
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        throw toDocumentApiError(response, payload, "CODE_EXEC_LIST_FAILED", "Failed to list code runs");
    }
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const data = (payload?.data && typeof payload.data === "object"
        ? payload.data
        : {}) as Record<string, unknown>;
    const items = Array.isArray(data.items) ? data.items.map((item) => mapDocumentCodeRun(item)) : [];
    const nextCursor = String(data.nextCursor ?? "");
    return {
        items,
        nextCursor: nextCursor || undefined,
    };
};

export const getDocumentCodeRun = async (
    projectKey: string,
    documentId: string,
    runId: string,
): Promise<DocumentCodeRun> => {
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(documentId)}/code-exec/runs/${encodeURIComponent(runId)}`,
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        throw toDocumentApiError(response, payload, "CODE_EXEC_GET_FAILED", "Failed to get code run");
    }
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    return mapDocumentCodeRun(payload?.data);
};
