import type { KeyboardEvent } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  CloseOutlined,
  DeleteOutlined,
  SendOutlined,
  RobotOutlined,
  UserOutlined,
  LoadingOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { createChatRun, buildChatStreamUrl, clearChatSession } from "../api/chat";
import { applyProposal, rejectProposal } from "../api/documents";
import { executeCommand } from "../api/commands";
import { useProjectContext } from "../context/ProjectContext";
import { getConfigByType, type ProviderConfig } from "../api/llm-config";

type ChatArtifact = {
  type: string;
  title?: string;
  data?: Record<string, unknown>;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  artifacts?: ChatArtifact[];
  timestamp: number;
};

type ChatPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const parsePayload = (raw: string) => {
  if (!raw) return "";
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const normalizeDonePayload = (
  payload: unknown,
): { message: string; artifacts: ChatArtifact[] } => {
  if (!payload || typeof payload !== "object") {
    return { message: "", artifacts: [] };
  }
  const data = payload as { message?: unknown; artifacts?: unknown };
  const message = typeof data.message === "string" ? data.message : "";
  const artifacts = Array.isArray(data.artifacts)
    ? (data.artifacts as ChatArtifact[])
    : [];
  return { message, artifacts };
};

// Simple markdown rendering (bold, italic, code, links)
function renderMarkdown(content: string): React.ReactNode {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeContent: string[] = [];
  let codeLanguage = "";

  lines.forEach((line, lineIndex) => {
    // Code block start/end
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${lineIndex}`} className="chat-code-block">
            <code className={codeLanguage ? `language-${codeLanguage}` : ""}>
              {codeContent.join("\n")}
            </code>
          </pre>,
        );
        codeContent = [];
        codeLanguage = "";
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLanguage = line.slice(3).trim();
      }
      return;
    }

    if (inCodeBlock) {
      codeContent.push(line);
      return;
    }

    // Parse inline elements
    const parseInline = (text: string): React.ReactNode[] => {
      const result: React.ReactNode[] = [];
      let remaining = text;
      let key = 0;

      while (remaining) {
        // Inline code
        const codeMatch = remaining.match(/`([^`]+)`/);
        if (codeMatch && codeMatch.index !== undefined) {
          if (codeMatch.index > 0) {
            result.push(remaining.slice(0, codeMatch.index));
          }
          result.push(
            <code key={key++} className="chat-inline-code">
              {codeMatch[1]}
            </code>,
          );
          remaining = remaining.slice(codeMatch.index + codeMatch[0].length);
          continue;
        }

        // Bold
        const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
        if (boldMatch && boldMatch.index !== undefined) {
          if (boldMatch.index > 0) {
            result.push(remaining.slice(0, boldMatch.index));
          }
          result.push(<strong key={key++}>{boldMatch[1]}</strong>);
          remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
          continue;
        }

        // Italic
        const italicMatch = remaining.match(/\*([^*]+)\*/);
        if (italicMatch && italicMatch.index !== undefined) {
          if (italicMatch.index > 0) {
            result.push(remaining.slice(0, italicMatch.index));
          }
          result.push(<em key={key++}>{italicMatch[1]}</em>);
          remaining = remaining.slice(italicMatch.index + italicMatch[0].length);
          continue;
        }

        // No more matches
        result.push(remaining);
        break;
      }

      return result;
    };

    elements.push(
      <span key={`line-${lineIndex}`}>
        {parseInline(line)}
        {lineIndex < lines.length - 1 && <br />}
      </span>,
    );
  });

  return <>{elements}</>;
}

