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
  onImport: () => void;
};

function DocumentHeader({
  breadcrumbItems,
  mode,
  allowChildActions = true,
  onEdit,
  onSave,
  onCancel,
  onNew,
  onImport,
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
                <button className="kb-menu-item" type="button" onClick={handleEdit}>
                  Edit
                </button>
                {allowChildActions ? (
                  <button className="kb-menu-item" type="button" onClick={handleImport}>
                    Import
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
