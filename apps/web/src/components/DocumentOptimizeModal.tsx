/**
 * Document Optimization Modal
 *
 * Allows users to optimize document format and content using LLM.
 */

import { useState, useCallback, useRef, useEffect, memo } from "react";
import type { JSONContent } from "@tiptap/react";
import { Alert, Button, Modal, Radio, Space, Spin, Typography } from "antd";
import Markdown from "./Markdown";

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
        throw new Error("获取任务 ID 失败");
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
        setError(data.error || "优化失败");
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
      const message = err instanceof Error ? err.message : "启动优化失败";
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
    <Modal
      open={isOpen}
      centered
      width={1080}
      title="文档优化"
      onCancel={handleClose}
      destroyOnHidden
      footer={(
        <Space>
          <Button onClick={handleClose} disabled={isProcessing}>取消</Button>
          {status === "completed" && result ? (
            <Button type="primary" onClick={handleApply}>应用优化</Button>
          ) : (
            <Button type="primary" onClick={handleStartOptimize} loading={isProcessing}>
              开始优化
            </Button>
          )}
        </Space>
      )}
    >
      <div className="optimize-modal-body">
        <Typography.Paragraph style={{ marginBottom: 12 }}>
          <Typography.Text strong>文档：</Typography.Text>
          <Typography.Text>{docTitle || "未命名文档"}</Typography.Text>
        </Typography.Paragraph>

        <div className="optimize-mode-section">
          <div className="optimize-mode-label">优化模式</div>
          <Radio.Group
            value={mode}
            onChange={(event) => setMode(event.target.value as OptimizeMode)}
            disabled={isProcessing}
          >
            <Space direction="vertical" style={{ width: "100%" }}>
              {MODES.map((item) => (
                <Radio key={item.value} value={item.value}>
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{item.label}</Typography.Text>
                    <Typography.Text type="secondary">{item.description}</Typography.Text>
                  </Space>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </div>

        {error ? (
          <Alert
            type="error"
            message={error}
            showIcon
            style={{ marginBottom: 16 }}
          />
        ) : null}

        {showPreview ? (
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
                      <Markdown content={result.originalMarkdown} />
                    </div>
                  </div>
                  <div className="optimize-preview-panel">
                    <div className="optimize-preview-title">优化后</div>
                    <div className="optimize-preview-content">
                      <Markdown content={result.optimizedMarkdown} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="optimize-streaming-panel">
                  <div className="optimize-preview-title">
                    优化中... <Spin size="small" style={{ marginLeft: 6 }} />
                  </div>
                  <div className="optimize-preview-content optimize-streaming">
                    <Markdown content={streamingContent} />
                    <span className="optimize-cursor" />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export default memo(DocumentOptimizeModal);
