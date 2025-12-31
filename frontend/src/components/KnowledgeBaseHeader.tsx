import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { buildApiUrl } from "../config/api";

type KnowledgeBaseHeaderProps = {
  title?: string;
  allowChildActions?: boolean;
  projectKey?: string | null;
  parentDocumentId?: string | null;
  onImportSuccess?: (parentId: string | null) => void;
};

function KnowledgeBaseHeader({
  title = "Knowledge Base",
  allowChildActions = true,
  projectKey = null,
  parentDocumentId = null,
  onImportSuccess,
}: KnowledgeBaseHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<"file" | "folder">("file");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadCompleted, setUploadCompleted] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const handleToggle = () => {
    setMenuOpen((prev) => !prev);
  };

  const handleSelect = () => {
    setMenuOpen(false);
  };

  const handleNew = () => {
    if (!allowChildActions) {
      return;
    }
    setMenuOpen(false);
    setImportModalOpen(false);
    setNewModalOpen(true);
  };

  const handleCloseModal = () => {
    setNewModalOpen(false);
  };

  const handleImport = () => {
    if (!allowChildActions) {
      return;
    }
    setMenuOpen(false);
    setNewModalOpen(false);
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

  const handleImportSubmit = async () => {
    if (importMode === "file") {
      const file = selectedFiles[0];
      if (!file) {
        console.log("import_file_empty");
        return;
      }
      if (!projectKey) {
        console.log("import_file_missing_project");
        return;
      }
      setUploading(true);
      setUploadTotal(1);
      setUploadCompleted(0);
      try {
        const uploadPrefix = `doc/${Date.now()}`;
        const storageObjectID = await uploadStorageObject(
          projectKey,
          file,
          `${uploadPrefix}/${file.name}`,
        );
        const documentPayload = await createDocumentRecord(
          projectKey,
          file.name,
          parentDocumentId ?? "",
          storageObjectID,
        );
        console.log("import_file_success", documentPayload);
        setUploadCompleted(1);
        onImportSuccess?.(parentDocumentId);
      } catch (error) {
        console.log("import_file_error", error);
      } finally {
        setUploading(false);
        setUploadTotal(0);
        setUploadCompleted(0);
      }
    } else {
      if (!projectKey) {
        console.log("import_folder_missing_project");
        return;
      }
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
            : parentDocumentId ?? "";
          const folderName = folderPath.split("/").slice(-1)[0] ?? "Folder";
          const placeholderFile = new File([""], `${folderName}.dir`, {
            type: "application/x-directory",
          });
          const storageObjectID = await uploadStorageObject(
            projectKey,
            placeholderFile,
            `${uploadPrefix}/${folderPath}/.dir`,
          );
          const documentPayload = await createDocumentRecord(
            projectKey,
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
            : parentDocumentId ?? "";
          const storageObjectID = await uploadStorageObject(
            projectKey,
            entry.file,
            `${uploadPrefix}/${entry.relativePath}`,
          );
          await createDocumentRecord(
            projectKey,
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
        onImportSuccess?.(parentDocumentId);
      } catch (error) {
        console.log("import_folder_error", error);
      } finally {
        setUploading(false);
        setUploadTotal(0);
        setUploadCompleted(0);
      }
    }
    setSelectedFiles([]);
    setImportModalOpen(false);
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

  const buildFileEntries = (files: File[]) =>
    files.map((file) => {
      const rawPath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
      const normalizedPath = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
      const parentPath = normalizedPath.split("/").slice(0, -1).join("/");
      return { file, relativePath: normalizedPath, parentPath };
    });

  const handleModeChange = (mode: "file" | "folder") => {
    setImportMode(mode);
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
      setNewModalOpen(false);
      setImportModalOpen(false);
      setUploading(false);
      setUploadTotal(0);
      setUploadCompleted(0);
    }
  }, [allowChildActions]);

  const uploadProgress =
    uploadTotal > 0 ? Math.round((uploadCompleted / uploadTotal) * 100) : 0;

  return (
    <div className="kb-main-header">
      <div className="kb-breadcrumb">{title}</div>
      <div className="kb-header-menu">
        <button
          className="kb-menu-button"
          type="button"
          aria-label="Open menu"
          onClick={handleToggle}
        >
          ...
        </button>
        {menuOpen ? (
          <div className="kb-menu" role="menu">
            {allowChildActions ? (
              <button className="kb-menu-item" type="button" onClick={handleNew}>
                New
              </button>
            ) : null}
            <button className="kb-menu-item" type="button" onClick={handleSelect}>
              Edit
            </button>
            {allowChildActions ? (
              <button className="kb-menu-item" type="button" onClick={handleImport}>
                Import
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {newModalOpen ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <h2>New Document</h2>
              <button className="modal-close" type="button" onClick={handleCloseModal}>
                Close
              </button>
            </div>
            <div className="modal-body">
              <label className="modal-field" htmlFor="kb-new-doc-title">
                <span>Title</span>
                <input
                  id="kb-new-doc-title"
                  name="title"
                  type="text"
                  placeholder="Enter document title"
                />
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" type="button" onClick={handleCloseModal}>
                Cancel
              </button>
              <button className="btn primary" type="button" onClick={handleCloseModal}>
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
                {importMode === "folder" && uploading
                  ? `Import ${uploadProgress}%`
                  : "Import"}
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
    </div>
  );
}

export default KnowledgeBaseHeader;
