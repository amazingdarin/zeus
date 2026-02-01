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
  allowOptimize?: boolean;
  deleting?: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onNew: () => void;
  onImport: () => void;
  onDelete?: () => void;
  onExport?: () => void;
  onOptimize?: () => void;
};

function DocumentHeader({
  breadcrumbItems,
  mode,
  allowChildActions = true,
  allowEdit = true,
  allowDelete = false,
  allowOptimize = false,
  deleting = false,
  onEdit,
  onSave,
  onCancel,
  onNew,
  onImport,
  onDelete,
  onExport,
  onOptimize,
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

  const handleExport = () => {
    if (!onExport) {
      return;
    }
    handleCloseMenu();
    onExport();
  };

  const handleOptimize = () => {
    if (!onOptimize) {
      return;
    }
    handleCloseMenu();
    onOptimize();
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
          aria-label="打开菜单"
          onClick={handleToggle}
        >
          ...
        </button>
        {menuOpen ? (
          <div className="kb-menu" role="menu">
            {mode === "edit" ? (
              <>
                <button className="kb-menu-item" type="button" onClick={handleSave}>
                  保存
                </button>
                <button className="kb-menu-item" type="button" onClick={handleCancel}>
                  取消
                </button>
              </>
            ) : (
              <>
                {allowChildActions ? (
                  <button className="kb-menu-item" type="button" onClick={handleNew}>
                    新建
                  </button>
                ) : null}
                {allowEdit ? (
                  <button className="kb-menu-item" type="button" onClick={handleEdit}>
                    编辑
                  </button>
                ) : null}
                {allowChildActions ? (
                  <button className="kb-menu-item" type="button" onClick={handleImport}>
                    导入
                  </button>
                ) : null}
                {onExport ? (
                  <button className="kb-menu-item" type="button" onClick={handleExport}>
                    导出
                  </button>
                ) : null}
                {allowOptimize && onOptimize ? (
                  <button className="kb-menu-item" type="button" onClick={handleOptimize}>
                    优化
                  </button>
                ) : null}
                {allowDelete && onDelete ? (
                  <button
                    className="kb-menu-item kb-menu-item-danger"
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? "删除中..." : "删除"}
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
