import { apiFetch } from "../config/api";
import type { JSONContent } from "@tiptap/react";

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

export type CreateDocumentMeta = {
    id?: string;
    slug?: string;
    title: string;
    parent_id: string;
    extra?: {
        status?: string;
        tags?: string[];
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
        `/api/projects/${encodeURIComponent(projectKey)}/documents?${params.toString()}`,
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

export const fetchDocumentTree = async (projectKey: string): Promise<DocumentTreeItem[]> => {
    const response = await apiFetch(
        `/api/projects/${encodeURIComponent(projectKey)}/documents/tree`,
    );
    if (!response.ok) {
        throw new Error("Failed to load document tree");
    }
    const payload = await response.json();
    return Array.isArray(payload?.data) ? payload.data : [];
};

export const fetchDocument = async (projectKey: string, documentId: string): Promise<DocumentDetail> => {
    const response = await apiFetch(
        `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(
            documentId,
        )}`,
    );
    if (!response.ok) {
        throw new Error("failed to load document");
    }
    const payload = await response.json();
    return payload?.data ?? null;
};

export const fetchDocumentHierarchy = async (
    projectKey: string,
    documentId: string,
): Promise<DocumentHierarchyItem[]> => {
    const response = await apiFetch(
        `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(
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
        `/api/projects/${encodeURIComponent(projectKey)}/documents`,
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

export const moveDocument = async (
    projectKey: string,
    docId: string,
    input: MoveDocumentInput,
): Promise<void> => {
    const response = await apiFetch(
        `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(docId)}/move`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        },
    );
    if (!response.ok) {
        throw new Error("Failed to move document");
    }
};

export type DeleteDocumentResult = {
    deleted_ids: string[];
    count: number;
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
        `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(docId)}?${params.toString()}`,
        {
            method: "DELETE",
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to delete document");
    }
    const payload = await response.json();
    return payload?.data ?? { deleted_ids: [], count: 0 };
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
        `/api/projects/${encodeURIComponent(projectKey)}/documents/upload?${params.toString()}`,
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
        `/api/projects/${encodeURIComponent(projectKey)}/documents/import`,
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

export type ImportGitRequest = {
  repo_url: string;
  branch?: string;
  subdir?: string;
  parent_id?: string;
  smart_import?: boolean;
  smart_import_types?: SmartImportType[];
  file_types?: FileTypeFilter[];
  // Enable format optimization using LLM (optional, fail-safe)
  enable_format_optimize?: boolean;
};

export type ImportGitResult = {
  directories: number;
  files: number;
  skipped: number;
  converted: number;
  fallback: number;
};

export const importGit = async (
  projectKey: string,
  payload: ImportGitRequest,
): Promise<ImportGitResult> => {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/documents/import-git`,
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
  return {
    directories: Number(result.directories ?? 0),
    files: Number(result.files ?? 0),
    skipped: Number(result.skipped ?? 0),
    converted: Number(result.converted ?? 0),
    fallback: Number(result.fallback ?? 0),
  };
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
    `/api/projects/${encodeURIComponent(projectKey)}/documents/fetch-url`,
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
        `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(
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
        `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(
            documentId,
        )}/proposals/${encodeURIComponent(proposalId)}/apply`,
        { method: "POST" },
    );
    if (!response.ok) {
        throw new Error("failed to apply proposal");
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
        `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(
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
        `/api/projects/${encodeURIComponent(projectKey)}/documents/optimize-format`,
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
        `/api/projects/${encodeURIComponent(projectKey)}/documents/suggest?${params.toString()}`,
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
        `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(docId)}/blocks/${encodeURIComponent(blockId)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attrs }),
        },
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to update block attributes");
    }
};
