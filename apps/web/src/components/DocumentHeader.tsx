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
  allowEdit?: boolean;
  allowDelete?: boolean;
  allowRebuild?: boolean;
  rebuilding?: boolean;
  deleting?: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onNew: () => void;
  onImport: () => void;
  onDelete?: () => void;
  onRebuild?: () => void;
  onExport?: () => void;
};

function DocumentHeader({
  breadcrumbItems,
  mode,
  allowChildActions = true,
  allowEdit = true,
  allowDelete = false,
  allowRebuild = false,
  rebuilding = false,
  deleting = false,
  onEdit,
  onSave,
  onCancel,
  onNew,
  onImport,
  onDelete,
  onRebuild,
  onExport,
}: DocumentHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const handleToggle = () => {
    setMenuOpen((prev) => !prev);
  };

  const handleCloseMenu = () => {
    setMenuOpen(false);
  };

  const handleNew = () => {
    handleCloseMenu();
    onNew();
  };

  const handleImport = () => {
    handleCloseMenu();
    onImport();
  };

  const handleEdit = () => {
    handleCloseMenu();
    onEdit();
  };

  const handleSave = () => {
    handleCloseMenu();
    onSave();
  };

  const handleCancel = () => {
    handleCloseMenu();
    onCancel();
  };

  const handleDelete = () => {
    if (!onDelete) {
      return;
    }
    handleCloseMenu();
    onDelete();
  };

  const handleRebuild = () => {
    if (!onRebuild) {
      return;
    }
    onRebuild();
  };

  const handleExport = () => {
    if (!onExport) {
      return;
    }
    handleCloseMenu();
    onExport();
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
        {onRebuild ? (
          <button
            className="kb-rebuild-button"
            type="button"
            aria-label="Rebuild knowledge"
            onClick={handleRebuild}
            disabled={!allowRebuild || rebuilding}
          >
            {rebuilding ? (
              <span className="kb-doc-spinner" aria-hidden="true" />
            ) : (
              <svg
                className="kb-rebuild-icon"
                viewBox="0 0 24 24"
                role="presentation"
                aria-hidden="true"
              >
                <path
                  d="M4 12a8 8 0 0 1 13.66-5.66"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M17.5 3.8v4.2h4.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M20 12a8 8 0 0 1-13.66 5.66"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M6.5 20.2v-4.2H2.3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        ) : null}
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
                {allowEdit ? (
                  <button className="kb-menu-item" type="button" onClick={handleEdit}>
                    Edit
                  </button>
                ) : null}
                {allowChildActions ? (
                  <button className="kb-menu-item" type="button" onClick={handleImport}>
                    Import
                  </button>
                ) : null}
                {onExport ? (
                  <button className="kb-menu-item" type="button" onClick={handleExport}>
                    Export
                  </button>
                ) : null}
                {allowDelete && onDelete ? (
                  <button
                    className="kb-menu-item kb-menu-item-danger"
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? "Deleting..." : "Delete"}
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default DocumentHeader;
