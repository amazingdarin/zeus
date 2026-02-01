/**
 * Document Optimization Modal
 *
 * Allows users to optimize document format and content using LLM.
 */

import { useState, useCallback, useRef, useEffect, memo } from "react";
import type { JSONContent } from "@tiptap/react";
import ReactMarkdown from "react-markdown";

import {
  startOptimize,
  createOptimizeStream,
  parseOptimizeEvent,
  type OptimizeMode,
  type OptimizeResult,
} from "../api/optimize";

// ============================================================================
// Types
// ============================================================================

type DocumentOptimizeModalProps = {
  isOpen: boolean;
  projectKey: string;
  docId: string;
  docTitle: string;
  onClose: () => void;
  onApply: (optimizedContent: JSONContent) => void;
};

type OptimizeStatus = "idle" | "loading" | "streaming" | "completed" | "error";

// ============================================================================
// Mode Configuration
// ============================================================================

const MODES: { value: OptimizeMode; label: string; description: string }[] = [
  {
    value: "format",
    label: "格式优化",
    description: "规范标题层级、列表格式、代码块标记",
  },
  {
    value: "content",
    label: "内容优化",
    description: "改善语言表达、增强逻辑连贯性",
  },
  {
    value: "full",
    label: "全面优化",
    description: "同时进行格式和内容优化",
  },
];

// ============================================================================
// Component
// ============================================================================

function DocumentOptimizeModal({
  isOpen,
  projectKey,
  docId,
  docTitle,
  onClose,
  onApply,
}: DocumentOptimizeModalProps) {
  const [mode, setMode] = useState<OptimizeMode>("full");
  const [status, setStatus] = useState<OptimizeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [result, setResult] = useState<OptimizeResult | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  // Cleanup on unmount or close
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus("idle");
      setError(null);
      setStreamingContent("");
      setResult(null);
    }
  }, [isOpen]);

  const handleStartOptimize = useCallback(async () => {
    if (!projectKey || !docId) return;

    setStatus("loading");
    setError(null);
    setStreamingContent("");
    setResult(null);

    try {
      // Start the optimization task
      const { taskId } = await startOptimize(projectKey, docId, { mode });

      if (!taskId) {
        throw new Error("Failed to get task ID");
      }

      setStatus("streaming");

      // Create SSE connection
      const source = createOptimizeStream(projectKey, docId, taskId);
      eventSourceRef.current = source;

      source.addEventListener("optimize.delta", (event) => {
        const data = parseOptimizeEvent((event as MessageEvent).data);
        if (data.content) {
          setStreamingContent((prev) => prev + data.content);
        }
      });

      source.addEventListener("optimize.done", (event) => {
        const data = parseOptimizeEvent((event as MessageEvent).data);
        setResult({
          originalMarkdown: data.originalMarkdown || "",
          optimizedMarkdown: data.optimizedMarkdown || "",
          optimizedContent: data.optimizedContent || { type: "doc", content: [] },
        });
        setStatus("completed");
        source.close();
        eventSourceRef.current = null;
      });

      source.addEventListener("optimize.error", (event) => {
        const data = parseOptimizeEvent((event as MessageEvent).data);
        setError(data.error || "Optimization failed");
        setStatus("error");
        source.close();
        eventSourceRef.current = null;
      });

      source.onerror = () => {
        if (status === "streaming") {
          setError("连接断开");
          setStatus("error");
        }
        source.close();
        eventSourceRef.current = null;
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start optimization";
      setError(message);
      setStatus("error");
    }
  }, [projectKey, docId, mode, status]);

  const handleApply = useCallback(() => {
    if (result?.optimizedContent) {
      onApply(result.optimizedContent);
      onClose();
    }
  }, [result, onApply, onClose]);

  const handleClose = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  const isProcessing = status === "loading" || status === "streaming";
  const showPreview = status === "streaming" || status === "completed";

  return (
    <div className="modal-overlay" role="presentation">
      <button
        className="modal-overlay-button"
        type="button"
        aria-label="关闭优化对话框"
        onClick={handleClose}
      />
      <div
        className="modal-card optimize-modal"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>文档优化</h2>
          <button className="modal-close" type="button" onClick={handleClose}>
            关闭
          </button>
        </div>

        <div className="modal-body optimize-modal-body">
          {/* Document Title */}
          <div className="optimize-doc-title">
            <span className="optimize-doc-label">文档：</span>
            <span className="optimize-doc-name">{docTitle}</span>
          </div>

          {/* Mode Selection */}
          <div className="optimize-mode-section">
            <div className="optimize-mode-label">优化模式</div>
            <div className="optimize-mode-options">
              {MODES.map((m) => (
                <label
                  key={m.value}
                  className={`optimize-mode-option${mode === m.value ? " active" : ""}${isProcessing ? " disabled" : ""}`}
                >
                  <input
                    type="radio"
                    name="optimize-mode"
                    value={m.value}
                    checked={mode === m.value}
                    onChange={() => setMode(m.value)}
                    disabled={isProcessing}
                  />
                  <div className="optimize-mode-content">
                    <div className="optimize-mode-title">{m.label}</div>
                    <div className="optimize-mode-desc">{m.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Error Display */}
          {error && <div className="optimize-error">{error}</div>}

          {/* Preview Area */}
          {showPreview && (
            <div className="optimize-preview-section">
              <div className="optimize-preview-header">
                <span>{status === "streaming" ? "优化中..." : "优化完成"}</span>
              </div>
              <div className="optimize-preview-container">
                {result ? (
                  <>
                    <div className="optimize-preview-panel">
                      <div className="optimize-preview-title">原文</div>
                      <div className="optimize-preview-content">
                        <ReactMarkdown>{result.originalMarkdown}</ReactMarkdown>
                      </div>
                    </div>
                    <div className="optimize-preview-panel">
                      <div className="optimize-preview-title">优化后</div>
                      <div className="optimize-preview-content">
                        <ReactMarkdown>{result.optimizedMarkdown}</ReactMarkdown>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="optimize-streaming-panel">
                    <div className="optimize-preview-title">优化中...</div>
                    <div className="optimize-preview-content optimize-streaming">
                      <ReactMarkdown>{streamingContent}</ReactMarkdown>
                      <span className="optimize-cursor" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer optimize-modal-footer">
          <button
            className="optimize-btn optimize-btn-secondary"
            type="button"
            onClick={handleClose}
            disabled={isProcessing}
          >
            取消
          </button>
          {status === "completed" && result ? (
            <button
              className="optimize-btn optimize-btn-primary"
              type="button"
              onClick={handleApply}
            >
              应用优化
            </button>
          ) : (
            <button
              className="optimize-btn optimize-btn-primary"
              type="button"
              onClick={handleStartOptimize}
              disabled={isProcessing}
            >
              {isProcessing ? "优化中..." : "开始优化"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(DocumentOptimizeModal);
