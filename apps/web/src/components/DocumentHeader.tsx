import { useState } from "react";
import { Link } from "react-router-dom";

type BreadcrumbItem = {
  label: string;
  to?: string;
};

const MAX_BREADCRUMB_LENGTH_CN = 7;
const MAX_BREADCRUMB_LENGTH_EN = 15;

// 检测字符串是否包含中文
function hasChinese(str: string): boolean {
  return /[\u4e00-\u9fff]/.test(str);
}

function truncateLabel(label: string): string {
  const maxLength = hasChinese(label) ? MAX_BREADCRUMB_LENGTH_CN : MAX_BREADCRUMB_LENGTH_EN;
  if (label.length <= maxLength) {
    return label;
  }
  return label.slice(0, maxLength) + "...";
}

type DocumentHeaderProps = {
  breadcrumbItems: BreadcrumbItem[];
  mode: "view" | "edit";
  showBreadcrumb?: boolean;
  showActions?: boolean;
  allowChildActions?: boolean;
  allowEdit?: boolean;
  allowDelete?: boolean;
  allowOptimize?: boolean;
  allowRefresh?: boolean;
  favorited?: boolean;
  favoriteLoading?: boolean;
  deleting?: boolean;
  refreshing?: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onNew: () => void;
  onImport: () => void;
  onDelete?: () => void;
  onExport?: () => void;
  onExportPPT?: () => void;
  onOptimize?: () => void;
  onRefresh?: () => void;
  onFavorite?: () => void;
  pluginMenuItems?: Array<{
    id: string;
    title: string;
    disabled?: boolean;
    onClick: () => void;
  }>;
};

function DocumentHeader({
  breadcrumbItems,
  mode,
  showBreadcrumb = true,
  showActions = true,
  allowChildActions = true,
  allowEdit = true,
  allowDelete = false,
  allowOptimize = false,
  allowRefresh = false,
  favorited = false,
  favoriteLoading = false,
  deleting = false,
  refreshing = false,
  onEdit,
  onSave,
  onCancel,
  onNew,
  onImport,
  onDelete,
  onExport,
  onExportPPT,
  onOptimize,
  onRefresh,
  onFavorite,
  pluginMenuItems = [],
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

  const handleExportPPT = () => {
    if (!onExportPPT) {
      return;
    }
    handleCloseMenu();
    onExportPPT();
  };

  const handleOptimize = () => {
    if (!onOptimize) {
      return;
    }
    handleCloseMenu();
    onOptimize();
  };

  const handlePluginMenuClick = (action: () => void) => {
    handleCloseMenu();
    action();
  };

  return (
    <div className="kb-main-header">
      {showBreadcrumb ? (
        <div className="kb-breadcrumb">
          {breadcrumbItems.map((item, index) => (
            <span key={`${item.label}-${index}`}>
              {index > 0 ? <span className="kb-breadcrumb-sep">/</span> : null}
              {item.to ? (
                <Link className="kb-breadcrumb-link" to={item.to} title={item.label}>
                  {truncateLabel(item.label)}
                </Link>
              ) : (
                <span className="kb-breadcrumb-plain" title={item.label}>
                  {truncateLabel(item.label)}
                </span>
              )}
            </span>
          ))}
        </div>
      ) : null}
      {showActions ? (
        <div className="kb-header-menu">
          {mode === "view" && onFavorite ? (
            <button
              className={`kb-favorite-button${favorited ? " active" : ""}`}
              type="button"
              aria-label={favorited ? "已收藏" : "收藏文档"}
              onClick={onFavorite}
              disabled={favoriteLoading || favorited}
              title={favorited ? "已收藏（请在左侧列表取消）" : "收藏文档"}
            >
              <span className="kb-favorite-icon" aria-hidden="true">
                {favorited ? "★" : "☆"}
              </span>
            </button>
          ) : null}
          {allowRefresh && onRefresh ? (
            <button
              className="kb-refresh-button"
              type="button"
              aria-label="刷新文档"
              onClick={onRefresh}
              disabled={refreshing}
              title="刷新文档"
            >
              <svg
                className={`kb-refresh-icon${refreshing ? " spinning" : ""}`}
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          ) : null}
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
                      导出 Markdown
                    </button>
                  ) : null}
                  {onExportPPT ? (
                    <button className="kb-menu-item" type="button" onClick={handleExportPPT}>
                      导出 PPT
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
                  {pluginMenuItems.map((item) => (
                    <button
                      key={item.id}
                      className="kb-menu-item"
                      type="button"
                      onClick={() => handlePluginMenuClick(item.onClick)}
                      disabled={item.disabled}
                    >
                      {item.title}
                    </button>
                  ))}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default DocumentHeader;
