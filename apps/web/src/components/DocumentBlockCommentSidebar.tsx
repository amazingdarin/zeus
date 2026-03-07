import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpOutlined, LinkOutlined, ReloadOutlined, UserOutlined } from "@ant-design/icons";

import type { DocumentBlockCommentThread } from "../api/documents";
import {
  resolveBlockCommentPopoverPosition,
  type BlockCommentAnchorRect,
} from "../features/document-page/block-comment-floating";

type DocumentBlockCommentSidebarProps = {
  visible: boolean;
  blockId: string | null;
  anchor: BlockCommentAnchorRect | null;
  threads: DocumentBlockCommentThread[];
  loading?: boolean;
  busy?: boolean;
  onClose?: () => void;
  onRefresh?: () => void;
  onCreateThread: (content: string) => Promise<void> | void;
  onReplyThread: (threadId: string, content: string) => Promise<void> | void;
  onToggleThreadStatus: (threadId: string, status: "open" | "resolved") => Promise<void> | void;
  onDeleteMessage: (messageId: string) => Promise<void> | void;
};

type PopoverSize = {
  width: number;
  height: number;
};

const DEFAULT_SIZE: PopoverSize = {
  width: 380,
  height: 360,
};

export default function DocumentBlockCommentSidebar({
  visible,
  blockId,
  anchor,
  threads,
  loading = false,
  busy = false,
  onClose,
  onRefresh,
  onCreateThread,
  onReplyThread,
  onToggleThreadStatus,
  onDeleteMessage,
}: DocumentBlockCommentSidebarProps) {
  const [draft, setDraft] = useState("");
  const [panelSize, setPanelSize] = useState<PopoverSize>(DEFAULT_SIZE);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const blockLabel = useMemo(() => String(blockId ?? "").trim(), [blockId]);
  const defaultOpenThread = useMemo(
    () => threads.find((item) => item.status === "open") ?? null,
    [threads],
  );

  const position = useMemo(() => {
    const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth || 0;
    const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight || 0;
    return resolveBlockCommentPopoverPosition({
      anchor,
      panel: panelSize,
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
      },
      margin: 12,
      topInset: 72,
    });
  }, [anchor, panelSize]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const measure = () => {
      const nextWidth = panel.offsetWidth || DEFAULT_SIZE.width;
      const nextHeight = panel.offsetHeight || DEFAULT_SIZE.height;
      setPanelSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) {
          return prev;
        }
        return {
          width: nextWidth,
          height: nextHeight,
        };
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [visible, threads.length]);

  useEffect(() => {
    if (!visible || !onClose) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (panelRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", handlePointerDown, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, [onClose, visible]);

  const handleSubmit = async () => {
    const content = draft.trim();
    if (!content) {
      return;
    }
    if (defaultOpenThread) {
      await onReplyThread(defaultOpenThread.id, content);
    } else {
      await onCreateThread(content);
    }
    setDraft("");
  };

  if (!visible) {
    return null;
  }

  return (
    <div
      ref={panelRef}
      className="doc-page-comment-popover"
      aria-label="文档块评论弹窗"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
      }}
    >
      {blockLabel ? (
        <div className="doc-page-comment-popover-context">
          {blockLabel}
        </div>
      ) : null}

      <div className="doc-page-comment-popover-list">
        {loading ? <div className="doc-page-comment-empty">加载中...</div> : null}
        {!loading && threads.length === 0 ? (
          <div className="doc-page-comment-empty">当前块暂无评论</div>
        ) : null}
        {!loading
          ? threads.map((thread) => {
            return (
              <div className="doc-page-comment-thread" key={thread.id}>
                <div className="doc-page-comment-thread-head">
                  <span className={`doc-page-comment-thread-status ${thread.status === "resolved" ? "resolved" : "open"}`}>
                    {thread.status === "resolved" ? "已解决" : "进行中"}
                  </span>
                  <button
                    type="button"
                    className="doc-page-comment-text-btn"
                    disabled={busy}
                    onClick={() => {
                      void onToggleThreadStatus(thread.id, thread.status === "resolved" ? "open" : "resolved");
                    }}
                  >
                    {thread.status === "resolved" ? "重开" : "解决"}
                  </button>
                </div>
                <div className="doc-page-comment-messages">
                  {thread.messages.map((message) => (
                    <div className="doc-page-comment-message" key={message.id}>
                      <div className="doc-page-comment-message-meta">
                        <span>{message.authorId || "unknown"}</span>
                        <span>{message.createdAt || ""}</span>
                      </div>
                      <div className="doc-page-comment-message-content">{message.content}</div>
                      <button
                        type="button"
                        className="doc-page-comment-text-btn"
                        disabled={busy}
                        onClick={() => {
                          void onDeleteMessage(message.id);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
          : null}
      </div>
      <div className="doc-page-comment-popover-compose-inline">
        <div className="doc-page-comment-compose-avatar" aria-hidden>
          我
        </div>
        <input
          className="doc-page-comment-popover-input"
          placeholder="添加评论..."
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSubmit();
            }
          }}
        />
        <div className="doc-page-comment-compose-tools">
          <button className="doc-page-comment-compose-tool" type="button" title="附加链接" disabled>
            <LinkOutlined />
          </button>
          <button className="doc-page-comment-compose-tool" type="button" title="提及成员" disabled>
            <UserOutlined />
          </button>
          {onRefresh ? (
            <button
              className="doc-page-comment-compose-tool"
              type="button"
              title="刷新评论"
              onClick={onRefresh}
              disabled={busy}
            >
              <ReloadOutlined />
            </button>
          ) : null}
          <button
            className="doc-page-comment-compose-send"
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => {
              void handleSubmit();
            }}
            title="发送评论"
          >
            <ArrowUpOutlined />
          </button>
        </div>
      </div>
    </div>
  );
}
