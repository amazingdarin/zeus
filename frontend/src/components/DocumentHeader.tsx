import { useState } from "react";
import type { ChangeEvent } from "react";

type DocumentHeaderProps = {
  title: string;
  description: string;
  mode: "view" | "edit";
  allowChildActions?: boolean;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onNew: () => void;
  onImport: () => void;
};

function DocumentHeader({
  title,
  description,
  mode,
  allowChildActions = true,
  onTitleChange,
  onDescriptionChange,
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

  const handleTitleInput = (event: ChangeEvent<HTMLInputElement>) => {
    onTitleChange(event.target.value);
  };

  const handleDescriptionInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onDescriptionChange(event.target.value);
  };

  return (
    <div className="kb-main-header">
      <div className="kb-header-title">
        {mode === "edit" ? (
          <input
            className="kb-title-input"
            type="text"
            value={title}
            placeholder="Untitled document"
            onChange={handleTitleInput}
          />
        ) : (
          <div className="kb-breadcrumb">{title}</div>
        )}
        {mode === "edit" ? (
          <textarea
            className="kb-description-input"
            value={description}
            placeholder="Add a short description"
            rows={2}
            onChange={handleDescriptionInput}
          />
        ) : (
          <div className="doc-viewer-description">
            {description || "No description"}
          </div>
        )}
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