function ChatPanel({ isOpen, onClose, onOpenSettings }: ChatPanelProps) {
  const { currentProject } = useProjectContext();
  const projectKey = currentProject?.key ?? "";
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantBuffer, setAssistantBuffer] = useState("");
  const [llmConfig, setLlmConfig] = useState<ProviderConfig | null>(null);
  const [sessionId, setSessionId] = useState<string>(() => `session-${createId()}`);

  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasCustomEventsRef = useRef(false);
  const assistantBufferRef = useRef("");

  const canSend = useMemo(() => {
    return !isGenerating && input.trim().length > 0 && projectKey !== "";
  }, [isGenerating, input, projectKey]);

  // Load LLM config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await getConfigByType("llm");
        setLlmConfig(config);
      } catch {
        setLlmConfig(null);
      }
    };
    loadConfig();
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    const handle = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => cancelAnimationFrame(handle);
  }, [messages, assistantBuffer]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    hasCustomEventsRef.current = false;
  }, []);

  useEffect(() => {
    return () => closeStream();
  }, [closeStream]);

  const appendMessage = useCallback(
    (role: ChatMessage["role"], content: string, artifacts?: ChatArtifact[]) => {
      setMessages((prev) => [
        ...prev,
        { id: createId(), role, content, artifacts, timestamp: Date.now() },
      ]);
    },
    [],
  );

  const resetAssistantBuffer = useCallback(() => {
    assistantBufferRef.current = "";
    setAssistantBuffer("");
  }, []);

  const handleDelta = useCallback((delta: string) => {
    assistantBufferRef.current += delta;
    setAssistantBuffer(assistantBufferRef.current);
  }, []);

  const commitAssistantBuffer = useCallback(
    (artifacts?: ChatArtifact[], fallbackMessage?: string) => {
      const content = assistantBufferRef.current;
      const trimmed = content.trim();
      if (trimmed) {
        appendMessage("assistant", content, artifacts);
      } else if (fallbackMessage?.trim()) {
        appendMessage("assistant", fallbackMessage, artifacts);
      } else if (artifacts && artifacts.length > 0) {
        appendMessage("assistant", "", artifacts);
      }
      resetAssistantBuffer();
    },
    [appendMessage, resetAssistantBuffer],
  );

  const handleDocumentNavigate = useCallback(
    (docId: string, proposalId?: string) => {
      const trimmed = docId.trim();
      if (!trimmed) return;
      const query = proposalId
        ? `?proposal_id=${encodeURIComponent(proposalId)}`
        : "";
      navigate(`/documents/${encodeURIComponent(trimmed)}${query}`);
    },
    [navigate],
  );

  const handleProposalAction = useCallback(
    async (action: string, docId: string, proposalId: string) => {
      if (!projectKey || !docId) return;
      if (action === "open") {
        handleDocumentNavigate(docId, proposalId);
        return;
      }
      if (!proposalId) return;
      try {
        if (action === "apply") {
          await applyProposal(projectKey, docId, proposalId);
          appendMessage("system", "已应用修改。");
        } else {
          await rejectProposal(projectKey, docId, proposalId);
          appendMessage("system", "已拒绝修改。");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "操作失败";
        appendMessage("system", `错误: ${msg}`);
      }
    },
    [appendMessage, handleDocumentNavigate, projectKey],
  );

  const handleSend = useCallback(async () => {
    if (!canSend) return;

    const message = input.trim();
    setInput("");
    setError(null);
    appendMessage("user", message);
    setIsGenerating(true);
    resetAssistantBuffer();
    closeStream();

    try {
      // Handle command messages
      if (message.startsWith("/op:")) {
        const result = await executeCommand(projectKey, message);
        const reply = result.message || "命令已执行。";
        appendMessage("assistant", reply, result.artifacts);
        setIsGenerating(false);
        return;
      }

      const runId = await createChatRun(projectKey, message, sessionId);
      const url = buildChatStreamUrl(projectKey, runId);
      const source = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = source;

      source.addEventListener("assistant.delta", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const delta = typeof payload === "string" ? payload : String(payload ?? "");
        if (delta) handleDelta(delta);
      });

      source.addEventListener("assistant.done", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const { message: doneMessage, artifacts } = normalizeDonePayload(payload);
        setIsGenerating(false);
        commitAssistantBuffer(artifacts, doneMessage);
        closeStream();
      });

      source.addEventListener("run.error", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const errMsg =
          typeof payload === "string"
            ? payload
            : String(payload?.error ?? "对话失败");
        setError(errMsg);
        appendMessage("system", `错误: ${errMsg}`);
        setIsGenerating(false);
        resetAssistantBuffer();
        closeStream();
      });

      source.onmessage = (event) => {
        if (hasCustomEventsRef.current) return;
        const payload = parsePayload(event.data);
        if (payload === null || payload === "null") {
          setIsGenerating(false);
          closeStream();
          return;
        }
        if (payload && typeof payload === "object" && "error" in payload) {
          const errMsg = String((payload as { error?: string }).error ?? "对话失败");
          setError(errMsg);
          appendMessage("system", `错误: ${errMsg}`);
          setIsGenerating(false);
          closeStream();
          return;
        }
        const donePayload = normalizeDonePayload(payload);
        if (donePayload.message || donePayload.artifacts.length > 0) {
          setIsGenerating(false);
          commitAssistantBuffer(donePayload.artifacts, donePayload.message);
          closeStream();
          return;
        }
        const delta = typeof payload === "string" ? payload : String(payload ?? "");
        if (delta) handleDelta(delta);
      };

      source.onerror = () => {
        setError("连接中断");
        appendMessage("system", "错误: 连接中断");
        setIsGenerating(false);
        resetAssistantBuffer();
        closeStream();
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "发送失败";
      setError(errMsg);
      appendMessage("system", `错误: ${errMsg}`);
      setIsGenerating(false);
      resetAssistantBuffer();
      closeStream();
    }
  }, [
    appendMessage,
    canSend,
    closeStream,
    commitAssistantBuffer,
    handleDelta,
    input,
    projectKey,
    resetAssistantBuffer,
    sessionId,
  ]);

  const handleClearHistory = useCallback(async () => {
    if (!projectKey || !sessionId) return;
    try {
      await clearChatSession(projectKey, sessionId);
      setMessages([]);
      setSessionId(`session-${createId()}`);
    } catch {
      // Ignore errors, just clear locally
      setMessages([]);
      setSessionId(`session-${createId()}`);
    }
  }, [projectKey, sessionId]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter") return;
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      handleSend();
    },
    [handleSend],
  );

  const renderArtifacts = (artifacts?: ChatArtifact[]) => {
    if (!artifacts || artifacts.length === 0) return null;

    return (
      <div className="chat-artifacts">
        {artifacts.map((artifact, index) => {
          if (artifact.type === "document.list") {
            const items = Array.isArray(artifact.data?.items)
              ? (artifact.data?.items as Array<{ id?: string; title?: string }>)
              : [];
            return (
              <div key={`${artifact.type}-${index}`} className="chat-artifact">
                <div className="chat-artifact-title">
                  📄 {artifact.title || "相关文档"}
                </div>
                <div className="chat-artifact-list">
                  {items.map((item, i) => (
                    <button
                      key={`${item.id || i}`}
                      type="button"
                      className="chat-artifact-link"
                      onClick={() => handleDocumentNavigate(String(item.id ?? ""))}
                    >
                      {String(item.title ?? item.id ?? "文档")}
                    </button>
                  ))}
                </div>
              </div>
            );
          }

          if (artifact.type === "document.diff") {
            const docId = String(artifact.data?.doc_id ?? "");
            const proposalId = String(artifact.data?.proposal_id ?? "");
            return (
              <div key={`${artifact.type}-${index}`} className="chat-artifact">
                <div className="chat-artifact-title">
                  📝 {artifact.title || "修改建议"}
                </div>
                <button
                  type="button"
                  className="chat-artifact-link"
                  onClick={() => handleDocumentNavigate(docId, proposalId)}
                >
                  查看修改
                </button>
              </div>
            );
          }

          if (artifact.type === "diff_list") {
            const items = Array.isArray(artifact.data?.items)
              ? (artifact.data?.items as Array<{
                  doc_id?: string;
                  title?: string;
                  proposal_id?: string;
                }>)
              : [];
            const actions = Array.isArray(artifact.data?.actions)
              ? (artifact.data?.actions as Array<{ type?: string; label?: string }>)
              : [];
            return (
              <div key={`${artifact.type}-${index}`} className="chat-artifact">
                <div className="chat-artifact-title">
                  📝 {artifact.title || "修改建议"}
                </div>
                <div className="chat-artifact-list">
                  {items.map((item, i) => (
                    <div key={`${item.doc_id || i}`} className="chat-artifact-row">
                      <button
                        type="button"
                        className="chat-artifact-link"
                        onClick={() =>
                          handleProposalAction(
                            "open",
                            String(item.doc_id ?? ""),
                            String(item.proposal_id ?? ""),
                          )
                        }
                      >
                        {String(item.title ?? item.doc_id ?? "文档")}
                      </button>
                      <div className="chat-artifact-actions">
                        {actions.map((action, j) => (
                          <button
                            key={`${action.type || j}`}
                            type="button"
                            className="chat-artifact-action-btn"
                            onClick={() =>
                              handleProposalAction(
                                String(action.type ?? "open"),
                                String(item.doc_id ?? ""),
                                String(item.proposal_id ?? ""),
                              )
                            }
                          >
                            {action.label ?? action.type ?? "操作"}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          return (
            <div key={`${artifact.type}-${index}`} className="chat-artifact">
              <div className="chat-artifact-title">
                📎 {artifact.title || artifact.type}
              </div>
              <pre className="chat-artifact-json">
                {JSON.stringify(artifact.data ?? {}, null, 2)}
              </pre>
            </div>
          );
        })}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="chat-panel-overlay" onClick={onClose}>
      <aside className="chat-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="chat-panel-header">
          <div className="chat-panel-header-left">
            <div className="chat-panel-avatar-ai">
              <RobotOutlined />
            </div>
            <div className="chat-panel-title-group">
              <h2 className="chat-panel-title">AI 助手</h2>
              {llmConfig ? (
                <span className="chat-panel-model">
                  {llmConfig.displayName} · {llmConfig.defaultModel}
                </span>
              ) : (
                <span className="chat-panel-model chat-panel-model-warning">
                  未配置模型
                </span>
              )}
            </div>
          </div>
          <div className="chat-panel-header-actions">
            {onOpenSettings && (
              <button
                type="button"
                className="chat-panel-header-btn"
                onClick={onOpenSettings}
                title="设置"
              >
                <SettingOutlined />
              </button>
            )}
            <button
              type="button"
              className="chat-panel-header-btn"
              onClick={handleClearHistory}
              title="清空对话"
            >
              <DeleteOutlined />
            </button>
            <button
              type="button"
              className="chat-panel-header-btn"
              onClick={onClose}
              title="关闭"
            >
              <CloseOutlined />
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="chat-panel-messages" ref={messagesRef}>
          {messages.length === 0 && !assistantBuffer ? (
            <div className="chat-panel-empty">
              <div className="chat-panel-empty-icon">
                <RobotOutlined />
              </div>
              <div className="chat-panel-empty-title">有什么可以帮助你的？</div>
              <div className="chat-panel-empty-hint">
                {projectKey
                  ? `当前项目: ${projectKey}`
                  : "请先选择一个项目"}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`chat-message chat-message-${msg.role}`}
                >
                  <div className="chat-message-avatar">
                    {msg.role === "user" ? (
                      <UserOutlined />
                    ) : msg.role === "assistant" ? (
                      <RobotOutlined />
                    ) : (
                      "⚠️"
                    )}
                  </div>
                  <div className="chat-message-content">
                    <div className="chat-message-header">
                      <span className="chat-message-role">
                        {msg.role === "user"
                          ? "你"
                          : msg.role === "assistant"
                            ? "AI"
                            : "系统"}
                      </span>
                      <span className="chat-message-time">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                    <div className="chat-message-text">
                      {msg.role === "assistant"
                        ? renderMarkdown(msg.content)
                        : msg.content}
                    </div>
                    {renderArtifacts(msg.artifacts)}
                  </div>
                </div>
              ))}

              {/* Streaming message */}
              {assistantBuffer && (
                <div className="chat-message chat-message-assistant">
                  <div className="chat-message-avatar">
                    <RobotOutlined />
                  </div>
                  <div className="chat-message-content">
                    <div className="chat-message-header">
                      <span className="chat-message-role">AI</span>
                      <span className="chat-message-time">
                        <LoadingOutlined spin /> 思考中...
                      </span>
                    </div>
                    <div className="chat-message-text">
                      {renderMarkdown(assistantBuffer)}
                    </div>
                  </div>
                </div>
              )}

              {/* Generating indicator without content */}
              {isGenerating && !assistantBuffer && (
                <div className="chat-message chat-message-assistant">
                  <div className="chat-message-avatar">
                    <RobotOutlined />
                  </div>
                  <div className="chat-message-content">
                    <div className="chat-message-header">
                      <span className="chat-message-role">AI</span>
                    </div>
                    <div className="chat-message-text chat-message-typing">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="chat-panel-error">
            {error}
            <button type="button" onClick={() => setError(null)}>
              ×
            </button>
          </div>
        )}

        {/* Input */}
        <div className="chat-panel-input">
          <textarea
            ref={inputRef}
            className="chat-panel-textarea"
            placeholder={
              projectKey
                ? "输入消息，按 Enter 发送..."
                : "请先选择项目"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!projectKey || isGenerating}
            rows={1}
          />
          <button
            type="button"
            className="chat-panel-send-btn"
            onClick={handleSend}
            disabled={!canSend}
          >
            {isGenerating ? <LoadingOutlined spin /> : <SendOutlined />}
          </button>
        </div>
      </aside>
    </div>
  );
}

export default ChatPanel;
