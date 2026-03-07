import {
  CheckCircleFilled,
  ClockCircleOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import type { ChatTaskStatus } from "../api/chat";

type TaskTodoListProps = {
  items: ChatTaskStatus[];
  loading?: boolean;
  storageKey?: string;
};

const statusLabelMap: Record<ChatTaskStatus["status"], string> = {
  pending: "待执行",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  skipped: "已跳过",
};

const statusIconMap: Record<ChatTaskStatus["status"], ReactNode> = {
  pending: <ClockCircleOutlined />,
  running: <LoadingOutlined spin />,
  completed: <CheckCircleFilled />,
  failed: <CheckCircleFilled />,
  skipped: <CheckCircleFilled />,
};

const loadExpandedDetailSet = (storageKey?: string): Set<string> => {
  if (!storageKey || typeof window === "undefined") {
    return new Set();
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string" && value.length > 0));
  } catch {
    return new Set();
  }
};

function TaskTodoList({ items, loading = false, storageKey }: TaskTodoListProps) {
  if (items.length === 0) return null;

  const [expandedDetailIds, setExpandedDetailIds] = useState<Set<string>>(() => loadExpandedDetailSet(storageKey));

  const orderedItems = [...items].sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return a.taskId.localeCompare(b.taskId);
  });

  const handledCount = orderedItems.filter(
    (item) => item.status === "completed" || item.status === "failed" || item.status === "skipped",
  ).length;

  const toggleDetail = useCallback((taskId: string) => {
    setExpandedDetailIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setExpandedDetailIds(loadExpandedDetailSet(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      if (expandedDetailIds.size === 0) {
        window.localStorage.removeItem(storageKey);
      } else {
        window.localStorage.setItem(storageKey, JSON.stringify(Array.from(expandedDetailIds)));
      }
    } catch {
      // Ignore localStorage persistence failures.
    }
  }, [expandedDetailIds, storageKey]);

  return (
    <div className="task-todo-list">
      <div className="task-todo-header">
        <span className="task-todo-title">任务清单</span>
        <span className="task-todo-summary">
          {handledCount}/{orderedItems.length} 已处理
          {loading ? " · 更新中" : ""}
        </span>
      </div>

      <ul className="task-todo-items">
        {orderedItems.map((item) => {
          const detail = item.error || item.message || "";
          const detailCollapsible = Boolean(detail) && (item.status === "failed" || item.status === "skipped");
          const detailExpanded = expandedDetailIds.has(item.taskId);
          return (
            <li
              key={item.taskId}
              className={`task-todo-item task-todo-item-${item.status}`}
            >
              <span className="task-todo-check" aria-hidden="true">
                {statusIconMap[item.status]}
              </span>
              <div className="task-todo-content">
                <div className="task-todo-main">
                  <span className="task-todo-index">{item.index}.</span>
                  <span className="task-todo-task-title">{item.title}</span>
                  <span className="task-todo-status-label">{statusLabelMap[item.status]}</span>
                </div>
                {detailCollapsible ? (
                  <div className="task-todo-detail-wrap">
                    <button
                      type="button"
                      className="task-todo-detail-toggle"
                      onClick={() => toggleDetail(item.taskId)}
                      aria-expanded={detailExpanded}
                    >
                      {detailExpanded ? "收起原因" : "查看原因"}
                    </button>
                    {detailExpanded ? (
                      <div className="task-todo-detail">{detail}</div>
                    ) : null}
                  </div>
                ) : detail ? (
                  <div className="task-todo-detail">{detail}</div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default TaskTodoList;
