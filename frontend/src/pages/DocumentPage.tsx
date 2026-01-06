import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { JSONContent } from "@tiptap/react";
import { useNavigate, useParams } from "react-router-dom";

import DocumentHeader from "../components/DocumentHeader";
import RichTextViewer from "../components/RichTextViewer";
import { buildApiUrl } from "../config/api";

type DocumentData = {
  id: string;
  title: string;
  docType: string;
  parentId: string;
  content: JSONContent | null;
};

type DocumentMetaInfo = {
  id: string;
  title: string;
  docType: string;
  parentId: string;
};

type DocumentResponse = {
  data?: {
    meta?: {
      id?: string;
      title?: string;
      parent?: string;
      doc_type?: string;
    };
    content?: DocumentContentPayload;
    id?: string;
    title?: string;
    parent_id?: string;
    doc_type?: string;
  };
};

type DocumentContentPayload =
  | {
      meta?: Record<string, unknown>;
      content?: JSONContent;
    }
  | JSONContent
  | null;

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

type AssetKindResult = {
  kind: string;
  openapi_version?: string;
};

type UploadedFolderAsset = {
  asset_id: string;
  filename: string;
  relative_path: string;
};

type OpenApiCreatedDocument = {
  id: string;
  title: string;
  assetId: string;
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
  const [openApiDocs, setOpenApiDocs] = useState<OpenApiCreatedDocument[]>([]);
  const [importedAssets, setImportedAssets] = useState<ImportedAssetState | null>(null);
  const importedAssetCount = importedAssets?.assets.length ?? 0;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const loadRequestRef = useRef<string | null>(null);

  const activeDocument = document;
  const allowChildActions = activeDocument ? activeDocument.docType !== "overview" : true;

  useEffect(() => {
    if (!resolvedProjectKey || !resolvedDocumentId) {
      setDocument(null);
      setLoading(false);
      setError(null);
      loadRequestRef.current = null;
      return;
    }

    const controller = new AbortController();
    const requestKey = `${resolvedProjectKey}:${resolvedDocumentId}`;
    if (loadRequestRef.current === requestKey) {
      return () => controller.abort();
    }
    loadRequestRef.current = requestKey;
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
        const mapped = mapDocumentDetail(payload?.data, resolvedDocumentId);
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
        if (loadRequestRef.current === requestKey) {
          loadRequestRef.current = null;
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
    if (!document || document.id !== resolvedDocumentId) {
      return;
    }
    const controller = new AbortController();
    const loadBreadcrumbs = async () => {
      try {
        const items = await fetchBreadcrumbChain(
          resolvedProjectKey,
          document,
          controller.signal,
        );
        const trimmed = trimBreadcrumbItems(items);
        setBreadcrumbItems(trimmed);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
        setBreadcrumbItems([
          {
            label: document.title || "Document",
            to: `/knowledge?document_id=${encodeURIComponent(document.id)}`,
          },
        ]);
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
    setOpenApiDocs([]);
    setImportModalOpen(true);
  };

  const handleCloseImport = () => {
    setImportModalOpen(false);
    setUploading(false);
    setUploadTotal(0);
    setUploadCompleted(0);
    setImportStatus({ type: "idle" });
    setOpenApiDocs([]);
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

  const handleModeChange = (nextMode: "file" | "folder") => {
    setImportMode(nextMode);
    setSelectedFiles([]);
    setUploading(false);
    setUploadTotal(0);
    setUploadCompleted(0);
    setImportStatus({ type: "idle" });
    setOpenApiDocs([]);
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
        const kindResult = await fetchAssetKind(resolvedProjectKey, uploaded.asset_id);
        if (kindResult.kind === "openapi") {
          const created = await createOpenApiDocument(
            resolvedProjectKey,
            activeDocument?.id ?? "",
            uploaded.filename,
            uploaded.asset_id,
          );
          setOpenApiDocs([created]);
          setImportStatus({
            type: "success",
            message: `Created OpenAPI document: ${created.title}`,
          });
        } else {
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
          setImportStatus({ type: "success", message: "Upload completed." });
        }
        setUploadCompleted(1);
        setImportModalOpen(false);
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
        const parentId = activeDocument?.id ?? "";
        const { assets: uploadedItems, openapiDocs: createdDocs } =
          await uploadFolderWithOpenApi(
            resolvedProjectKey,
            selectedFiles,
            parentId,
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
        if (createdDocs.length > 0) {
          setOpenApiDocs(createdDocs);
          setImportStatus({
            type: "success",
            message: `Created ${createdDocs.length} OpenAPI document(s).`,
          });
        } else {
          setImportStatus({ type: "success", message: "Upload completed." });
        }
        setImportModalOpen(false);
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

  const bodyContent = () => {
    if (!resolvedDocumentId) {
      return (
        <div className="doc-viewer-state">
          Select a document from the left navigation to view its details.
        </div>
      );
    }
    if (loading) {
      return <div className="doc-viewer-state">Loading document...</div>;
    }
    if (error) {
      return <div className="doc-viewer-error">{error}</div>;
    }
    if (!activeDocument) {
      return <div className="doc-viewer-state">No document available</div>;
    }
    return (
      <div className="doc-page-body">
        <div className="doc-page-title">{activeDocument.title}</div>
        {activeDocument.content ? (
          <RichTextViewer
            content={activeDocument.content}
            projectKey={resolvedProjectKey}
          />
        ) : (
          <div className="doc-viewer-state">No document content</div>
        )}
      </div>
    );
  };

  return (
    <>
      <DocumentHeader
        breadcrumbItems={breadcrumbItems}
        mode="view"
        allowChildActions={allowChildActions}
        allowEdit={Boolean(activeDocument)}
        onEdit={handleEdit}
        onSave={() => {}}
        onCancel={() => {}}
        onNew={handleOpenNew}
        onImport={() => handleOpenImportWithMode("file")}
      />
      <div className="doc-viewer-page">{bodyContent()}</div>
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
              {openApiDocs.length > 0 ? (
                <div className="kb-import-summary">
                  {openApiDocs.map((doc) => (
                    <div key={doc.assetId} className="kb-import-summary-item">
                      Created OpenAPI document: {doc.title}
                    </div>
                  ))}
                </div>
              ) : null}
              {importedAssetCount > 0 ? (
                <div className="kb-import-summary">
                  <div className="kb-import-summary-item">
                    Imported assets queued: {importedAssetCount}
                  </div>
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
  return mapDocumentMeta(payload?.data, documentId);
};

const fetchBreadcrumbChain = async (
  projectKey: string,
  document: DocumentData,
  signal: AbortSignal,
) => {
  const items: Array<{ id: string; label: string; parentId: string }> = [];
  const visited = new Set<string>();
  let currentId = document.parentId;

  items.push({
    id: document.id,
    label: document.title || "Document",
    parentId: document.parentId,
  });

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const detail = await fetchDocumentDetail(projectKey, currentId, signal);
    if (!detail) {
      break;
    }
    const label = detail.title || "Document";
    const parentId = detail.parentId;
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

function mapDocumentMeta(data: DocumentResponse["data"], fallbackId: string): DocumentMetaInfo {
  const meta = data?.meta ?? {};
  const id = String(meta.id ?? data?.id ?? fallbackId ?? "").trim();
  const title = String(meta.title ?? data?.title ?? "").trim();
  const docType = String(meta.doc_type ?? data?.doc_type ?? "").trim() || "document";
  const parentId = String(meta.parent ?? data?.parent_id ?? "").trim();
  return {
    id,
    title,
    docType,
    parentId,
  };
}

function mapDocumentDetail(data: DocumentResponse["data"], fallbackId: string): DocumentData {
  const meta = mapDocumentMeta(data, fallbackId);
  const content = extractContentNode(data?.content);
  return {
    ...meta,
    content,
  };
}

function extractContentNode(content?: DocumentContentPayload): JSONContent | null {
  if (!content || typeof content !== "object") {
    return null;
  }
  const maybeContent = (content as { content?: JSONContent }).content;
  if (maybeContent && typeof maybeContent === "object") {
    return maybeContent as JSONContent;
  }
  const direct = content as JSONContent;
  if (direct && typeof direct === "object" && "type" in direct) {
    return direct as JSONContent;
  }
  return null;
}

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

async function fetchAssetKind(
  projectKey: string,
  assetID: string,
): Promise<AssetKindResult> {
  const response = await fetch(
    buildApiUrl(
      `/api/projects/${encodeURIComponent(projectKey)}/assets/${encodeURIComponent(
        assetID,
      )}/kind`,
    ),
  );
  if (!response.ok) {
    throw new Error("asset kind lookup failed");
  }
  const payload = await response.json();
  const data = payload?.data ?? payload ?? {};
  return {
    kind: String(data.kind ?? "generic"),
    openapi_version: typeof data.openapi_version === "string" ? data.openapi_version : "",
  };
}

async function createOpenApiDocument(
  projectKey: string,
  parentId: string,
  filename: string,
  assetId: string,
): Promise<OpenApiCreatedDocument> {
  const title = stripExtension(filename) || filename;
  const payload = {
    meta: {
      title,
      parent: parentId,
      doc_type: "openapi",
    },
    openapi: {
      source: `storage://${assetId}`,
      renderer: "swagger",
    },
  };

  const response = await fetch(
    buildApiUrl(`/api/projects/${encodeURIComponent(projectKey)}/documents`),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error("failed to create OpenAPI document");
  }
  const data = await response.json();
  const meta = data?.data?.meta ?? data?.data ?? {};
  return {
    id: String(meta.id ?? ""),
    title: String(meta.title ?? title),
    assetId,
  };
}

async function uploadFolderWithOpenApi(
  projectKey: string,
  files: File[],
  parentId: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<{ assets: UploadedFolderAsset[]; openapiDocs: OpenApiCreatedDocument[] }> {
  const list = Array.from(files);
  const total = list.length;
  const assets: UploadedFolderAsset[] = [];
  const openapiDocs: OpenApiCreatedDocument[] = [];
  let completed = 0;

  for (const file of list) {
    const relativePath = normalizeRelativePath(
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name,
    );
    const uploaded = await uploadSingleFile(projectKey, file);
    const kindResult = await fetchAssetKind(projectKey, uploaded.asset_id);
    if (kindResult.kind === "openapi") {
      const created = await createOpenApiDocument(
        projectKey,
        parentId,
        uploaded.filename,
        uploaded.asset_id,
      );
      openapiDocs.push(created);
    } else {
      assets.push({
        asset_id: uploaded.asset_id,
        filename: uploaded.filename,
        relative_path: relativePath,
      });
    }
    completed += 1;
    onProgress?.(completed, total);
  }

  return { assets, openapiDocs };
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function stripExtension(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) {
    return "";
  }
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0) {
    return trimmed;
  }
  return trimmed.slice(0, lastDot);
}

function createDocumentFromAssets(_assets: ImportedAssetState) {
  // TODO: Step 2 implement document creation from assets.
}
