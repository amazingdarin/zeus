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
    setImportModalOpen(true);
  };

  const handleCloseImport = () => {
    setImportModalOpen(false);
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
      const objectKey = `doc/${Date.now()}_${file.name}`;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source_type", "upload");
      formData.append("storage_type", "s3");
      formData.append("object_key", objectKey);
      if (file.type) {
        formData.append("mime_type", file.type);
      }
      try {
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
        const createResponse = await fetch(
          buildApiUrl(`/api/projects/${encodeURIComponent(projectKey)}/documents`),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: file.name,
              parent_id: parentDocumentId ?? "",
              storage_object_id: storageObjectID,
            }),
          },
        );
        if (!createResponse.ok) {
          throw new Error("create document failed");
        }
        const documentPayload = await createResponse.json();
        console.log("import_file_success", {
          storageObject: payload,
          document: documentPayload,
        });
        if (onImportSuccess) {
          onImportSuccess(parentDocumentId);
        }
      } catch (error) {
        console.log("import_file_error", error);
      }
    } else {
      console.log("import_folder_not_supported");
    }
    setSelectedFiles([]);
    setImportModalOpen(false);
  };

  const handleModeChange = (mode: "file" | "folder") => {
    setImportMode(mode);
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
      setNewModalOpen(false);
      setImportModalOpen(false);
    }
  }, [allowChildActions]);

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
              <button className="btn primary" type="button" onClick={handleImportSubmit}>
                Import
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
