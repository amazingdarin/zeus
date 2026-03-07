import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExportOutlined,
  FileAddOutlined,
  ImportOutlined,
  LockOutlined,
  RocketOutlined,
  SaveOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { Switch } from "antd";

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

type MenuItemButtonProps = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
};

function MenuItemButton({ label, icon, onClick, danger = false, disabled = false }: MenuItemButtonProps) {
  return (
    <button
      className={`kb-menu-item${danger ? " kb-menu-item-danger" : ""}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="kb-menu-item-left">
        <span className="kb-menu-item-icon">{icon}</span>
        <span className="kb-menu-item-label">{label}</span>
      </span>
    </button>
  );
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
  locked?: boolean;
  lockBusy?: boolean;
  onLockToggle?: () => void;
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
  locked = false,
  lockBusy = false,
  onLockToggle,
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
  const { t } = useTranslation("document");
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

  const handleLockToggle = () => {
    if (!onLockToggle) {
      return;
    }
    onLockToggle();
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
                {t("document.header.retry")}
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
                    {t("document.sync.viewLogs")}
                  </button>
                ) : null}
              </div>
              <button
                className="kb-sync-button"
                type="button"
                onClick={handleSync}
                disabled={syncDisabled}
              >
                {syncStatus === "syncing" ? t("document.sync.syncing") : t("document.sync.syncNow")}
              </button>
            </div>
          ) : null}
          <button
            className="kb-menu-button"
            type="button"
            aria-label={t("document.header.openMenu")}
            onClick={handleToggle}
          >
            ...
          </button>
          {menuOpen ? (
            <div className="kb-menu" role="menu">
              {mode === "edit" ? (
                <>
                  <MenuItemButton
                    label={t("document.menu.save")}
                    icon={<SaveOutlined />}
                    onClick={handleSave}
                  />
                  <MenuItemButton
                    label={t("document.menu.cancel")}
                    icon={<CloseOutlined />}
                    onClick={handleCancel}
                  />
                </>
              ) : (
                <>
                  {allowChildActions ? (
                    <MenuItemButton
                      label={t("document.menu.new")}
                      icon={<FileAddOutlined />}
                      onClick={handleNew}
                    />
                  ) : null}
                  {onDuplicate ? (
                    <MenuItemButton
                      label={t("document.menu.duplicate")}
                      icon={<CopyOutlined />}
                      onClick={handleDuplicate}
                    />
                  ) : null}
                  {allowChildActions ? (
                    <MenuItemButton
                      label={t("document.menu.import")}
                      icon={<ImportOutlined />}
                      onClick={handleImport}
                    />
                  ) : null}
                  {onExport ? (
                    <MenuItemButton
                      label={t("document.menu.export")}
                      icon={<ExportOutlined />}
                      onClick={handleExport}
                    />
                  ) : null}
                  {allowOptimize && onOptimize ? (
                    <MenuItemButton
                      label={t("document.menu.optimize")}
                      icon={<RocketOutlined />}
                      onClick={handleOptimize}
                    />
                  ) : null}
                  {onLockToggle ? (
                    <div className="kb-menu-item kb-menu-item-lock" role="menuitem">
                      <span className="kb-menu-item-left">
                        <span className="kb-menu-item-icon">
                          {locked ? <UnlockOutlined /> : <LockOutlined />}
                        </span>
                        <span className="kb-menu-item-label">
                          {locked ? t("document.menu.unlock") : t("document.menu.lock")}
                        </span>
                      </span>
                      <span className="kb-menu-item-right">
                        <Switch
                          size="small"
                          checked={locked}
                          loading={lockBusy}
                          onChange={handleLockToggle}
                          onClick={(_, event) => {
                            event.stopPropagation();
                          }}
                        />
                      </span>
                    </div>
                  ) : null}
                  {allowDelete && onDelete ? (
                    <MenuItemButton
                      label={deleting ? t("document.menu.deleting") : t("document.menu.moveToTrash")}
                      icon={<DeleteOutlined />}
                      onClick={handleDelete}
                      danger
                      disabled={deleting}
                    />
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
