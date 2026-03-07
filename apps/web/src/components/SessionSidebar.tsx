/**
 * SessionSidebar
 *
 * Left sidebar for chat session history, similar to document tree.
 * Supports new/switch/delete/rename sessions.
 * Toggled via controls in the chat header / sidebar.
 */

import { useState } from "react";
import { Button, Input, Popconfirm, Tooltip, Empty, Spin } from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  MessageOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from "@ant-design/icons";
import type { ChatSessionInfo } from "../api/chat-sessions";

type SessionSidebarProps = {
  sessions: ChatSessionInfo[];
  activeId: string | null;
  loading?: boolean;
  open?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onToggleOpen?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
};

function SessionSidebar({
  sessions,
  activeId,
  loading,
  open = true,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onToggleOpen,
  onLoadMore,
  hasMore,
}: SessionSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const startRename = (session: ChatSessionInfo) => {
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const confirmRename = () => {
    if (editingId && editTitle.trim()) {
      onRename(editingId, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle("");
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditTitle("");
  };

  return (
    <div className="session-sidebar">
      <div className="session-sidebar-header">
        <span className="session-sidebar-title">对话记录</span>
        <div className="session-sidebar-header-actions">
          <Tooltip title="新建对话">
            <button
              type="button"
              className="session-sidebar-new-btn"
              onClick={onNew}
              aria-label="新建对话"
            >
              <PlusOutlined />
            </button>
          </Tooltip>
          {onToggleOpen ? (
            <Tooltip title={open ? "隐藏对话记录" : "显示对话记录"}>
              <button
                type="button"
                className="session-sidebar-toggle-btn"
                onClick={onToggleOpen}
                aria-label={open ? "隐藏对话记录" : "显示对话记录"}
              >
                {open ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div className="session-sidebar-list">
        {loading ? (
          <div className="session-sidebar-loading"><Spin size="small" /></div>
        ) : sessions.length === 0 ? (
          <Empty description="暂无对话" image={Empty.PRESENTED_IMAGE_SIMPLE} className="session-sidebar-empty" />
        ) : (
          <>
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`session-sidebar-item${session.id === activeId ? " active" : ""}`}
                onClick={() => {
                  if (editingId !== session.id) onSelect(session.id);
                }}
              >
                {editingId === session.id ? (
                  <div className="session-sidebar-edit" onClick={(e) => e.stopPropagation()}>
                    <Input
                      size="small"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onPressEnter={confirmRename}
                      autoFocus
                    />
                    <Button size="small" type="text" icon={<CheckOutlined />} onClick={confirmRename} />
                    <Button size="small" type="text" icon={<CloseOutlined />} onClick={cancelRename} />
                  </div>
                ) : (
                  <>
                    <MessageOutlined className="session-sidebar-item-icon" />
                    <div className="session-sidebar-item-content">
                      <div className="session-sidebar-item-title">{session.title}</div>
                    </div>
                    <div className="session-sidebar-item-actions" onClick={(e) => e.stopPropagation()}>
                      <Tooltip title="重命名">
                        <button
                          type="button"
                          className="session-sidebar-action-btn"
                          onClick={() => startRename(session)}
                        >
                          <EditOutlined />
                        </button>
                      </Tooltip>
                      <Popconfirm
                        title="删除对话"
                        description="确定删除？此操作不可撤销。"
                        onConfirm={() => onDelete(session.id)}
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                      >
                        <Tooltip title="删除">
                          <button type="button" className="session-sidebar-action-btn danger">
                            <DeleteOutlined />
                          </button>
                        </Tooltip>
                      </Popconfirm>
                    </div>
                  </>
                )}
              </div>
            ))}
            {hasMore && onLoadMore && (
              <Button type="link" block size="small" onClick={onLoadMore} className="session-sidebar-load-more">
                加载更多
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default SessionSidebar;
