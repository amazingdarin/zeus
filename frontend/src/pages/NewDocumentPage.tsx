import { useEffect, useMemo, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { useNavigate, useSearchParams } from "react-router-dom";

import RichTextEditor from "../components/RichTextEditor";
import { buildApiUrl } from "../config/api";
import { useProjectContext } from "../context/ProjectContext";
import {
  exportContentJson,
  type ContentMetaInput,
} from "../utils/exportContentJson";

function NewDocumentPage() {
  const { currentProject } = useProjectContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [content, setContent] = useState<JSONContent | null>(null);
  const [title, setTitle] = useState("Untitled Document");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [parentID, setParentID] = useState("");
  const [storageObjectID, setStorageObjectID] = useState("");
  const [contentMeta, setContentMeta] = useState<ContentMetaInput>(null);

  const parentIdParam = useMemo(() => {
    return (searchParams.get("parent_id") || "").trim();
  }, [searchParams]);
  const documentIdParam = useMemo(() => {
    return (searchParams.get("document_id") || "").trim();
  }, [searchParams]);

  const contentPayload = useMemo(() => {
    return exportContentJson(
      content ?? { type: "doc", content: [] },
      contentMeta,
    );
  }, [content, contentMeta]);

  useEffect(() => {
    setDocumentId(documentIdParam);
    if (!documentIdParam) {
      setParentID(parentIdParam);
      setStorageObjectID("");
      setContent(null);
      setContentMeta(null);
      setSaveError(null);
      return;
    }
    if (!currentProject?.key) {
      return;
    }

    const controller = new AbortController();
    const loadDocument = async () => {
      setLoadingDocument(true);
      try {
        const detail = await fetchDocumentDetail(
          currentProject.key,
          documentIdParam,
          controller.signal,
        );
        if (!detail) {
          return;
        }
        const metaValue = detail?.meta;
        if (metaValue) {
          const contentValue = detail?.content ?? {};
          setTitle(String(metaValue.title ?? "Untitled Document"));
          const parentId = String(metaValue.parent ?? "").trim();
          setParentID(parentId);
          const contentMetaValue =
            typeof contentValue.meta === "object" ? contentValue.meta : null;
          const documentContent = contentValue.content;
          if (documentContent && typeof documentContent === "object") {
            setContent(documentContent);
          }
          setContentMeta(contentMetaValue);
          setStorageObjectID("");
        } else {
          setTitle(String(detail?.title ?? "Untitled Document"));
          const parentId = String(detail?.parent_id ?? "").trim();
          setParentID(parentId);
          const storageId = String(detail?.storage_object_id ?? "").trim();
          setStorageObjectID(storageId);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setSaveError("Failed to load document.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingDocument(false);
        }
      }
    };

    loadDocument();
    return () => controller.abort();
  }, [currentProject?.key, documentIdParam, parentIdParam]);

  useEffect(() => {
    if (!currentProject?.key || !storageObjectID) {
      return;
    }
    const controller = new AbortController();
    const loadContent = async () => {
      try {
        const download = await fetchStorageDownload(
          currentProject.key,
          storageObjectID,
          controller.signal,
        );
        if (!download) {
          return;
        }
        const response = await fetch(download, { signal: controller.signal });
        if (!response.ok) {
          throw new Error("failed to load document content");
        }
        const text = await response.text();
        const parsed = parseEditorPayload(text);
        if (parsed) {
          setContent(parsed.content);
          setContentMeta(parsed.meta ?? null);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setSaveError("Failed to load document content.");
        }
      }
    };

    loadContent();
    return () => controller.abort();
  }, [currentProject?.key, storageObjectID]);
  const handleSave = async () => {
    const projectKey = currentProject?.key ?? "";
    if (!projectKey) {
      setSaveError("Project is required before saving.");
      return;
    }
    setSaveError(null);
    setSaving(true);

    try {
      const payloadForSave = exportContentJson(
        content ?? { type: "doc", content: [] },
        contentMeta,
      );
      let documentPayload;
      const safeSlug = sanitizeFileName(title);
      const meta = {
        id: documentId || undefined,
        slug: safeSlug || undefined,
        title: title.trim(),
        parent: (parentID || parentIdParam || "root").trim(),
        path: safeSlug ? `/${safeSlug}` : "",
        status: "draft",
        tags: [],
      };
      if (documentId) {
        documentPayload = await updateDocumentRecord(
          projectKey,
          documentId,
          meta,
          payloadForSave,
        );
      } else {
        documentPayload = await createDocumentRecord(
          projectKey,
          meta,
          payloadForSave,
        );
      }
      const targetID = String(
        documentPayload?.data?.meta?.id ?? documentPayload?.data?.id ?? documentId ?? "",
      );
      if (targetID) {
        const query = new URLSearchParams({ document_id: targetID });
        const parentValue = parentID || parentIdParam;
        if (parentValue) {
          query.set("parent_id", parentValue);
        }
        navigate(`/knowledge?${query.toString()}`);
      }
      setContentMeta(payloadForSave.meta);
      console.log("document_saved", documentPayload);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save document.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="new-doc-page">
      <div className="new-doc-header">
        <button className="btn primary" type="button" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {saveError ? <div className="doc-viewer-error">{saveError}</div> : null}
      {loadingDocument ? (
        <div className="doc-viewer-state">Loading document...</div>
      ) : null}
      <div className="new-doc-metadata">
        <input
          className="kb-title-input new-doc-title-input"
          type="text"
          value={title}
          placeholder="Document title"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <RichTextEditor content={content} onChange={setContent} />
      <div className="new-doc-json">
        <div className="new-doc-json-title">Document JSON</div>
        <pre>{JSON.stringify(contentPayload, null, 2)}</pre>
      </div>
    </div>
  );
}

export default NewDocumentPage;

const createDocumentRecord = async (
  projectKey: string,
  meta: {
    id?: string;
    slug?: string;
    title: string;
    parent: string;
    path?: string;
    status?: string;
    tags?: string[];
  },
  content: { meta: EditorMeta; content: JSONContent },
) => {
  const response = await fetch(
    buildApiUrl(`/api/projects/${encodeURIComponent(projectKey)}/documents`),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meta,
        content,
      }),
    },
  );
  if (!response.ok) {
    throw new Error("create document failed");
  }
  return response.json();
};

