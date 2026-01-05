import { useState } from "react";
import { Link } from "react-router-dom";

type BreadcrumbItem = {
  label: string;
  to?: string;
};

type DocumentHeaderProps = {
  breadcrumbItems: BreadcrumbItem[];
  mode: "view" | "edit";
  allowChildActions?: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onNew: () => void;
  onUploadFile: () => void;
  onUploadFolder: () => void;
};

function DocumentHeader({
  breadcrumbItems,
  mode,
  allowChildActions = true,
  onEdit,
  onSave,
  onCancel,
  onNew,
  onUploadFile,
  onUploadFolder,
}: DocumentHeaderProps) {
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);

  const toggleUploadMenu = () => {
    setUploadMenuOpen((prev) => {
      const next = !prev;
      if (next) {
        setActionMenuOpen(false);
      }
      return next;
    });
  };

  const toggleActionMenu = () => {
    setActionMenuOpen((prev) => {
      const next = !prev;
      if (next) {
        setUploadMenuOpen(false);
      }
      return next;
    });
  };

  const closeMenus = () => {
    setUploadMenuOpen(false);
    setActionMenuOpen(false);
  };

  const handleNew = () => {
    closeMenus();
    onNew();
  };

  const handleUploadFile = () => {
    closeMenus();
    onUploadFile();
  };

  const handleUploadFolder = () => {
    closeMenus();
    onUploadFolder();
  };

  const handleEdit = () => {
    closeMenus();
    onEdit();
  };

  const handleSave = () => {
    closeMenus();
    onSave();
  };

  const handleCancel = () => {
    closeMenus();
    onCancel();
  };

  return (
    <div className="kb-main-header">
      <div className="kb-breadcrumb">
        {breadcrumbItems.map((item, index) => (
          <span key={`${item.label}-${index}`}>
            {index > 0 ? <span className="kb-breadcrumb-sep">/</span> : null}
            {item.to ? (
              <Link className="kb-breadcrumb-link" to={item.to}>
                {item.label}
              </Link>
            ) : (
              <span className="kb-breadcrumb-plain">{item.label}</span>
            )}
          </span>
        ))}
      </div>
      <div className="kb-header-menu">
        {mode === "view" ? (
          <div className="kb-menu-group">
            <button
              className="kb-menu-button"
              type="button"
              aria-label="Upload"
              onClick={toggleUploadMenu}
            >
              +
            </button>
            {uploadMenuOpen ? (
              <div className="kb-menu" role="menu">
                <button className="kb-menu-item" type="button" onClick={handleUploadFile}>
                  Upload File
                </button>
                <button className="kb-menu-item" type="button" onClick={handleUploadFolder}>
                  Upload Folder
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="kb-menu-group">
          <button
            className="kb-menu-button"
            type="button"
            aria-label="Open menu"
            onClick={toggleActionMenu}
          >
            ...
          </button>
          {actionMenuOpen ? (
            <div className="kb-menu" role="menu">
              {mode === "edit" ? (
                <>
                  <button className="kb-menu-item" type="button" onClick={handleSave}>
                    Save
                  </button>
                  <button className="kb-menu-item" type="button" onClick={handleCancel}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {allowChildActions ? (
                    <button className="kb-menu-item" type="button" onClick={handleNew}>
                      New
                    </button>
                  ) : null}
                  <button className="kb-menu-item" type="button" onClick={handleEdit}>
                    Edit
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default DocumentHeader;
