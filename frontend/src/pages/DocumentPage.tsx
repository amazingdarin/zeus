import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import DocumentHeader from "../components/DocumentHeader";
import DocumentViewer from "../components/DocumentViewer";
import { buildApiUrl } from "../config/api";

type DocumentData = {
  id: string;
  title: string;
  type: string;
  storageObjectId: string;
  parentId: string;
};

type DocumentResponse = {
  data?: {
    id?: string;
    title?: string;
    type?: string;
    storage_object_id?: string;
    parent_id?: string;
  };
};

type DocumentPageProps = {
  projectKey: string;
  documentId: string | null;
};

type UploadedAsset = {
  asset_id: string;
  filename: string;
  mime: string;
  size: number;
};

type UploadedFolderAsset = {
  asset_id: string;
  filename: string;
  relative_path: string;
};

type ImportedAssetState = {
  projectKey: string;
  assets: Array<{
    asset_id: string;
    filename: string;
    relative_path?: string;
  }>;
};

function DocumentPage({ projectKey, documentId }: DocumentPageProps) {
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
  const [importStatus, setImportStatus] = useState<{
    type: "idle" | "success" | "error";
    message?: string;
  }>({ type: "idle" });
  const [importedAssets, setImportedAssets] = useState<ImportedAssetState | null>(null);

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

  useEffect(() => {
    if (!resolvedProjectKey) {
      setImportedAssets(null);
      return;
    }
    setImportedAssets((prev) =>
      prev && prev.projectKey === resolvedProjectKey
        ? prev
        : { projectKey: resolvedProjectKey, assets: [] },
    );
  }, [resolvedProjectKey]);

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

  const handleOpenImportWithMode = (mode: "file" | "folder") => {
    if (!allowChildActions) {
      return;
    }
    setImportMode(mode);
    setSelectedFiles([]);
    setUploading(false);
    setUploadTotal(0);
    setUploadCompleted(0);
    setImportStatus({ type: "idle" });
    setImportModalOpen(true);
  };

  const handleCloseImport = () => {
    setImportModalOpen(false);
    setUploading(false);
    setUploadTotal(0);
    setUploadCompleted(0);
    setImportStatus({ type: "idle" });
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
    setImportStatus({ type: "idle" });
  };

  // Uploads only create assets; document creation happens in a later step.
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
      setImportStatus({ type: "idle" });
      try {
        const uploaded = await uploadSingleFile(resolvedProjectKey, file);
        setImportedAssets((prev) => {
          if (!prev || prev.projectKey !== resolvedProjectKey) {
            return {
              projectKey: resolvedProjectKey,
              assets: [{ asset_id: uploaded.asset_id, filename: uploaded.filename }],
            };
          }
          return {
            projectKey: prev.projectKey,
            assets: [
              ...prev.assets,
              { asset_id: uploaded.asset_id, filename: uploaded.filename },
            ],
          };
        });
        setUploadCompleted(1);
        setImportStatus({ type: "success", message: "Upload completed." });
      } catch (err) {
        console.log("import_file_error", err);
        setImportStatus({ type: "error", message: "Upload failed." });
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
        const totalItems = selectedFiles.length;
        setUploading(true);
        setUploadTotal(totalItems);
        setUploadCompleted(0);
        setImportStatus({ type: "idle" });
        const uploadedItems = await uploadFolder(
          resolvedProjectKey,
          selectedFiles,
          (completed) => setUploadCompleted(completed),
        );
        setImportedAssets((prev) => {
          if (!prev || prev.projectKey !== resolvedProjectKey) {
            return {
              projectKey: resolvedProjectKey,
              assets: uploadedItems.map((item) => ({
                asset_id: item.asset_id,
                filename: item.filename,
                relative_path: item.relative_path,
              })),
            };
          }
          return {
            projectKey: prev.projectKey,
            assets: [
              ...prev.assets,
              ...uploadedItems.map((item) => ({
                asset_id: item.asset_id,
                filename: item.filename,
                relative_path: item.relative_path,
              })),
            ],
          };
        });
        setImportStatus({ type: "success", message: "Upload completed." });
      } catch (err) {
        console.log("import_folder_error", err);
        setImportStatus({ type: "error", message: "Upload failed." });
      } finally {
        setUploading(false);
        setUploadTotal(0);
        setUploadCompleted(0);
      }
    }

    setSelectedFiles([]);
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
        onUploadFile={() => handleOpenImportWithMode("file")}
        onUploadFolder={() => handleOpenImportWithMode("folder")}
      />
      <div className="doc-page-body">
        <div className="doc-page-title">{activeDocument.title}</div>
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
              <h2>Upload Assets</h2>
              <button className="modal-close" type="button" onClick={handleCloseImport}>
                Close
              </button>
            </div>
            <div className="modal-body">
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
                  <div className="kb-import-note">Uploads create assets only.</div>
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
                  <div className="kb-import-note">Uploads create assets only.</div>
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
              {importStatus.type !== "idle" ? (
                <div
                  className={`kb-import-status ${
                    importStatus.type === "error" ? "error" : "success"
                  }`}
                >
                  {importStatus.message}
                </div>
              ) : null}
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
                {importMode === "folder" && uploading ? `Upload ${uploadProgress}%` : "Upload"}
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

async function uploadSingleFile(
  projectKey: string,
  file: File,
): Promise<UploadedAsset> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("filename", file.name);
  formData.append("mime", file.type || "application/octet-stream");
  formData.append("size", String(file.size));

  const response = await fetch(
    buildApiUrl(`/api/projects/${encodeURIComponent(projectKey)}/assets/import`),
    {
      method: "POST",
      body: formData,
    },
  );
  if (!response.ok) {
    throw new Error("asset upload failed");
  }
  const payload = await response.json();
  const data = payload?.data ?? payload ?? {};
  const assetID = String(data.asset_id ?? "");
  if (!assetID) {
    throw new Error("missing asset id");
  }
  return {
    asset_id: assetID,
    filename: String(data.filename ?? file.name),
    mime: String(data.mime ?? file.type ?? "application/octet-stream"),
    size: Number(data.size ?? file.size ?? 0),
  };
}

async function uploadFolder(
  projectKey: string,
  files: File[],
  onProgress?: (completed: number, total: number) => void,
): Promise<UploadedFolderAsset[]> {
  const list = Array.from(files);
  const total = list.length;
  const results: UploadedFolderAsset[] = [];
  let completed = 0;

  for (const file of list) {
    const relativePath = normalizeRelativePath(
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name,
    );
    const uploaded = await uploadSingleFile(projectKey, file);
    results.push({
      asset_id: uploaded.asset_id,
      filename: uploaded.filename,
      relative_path: relativePath,
    });
    completed += 1;
    onProgress?.(completed, total);
  }

  return results;
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function createDocumentFromAssets(_assets: ImportedAssetState) {
  // TODO: Step 2 implement document creation from assets.
}
