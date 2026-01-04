import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import DocumentHeader from "../components/DocumentHeader";
import DocumentViewer from "../components/DocumentViewer";
import { buildApiUrl } from "../config/api";

type DocumentData = {
  id: string;
  title: string;
  description: string;
  type: string;
  storageObjectId: string;
  parentId: string;
};

type DocumentResponse = {
  data?: {
    id?: string;
    title?: string;
    description?: string;
    type?: string;
    storage_object_id?: string;
    parent_id?: string;
  };
};

type DocumentPageProps = {
  projectKey: string;
  documentId: string | null;
  onImportSuccess?: (parentId: string | null) => void;
};

type FileEntry = {
  file: File;
  relativePath: string;
  parentPath: string;
};

function DocumentPage({ projectKey, documentId, onImportSuccess }: DocumentPageProps) {
  const params = useParams<{ projectKey?: string; documentId?: string }>();
  const resolvedProjectKey = (params.projectKey || projectKey || "").trim();
  const resolvedDocumentId = (params.documentId || documentId || "").trim();
  const navigate = useNavigate();

  const [document, setDocument] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [breadcrumbItems, setBreadcrumbItems] = useState<
    Array<{ label: string; to?: string }>
  >([]);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<"file" | "folder">("file");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadCompleted, setUploadCompleted] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const activeDocument = document;
  const allowChildActions = activeDocument ? activeDocument.type !== "overview" : false;

  useEffect(() => {
    if (!resolvedProjectKey || !resolvedDocumentId) {
      setDocument(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const loadDocument = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          buildApiUrl(
            `/api/projects/${encodeURIComponent(resolvedProjectKey)}/documents/${encodeURIComponent(
              resolvedDocumentId,
            )}`,
          ),
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error("failed to load document");
        }
        const payload = (await response.json()) as DocumentResponse;
        const data = payload?.data ?? {};
        const mapped: DocumentData = {
          id: String(data.id ?? resolvedDocumentId),
          title: String(data.title ?? ""),
          description: String(data.description ?? ""),
          type: String(data.type ?? ""),
          storageObjectId: String(data.storage_object_id ?? ""),
          parentId: String(data.parent_id ?? ""),
        };
        setDocument(mapped);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
        setError((err as Error).message || "failed to load document");
        setDocument(null);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    loadDocument();
    return () => controller.abort();
  }, [resolvedDocumentId, resolvedProjectKey]);

  useEffect(() => {
    if (!resolvedProjectKey || !resolvedDocumentId) {
      setBreadcrumbItems([]);
      return;
    }
    const controller = new AbortController();
    const loadBreadcrumbs = async () => {
      try {
        const items = await fetchBreadcrumbChain(
          resolvedProjectKey,
          resolvedDocumentId,
          controller.signal,
        );
        const trimmed = trimBreadcrumbItems(items);
        setBreadcrumbItems(trimmed);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
        if (document) {
          setBreadcrumbItems([
            {
              label: document.title || "Document",
              to: `/knowledge?document_id=${encodeURIComponent(document.id)}`,
            },
          ]);
        } else {
          setBreadcrumbItems([{ label: "Document" }]);
        }
      }
    };
    loadBreadcrumbs();
    return () => controller.abort();
  }, [document, resolvedDocumentId, resolvedProjectKey]);

  const handleEdit = () => {
    if (!activeDocument) {
      return;
    }
    navigate(`/documents/new?document_id=${encodeURIComponent(activeDocument.id)}`);
  };

  const handleOpenNew = () => {
    if (!allowChildActions) {
      return;
    }
    const parentID = activeDocument?.id ?? "";
    const target = parentID
      ? `/documents/new?parent_id=${encodeURIComponent(parentID)}`
      : "/documents/new";
    navigate(target);
  };

  const handleOpenImport = () => {
    if (!allowChildActions) {
      return;
    }
    setImportMode("file");
    setSelectedFiles([]);
    setUploading(false);
    setUploadTotal(0);
    setUploadCompleted(0);
    setImportModalOpen(true);
  };

  const handleCloseImport = () => {
    setImportModalOpen(false);
    setUploading(false);
    setUploadTotal(0);
    setUploadCompleted(0);
  };

  const handleFilePick = () => {
    fileInputRef.current?.click();
  };

  const handleFolderPick = () => {
    folderInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    setSelectedFiles(files);
  };

  const uploadStorageObject = async (
    key: string,
    file: File,
    objectKey: string,
  ): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("source_type", "upload");
    formData.append("storage_type", "s3");
    formData.append("object_key", objectKey);
    if (file.type) {
      formData.append("mime_type", file.type);
    }
    const response = await fetch(
      buildApiUrl(`/api/projects/${encodeURIComponent(key)}/storage-objects`),
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
    key: string,
    title: string,
    parentID: string,
    storageObjectID: string,
  ) => {
    const response = await fetch(
      buildApiUrl(`/api/projects/${encodeURIComponent(key)}/documents`),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
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

  const buildFolderPaths = (files: File[]) => {
    const folders = new Set<string>();
    files.forEach((file) => {
      const rawPath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
      const normalizedPath = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
      const parts = normalizedPath.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i += 1) {
        folders.add(parts.slice(0, i).join("/"));
      }
    });
    return Array.from(folders).sort((a, b) => {
      const depthDiff = a.split("/").length - b.split("/").length;
      if (depthDiff !== 0) {
        return depthDiff;
      }
      return a.localeCompare(b);
    });
  };

  const buildFileEntries = (files: File[]): FileEntry[] =>
    files.map((file) => {
      const rawPath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
      const normalizedPath = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
      const parentPath = normalizedPath.split("/").slice(0, -1).join("/");
      return { file, relativePath: normalizedPath, parentPath };
    });

  const handleImportSubmit = async () => {
    if (!resolvedProjectKey) {
      console.log("import_missing_project");
      return;
    }

    if (importMode === "file") {
      const file = selectedFiles[0];
      if (!file) {
        console.log("import_file_empty");
        return;
      }
      setUploading(true);
      setUploadTotal(1);
      setUploadCompleted(0);
      try {
        const uploadPrefix = `doc/${Date.now()}`;
        const storageObjectID = await uploadStorageObject(
          resolvedProjectKey,
          file,
          `${uploadPrefix}/${file.name}`,
        );
        const documentPayload = await createDocumentRecord(
          resolvedProjectKey,
          file.name,
          activeDocument?.id ?? "",
          storageObjectID,
        );
        console.log("import_file_success", documentPayload);
        setUploadCompleted(1);
        onImportSuccess?.(activeDocument?.id ?? null);
      } catch (err) {
        console.log("import_file_error", err);
      } finally {
        setUploading(false);
        setUploadTotal(0);
        setUploadCompleted(0);
      }
    } else {
      if (selectedFiles.length === 0) {
        console.log("import_folder_empty");
        return;
      }
      try {
        const uploadPrefix = `doc/${Date.now()}`;
        const folderPaths = buildFolderPaths(selectedFiles);
        const fileEntries = buildFileEntries(selectedFiles);
        const totalItems = folderPaths.length + fileEntries.length;
        setUploading(true);
        setUploadTotal(totalItems);
        setUploadCompleted(0);
        const createdDocs = new Map<string, string>();
        for (const folderPath of folderPaths) {
          const parentPath = folderPath.split("/").slice(0, -1).join("/");
          const parentID = parentPath
            ? createdDocs.get(parentPath) ?? ""
            : activeDocument?.id ?? "";
          const folderName = folderPath.split("/").slice(-1)[0] ?? "Folder";
          const placeholderFile = new File([""], `${folderName}.dir`, {
            type: "application/x-directory",
          });
          const storageObjectID = await uploadStorageObject(
            resolvedProjectKey,
            placeholderFile,
            `${uploadPrefix}/${folderPath}/.dir`,
          );
          const documentPayload = await createDocumentRecord(
            resolvedProjectKey,
            folderName,
            parentID,
            storageObjectID,
          );
          const createdID = String(documentPayload?.data?.id ?? "");
          if (createdID) {
            createdDocs.set(folderPath, createdID);
          }
          setUploadCompleted((prev) => prev + 1);
        }

        for (const entry of fileEntries) {
          const parentID = entry.parentPath
            ? createdDocs.get(entry.parentPath) ?? ""
            : activeDocument?.id ?? "";
          const storageObjectID = await uploadStorageObject(
            resolvedProjectKey,
            entry.file,
            `${uploadPrefix}/${entry.relativePath}`,
          );
          await createDocumentRecord(
            resolvedProjectKey,
            entry.file.name,
            parentID,
            storageObjectID,
          );
          setUploadCompleted((prev) => prev + 1);
        }
        console.log("import_folder_success", {
          folders: folderPaths.length,
          files: fileEntries.length,
        });
        onImportSuccess?.(activeDocument?.id ?? null);
      } catch (err) {
        console.log("import_folder_error", err);
      } finally {
        setUploading(false);
        setUploadTotal(0);
        setUploadCompleted(0);
      }
    }

    setSelectedFiles([]);
    setImportModalOpen(false);
  };

  const handleModeChange = (nextMode: "file" | "folder") => {
    setImportMode(nextMode);
    setSelectedFiles([]);
    setUploading(false);
    setUploadTotal(0);
    setUploadCompleted(0);
  };

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (!folderInput) {
      return;
    }
    folderInput.setAttribute("webkitdirectory", "true");
    folderInput.setAttribute("directory", "true");
  }, []);

  useEffect(() => {
    if (!allowChildActions) {
      setImportModalOpen(false);
      setUploading(false);
      setUploadTotal(0);
      setUploadCompleted(0);
    }
  }, [allowChildActions]);

  const uploadProgress =
    uploadTotal > 0 ? Math.round((uploadCompleted / uploadTotal) * 100) : 0;

  if (!resolvedDocumentId) {
    return (
      <div className="doc-viewer-page">
        <div className="doc-viewer-state">
          Select a document from the left navigation to view its details.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="doc-viewer-page">
        <div className="doc-viewer-state">Loading document...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="doc-viewer-page">
        <div className="doc-viewer-error">{error}</div>
      </div>
    );
  }

  if (!activeDocument) {
    return <div className="doc-viewer-page" />;
  }

  return (
    <>
      <DocumentHeader
        breadcrumbItems={breadcrumbItems}
        mode="view"
        allowChildActions={allowChildActions}
        onEdit={handleEdit}
        onSave={() => {}}
        onCancel={() => {}}
        onNew={handleOpenNew}
        onImport={handleOpenImport}
      />
      <div className="doc-page-body">
        <div className="doc-page-title">{activeDocument.title}</div>
        <div className="doc-page-subtitle">
          {activeDocument.description || ""}
        </div>
        {activeDocument.storageObjectId ? (
          <DocumentViewer
            projectKey={resolvedProjectKey}
            storageObjectId={activeDocument.storageObjectId}
          />
        ) : (
          <div className="doc-viewer-state">No document available</div>
        )}
      </div>
      {importModalOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <h2>Import Document</h2>
              <button className="modal-close" type="button" onClick={handleCloseImport}>
                Close
              </button>
            </div>
            <div className="modal-body">
              <div className="kb-import-tabs" role="tablist">
                <button
                  className={`kb-import-tab${importMode === "file" ? " active" : ""}`}
                  type="button"
                  onClick={() => handleModeChange("file")}
                >
                  File
                </button>
                <button
                  className={`kb-import-tab${importMode === "folder" ? " active" : ""}`}
                  type="button"
                  onClick={() => handleModeChange("folder")}
                >
                  Folder
                </button>
              </div>
              {importMode === "file" ? (
                <div className="kb-import-panel">
                  <div className="kb-import-visual" aria-hidden="true">
                    <svg
                      className="kb-import-icon"
                      viewBox="0 0 48 48"
                      role="presentation"
                    >
                      <path
                        d="M12 6h16l8 8v28H12z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        d="M28 6v10h10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                  </div>
                  <div className="kb-import-title">Select a file to import</div>
                  <div className="kb-import-note">Supported for single document upload.</div>
                  <button className="btn ghost" type="button" onClick={handleFilePick}>
                    Choose file
                  </button>
                  <div className="kb-import-selection">
                    {selectedFiles[0]?.name ?? "No file selected"}
                  </div>
                </div>
              ) : (
                <div className="kb-import-panel">
                  <div className="kb-import-visual" aria-hidden="true">
                    <svg
                      className="kb-import-icon"
                      viewBox="0 0 48 48"
                      role="presentation"
                    >
                      <path
                        d="M6 16h14l4 4h18v20H6z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        d="M6 16v-6h12l4 4h20v6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                  </div>
                  <div className="kb-import-title">Select a folder to import</div>
                  <div className="kb-import-note">All documents inside will be imported.</div>
                  <button className="btn ghost" type="button" onClick={handleFolderPick}>
                    Choose folder
                  </button>
                  <div className="kb-import-selection">
                    {selectedFiles.length > 0
                      ? `${selectedFiles.length} files selected`
                      : "No folder selected"}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={handleCloseImport}>
                Cancel
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={handleImportSubmit}
                disabled={uploading}
              >
                {uploading ? <span className="kb-import-spinner" aria-hidden="true" /> : null}
                {importMode === "folder" && uploading ? `Import ${uploadProgress}%` : "Import"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        className="kb-file-input"
        type="file"
        onChange={handleFileChange}
      />
      <input
        ref={folderInputRef}
        className="kb-file-input"
        type="file"
        multiple
        onChange={handleFileChange}
      />
    </>
  );
}

export default DocumentPage;

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
  const payload = (await response.json()) as DocumentResponse;
  return payload?.data ?? null;
};

const fetchBreadcrumbChain = async (
  projectKey: string,
  documentId: string,
  signal: AbortSignal,
) => {
  const items: Array<{ id: string; label: string; parentId: string }> = [];
  const visited = new Set<string>();
  let currentId = documentId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const detail = await fetchDocumentDetail(projectKey, currentId, signal);
    if (!detail) {
      break;
    }
    const label = String(detail.title ?? "Document");
    const parentId = String(detail.parent_id ?? "");
    items.push({ id: currentId, label, parentId });
    if (!parentId) {
      break;
    }
    currentId = parentId;
  }

  return items
    .reverse()
    .map((item) => ({
      label: item.label,
      to: `/knowledge?document_id=${encodeURIComponent(item.id)}`,
    }));
};

const trimBreadcrumbItems = (items: Array<{ label: string; to?: string }>) => {
  if (items.length <= 4) {
    return items;
  }
  const head = items.slice(0, 2);
  const tail = items.slice(-2);
  return [...head, { label: "..." }, ...tail];
};
