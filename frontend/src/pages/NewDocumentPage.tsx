import { useEffect, useMemo, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { useNavigate, useSearchParams } from "react-router-dom";

import RichTextEditor from "../components/RichTextEditor";
import { buildApiUrl } from "../config/api";
import { useProjectContext } from "../context/ProjectContext";

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

  const parentIdParam = useMemo(() => {
    return (searchParams.get("parent_id") || "").trim();
  }, [searchParams]);
  const documentIdParam = useMemo(() => {
    return (searchParams.get("document_id") || "").trim();
  }, [searchParams]);

  const payload = {
    meta: {
      zeus: true,
      format: "tiptap",
    },
    title,
    content,
    parent_id: parentID || parentIdParam,
  };

  useEffect(() => {
    setDocumentId(documentIdParam);
    if (!documentIdParam) {
      setParentID(parentIdParam);
      setStorageObjectID("");
      setContent(null);
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
        setTitle(String(detail.title ?? "Untitled Document"));
        const parentId = String(detail.parent_id ?? "").trim();
        setParentID(parentId);
        const storageId = String(detail.storage_object_id ?? "").trim();
        setStorageObjectID(storageId);
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
          if (parsed.title) {
            setTitle(parsed.title);
          }
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
      const safeName = sanitizeFileName(title) || "untitled";
      const fileName = `${safeName}.json`;
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const file = new File([blob], fileName, { type: "application/json" });
      const uploadPrefix = `doc/${Date.now()}`;
      const storageObjectID = await uploadStorageObject(
        projectKey,
        file,
        `${uploadPrefix}/${fileName}`,
      );
      let documentPayload;
      if (documentId) {
        documentPayload = await updateDocumentRecord(
          projectKey,
          documentId,
          title,
          parentID || parentIdParam,
          storageObjectID,
        );
      } else {
        documentPayload = await createDocumentRecord(
          projectKey,
          title,
          parentID || parentIdParam,
          storageObjectID,
        );
      }
      const targetID = String(documentPayload?.data?.id ?? documentId ?? "");
      if (targetID) {
        const query = new URLSearchParams({ document_id: targetID });
        const parentValue = parentID || parentIdParam;
        if (parentValue) {
          query.set("parent_id", parentValue);
        }
        navigate(`/knowledge?${query.toString()}`);
      }
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
        <pre>{JSON.stringify(payload, null, 2)}</pre>
      </div>
    </div>
  );
}

export default NewDocumentPage;

const uploadStorageObject = async (
  projectKey: string,
  file: File,
  objectKey: string,
): Promise<string> => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("source_type", "upload");
  formData.append("storage_type", "s3");
  formData.append("object_key", objectKey);
  formData.append("mime_type", file.type || "application/json");
  const response = await fetch(
    buildApiUrl(`/api/projects/${encodeURIComponent(projectKey)}/storage-objects`),
    {
      method: "POST",
      body: formData,
    },
  );
  if (!response.ok) {
    throw new Error("upload failed");
  }
  const payload = await response.json();
  const storageObjectID = String(payload?.id ?? "");
  if (!storageObjectID) {
    throw new Error("missing storage object id");
  }
  return storageObjectID;
};

const createDocumentRecord = async (
  projectKey: string,
  docTitle: string,
  parentID: string,
  storageObjectID: string,
) => {
  const response = await fetch(
    buildApiUrl(`/api/projects/${encodeURIComponent(projectKey)}/documents`),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: docTitle,
        parent_id: parentID,
        storage_object_id: storageObjectID,
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
  docTitle: string,
  parentID: string,
  storageObjectID: string,
) => {
  const response = await fetch(
    buildApiUrl(
      `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(
        documentId,
      )}`,
    ),
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: docTitle,
        parent_id: parentID,
        storage_object_id: storageObjectID,
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
  const payload = (await response.json()) as { data?: Record<string, unknown> };
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

type EditorPayload = {
  meta?: {
    zeus?: boolean;
    format?: string;
  };
  title?: string;
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
        title: parsed.title,
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
