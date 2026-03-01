import { useState } from "react";
import { Link } from "react-router-dom";

type BreadcrumbItem = {
  label: string;
  to?: string;
};

export type DocumentSyncStatus = "idle" | "syncing" | "synced" | "failed";
export type DocumentEditorSaveStatus = "draft" | "idle" | "dirty" | "saving" | "error";

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
  allowDelete?: boolean;
  allowOptimize?: boolean;
  deleting?: boolean;
  syncStatus?: DocumentSyncStatus;
  syncError?: string | null;
  syncDisabled?: boolean;
  editorSaveStatus?: DocumentEditorSaveStatus;
  editorSaveError?: string | null;
  onSave: () => void;
  onCancel: () => void;
  onNew: () => void;
  onImport: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onExport?: () => void;
  onOptimize?: () => void;
  onSync?: () => void;
  onViewSyncLogs?: () => void;
  onRetryEditorSave?: () => void;
};

export function mapEditorSaveBadge(status: DocumentEditorSaveStatus): string {
  if (status === "draft") {
    return "草稿";
  }
  if (status === "saving") {
    return "保存中";
  }
  if (status === "error") {
    return "保存失败";
  }
  if (status === "dirty") {
    return "待保存";
  }
  return "已保存";
}

function DocumentHeader({
  breadcrumbItems,
  mode,
  showBreadcrumb = true,
  showActions = true,
  allowChildActions = true,
  allowDelete = false,
  allowOptimize = false,
  deleting = false,
  syncStatus = "idle",
  syncError = null,
  syncDisabled = false,
  editorSaveStatus = "idle",
  editorSaveError = null,
  onSave,
  onCancel,
  onNew,
  onImport,
  onDelete,
  onDuplicate,
  onExport,
  onOptimize,
  onSync,
  onViewSyncLogs,
  onRetryEditorSave,
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

  const handleDuplicate = () => {
    if (!onDuplicate) {
      return;
    }
    handleCloseMenu();
    onDuplicate();
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

  const handleSync = () => {
    if (!onSync) {
      return;
    }
    handleCloseMenu();
    onSync();
  };

  const handleViewSyncLogs = () => {
    if (!onViewSyncLogs) {
      return;
    }
    onViewSyncLogs();
  };

  const syncStatusLabel = (() => {
    switch (syncStatus) {
      case "syncing":
        return "同步中";
      case "synced":
        return "已同步";
      case "failed":
        return "同步失败";
      default:
        return "待同步";
    }
  })();
  const editorSaveLabel = mapEditorSaveBadge(editorSaveStatus);

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
          <div className="kb-editor-save-group">
            <span
              className={`kb-editor-save-badge kb-editor-save-badge-${editorSaveStatus}`}
              title={editorSaveStatus === "error" && editorSaveError ? editorSaveError : undefined}
            >
              {editorSaveLabel}
            </span>
            {editorSaveStatus === "error" && onRetryEditorSave ? (
              <button
                className="kb-editor-save-retry"
                type="button"
                onClick={onRetryEditorSave}
              >
                重试
              </button>
            ) : null}
          </div>
          {onSync ? (
            <div className="kb-sync-group">
              <div className="kb-sync-meta">
                <span
                  className={`kb-sync-status kb-sync-status-${syncStatus}`}
                  title={syncStatus === "failed" && syncError ? syncError : undefined}
                >
                  {syncStatusLabel}
                </span>
                {syncStatus === "failed" && syncError ? (
                  <span className="kb-sync-error" title={syncError}>
                    {syncError}
                  </span>
                ) : null}
                {syncStatus === "failed" && onViewSyncLogs ? (
                  <button
                    className="kb-sync-log-link"
                    type="button"
                    onClick={handleViewSyncLogs}
                  >
                    查看最近同步日志
                  </button>
                ) : null}
              </div>
              <button
                className="kb-sync-button"
                type="button"
                onClick={handleSync}
                disabled={syncDisabled}
              >
                {syncStatus === "syncing" ? "同步中..." : "立即同步"}
              </button>
            </div>
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
                  {onDuplicate ? (
                    <button className="kb-menu-item" type="button" onClick={handleDuplicate}>
                      创建副本
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
      ) : null}
    </div>
  );
}

export default DocumentHeader;