const updateDocumentRecord = async (
  projectKey: string,
  documentId: string,
  meta: {
    title: string;
    parent: string;
    path?: string;
    status?: string;
    tags?: string[];
  },
  content: { meta: EditorMeta; content: JSONContent },
) => {
  const response = await fetch(
    buildApiUrl(
      `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(
        documentId,
      )}`,
    ),
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meta,
        content,
      }),
    },
  );
  if (!response.ok) {
    throw new Error("update document failed");
  }
  return response.json();
};

const sanitizeFileName = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  const cleaned = trimmed.replace(/[^a-z0-9-_]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 48);
};

const fetchDocumentDetail = async (
  projectKey: string,
  documentId: string,
  signal: AbortSignal,
) => {
  const response = await fetch(
    buildApiUrl(
      `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(
        documentId,
      )}`,
    ),
    { signal },
  );
  if (!response.ok) {
    throw new Error("failed to load document");
  }
  const payload = (await response.json()) as {
    data?: {
      meta?: {
        id?: string;
        slug?: string;
        title?: string;
        parent?: string;
        path?: string;
        status?: string;
        tags?: string[];
      };
      content?: {
        meta?: EditorMeta;
        content?: JSONContent;
      };
      id?: string;
      title?: string;
      parent_id?: string;
      storage_object_id?: string;
    };
  };
  return payload?.data ?? null;
};

const fetchStorageDownload = async (
  projectKey: string,
  storageObjectID: string,
  signal: AbortSignal,
) => {
  const response = await fetch(
    buildApiUrl(
      `/api/projects/${encodeURIComponent(projectKey)}/storage-objects/${encodeURIComponent(
        storageObjectID,
      )}`,
    ),
    { signal },
  );
  if (!response.ok) {
    throw new Error("failed to load storage object");
  }
  const payload = (await response.json()) as {
    download?: { url?: string };
  };
  return payload?.download?.url ?? "";
};

type EditorMeta = {
  zeus?: boolean;
  format?: string;
  schema_version?: number;
  editor?: string;
  created_at?: string;
  updated_at?: string;
};

type EditorPayload = {
  meta?: EditorMeta;
  content?: JSONContent;
} & JSONContent;

const parseEditorPayload = (raw: string) => {
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as EditorPayload;
    if (parsed.meta?.zeus && parsed.meta.format === "tiptap" && parsed.content) {
      return {
        meta: parsed.meta,
        content: parsed.content,
      };
    }
    if (parsed.type === "doc") {
      return {
        content: parsed,
      };
    }
    if (parsed.content?.type === "doc") {
      return {
        content: parsed.content,
      };
    }
    return null;
  } catch {
    return null;
  }
};
