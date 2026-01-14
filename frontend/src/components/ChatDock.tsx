import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AutoComplete, Input } from "antd";
import { useNavigate } from "react-router-dom";

import { createChatRun, buildChatStreamUrl } from "../api/chat";
import { useProjectContext } from "../context/ProjectContext";

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
};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

function ChatDock() {
  const { currentProject } = useProjectContext();
  const projectKey = currentProject?.key ?? "";
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantBuffer, setAssistantBuffer] = useState("");
  const [assistantActive, setAssistantActive] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasCustomEventsRef = useRef(false);
  const assistantBufferRef = useRef("");

  const canSend = useMemo(() => {
    return !isGenerating && input.trim().length > 0 && projectKey !== "";
  }, [isGenerating, input, projectKey]);
  const showPanel = useMemo(() => {
    return (
      messages.length > 0 ||
      Boolean(error) ||
      assistantActive ||
      isGenerating
    );
  }, [assistantActive, error, isGenerating, messages.length]);

  const slashOptions = useMemo(() => {
    if (!input.trim().startsWith("/")) {
      return [];
    }
    return [
      { value: "/docs", label: "docs — list documents" },
      { value: "/propose", label: "propose — create a change proposal (doc_id required)" },
    ];
  }, [input]);

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    hasCustomEventsRef.current = false;
  }, []);

  const handleDocumentNavigate = useCallback(
    (docId: string, proposalId?: string) => {
      const trimmed = docId.trim();
      if (!trimmed) {
        return;
      }
      const params = new URLSearchParams();
      params.set("document_id", trimmed);
      if (proposalId) {
        params.set("proposal_id", proposalId);
      }
      navigate(`/knowledge?${params.toString()}`);
    },
    [navigate],
  );

  useEffect(() => {
    return () => {
      closeStream();
    };
  }, [closeStream]);

  const appendMessage = useCallback(
    (role: ChatMessage["role"], content: string, artifacts?: ChatArtifact[]) => {
      setMessages((prev) => [
        ...prev,
        { id: createId(), role, content, artifacts },
      ]);
    },
    [],
  );

  const resetAssistantBuffer = useCallback(() => {
    assistantBufferRef.current = "";
    setAssistantBuffer("");
    setAssistantActive(false);
  }, []);

  const handleDelta = useCallback(
    (delta: string) => {
      assistantBufferRef.current += delta;
      setAssistantBuffer(assistantBufferRef.current);
      setAssistantActive(true);
    },
    [],
  );

  const commitAssistantBuffer = useCallback(
    (artifacts?: ChatArtifact[], fallbackMessage?: string) => {
      const content = assistantBufferRef.current;
      const trimmed = content.trim();
      if (trimmed) {
        appendMessage("assistant", content, artifacts);
      } else if (fallbackMessage && fallbackMessage.trim()) {
        appendMessage("assistant", fallbackMessage, artifacts);
      } else if (artifacts && artifacts.length > 0) {
        appendMessage("assistant", "", artifacts);
      }
      resetAssistantBuffer();
    },
    [appendMessage, resetAssistantBuffer],
  );

  const handleSend = useCallback(async () => {
    if (!canSend) {
      return;
    }
    const message = input.trim();
    setInput("");
    setError(null);
    appendMessage("user", message);
    setIsGenerating(true);
    resetAssistantBuffer();
    closeStream();

    try {
      const runId = await createChatRun(projectKey, message);
      const url = buildChatStreamUrl(projectKey, runId);
      const source = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = source;

      source.addEventListener("assistant.delta", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const delta = typeof payload === "string" ? payload : String(payload ?? "");
        if (delta) {
          handleDelta(delta);
        }
      });

      source.addEventListener("assistant.done", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const { message, artifacts } = normalizeDonePayload(payload);
        setIsGenerating(false);
        commitAssistantBuffer(artifacts, message);
        closeStream();
      });

      source.addEventListener("run.error", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const messageText =
          typeof payload === "string"
            ? payload
            : String(payload?.error ?? "Chat run failed");
        setError(messageText);
        appendMessage("system", `Error: ${messageText}`);
        setIsGenerating(false);
        resetAssistantBuffer();
        closeStream();
      });

      source.onmessage = (event) => {
        if (hasCustomEventsRef.current) {
          return;
        }
        const payload = parsePayload(event.data);
        if (payload === null || payload === "null") {
          setIsGenerating(false);
          closeStream();
          return;
        }
        if (payload && typeof payload === "object" && "error" in payload) {
          const messageText = String((payload as { error?: string }).error ?? "Chat run failed");
          setError(messageText);
          appendMessage("system", `Error: ${messageText}`);
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
        if (delta) {
          handleDelta(delta);
        }
      };

      source.onerror = () => {
        setError("Stream connection lost");
        appendMessage("system", "Error: Stream connection lost");
        setIsGenerating(false);
        resetAssistantBuffer();
        closeStream();
      };
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Failed to send message";
      setError(messageText);
      appendMessage("system", `Error: ${messageText}`);
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
  ]);

  const renderArtifacts = (artifacts?: ChatArtifact[]) => {
    if (!artifacts || artifacts.length === 0) {
      return null;
    }
    return (
      <div className="chat-dock-artifacts">
        {artifacts.map((artifact, index) => {
          if (artifact.type === "document.list") {
            const items = Array.isArray(artifact.data?.items)
              ? (artifact.data?.items as Array<{ id?: string; title?: string }>)
              : [];
            return (
              <div key={`${artifact.type}-${index}`} className="chat-dock-artifact">
                <div className="chat-dock-artifact-title">
                  {artifact.title || "Documents"}
                </div>
                <div className="chat-dock-artifact-list">
                  {items.map((item, itemIndex) => (
                    <button
                      key={`${item.id || itemIndex}`}
                      type="button"
                      className="chat-dock-artifact-link"
                      onClick={() => handleDocumentNavigate(String(item.id ?? ""))}
                    >
                      {String(item.title ?? item.id ?? "Document")}
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
              <div key={`${artifact.type}-${index}`} className="chat-dock-artifact">
                <div className="chat-dock-artifact-title">
                  {artifact.title || "Change Proposal"}
                </div>
                <button
                  type="button"
                  className="chat-dock-artifact-link"
                  onClick={() => handleDocumentNavigate(docId, proposalId)}
                >
                  View diff
                </button>
              </div>
            );
          }
          return (
            <div key={`${artifact.type}-${index}`} className="chat-dock-artifact">
              <div className="chat-dock-artifact-title">
                {artifact.title || artifact.type}
              </div>
              <pre className="chat-dock-artifact-json">
                {JSON.stringify(artifact.data ?? {}, null, 2)}
              </pre>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section className="chat-dock">
      {showPanel ? (
        <div className="chat-dock-panel">
          <div className="chat-dock-header">
            <span>Chat</span>
            {isGenerating ? (
              <span className="chat-dock-status">Generating...</span>
            ) : null}
          </div>
          <div className="chat-dock-messages">
            {messages.length === 0 ? (
              <div className="chat-dock-empty">Start a conversation</div>
            ) : (
              <>
                {messages.map((message) => (
                  <div key={message.id} className={`chat-dock-message ${message.role}`}>
                    <span className="chat-dock-role">{message.role}</span>
                    <span className="chat-dock-text">{message.content}</span>
                    {renderArtifacts(message.artifacts)}
                  </div>
                ))}
                {assistantActive ? (
                  <div className="chat-dock-message assistant">
                    <span className="chat-dock-role">assistant</span>
                    <span className="chat-dock-text">{assistantBuffer}</span>
                  </div>
                ) : null}
              </>
            )}
          </div>
          {error ? <div className="chat-dock-error">{error}</div> : null}
        </div>
      ) : null}
      <div className="chat-dock-bar">
        {isGenerating ? <span className="chat-dock-bar-status">Generating...</span> : null}
        <div className="chat-dock-input">
          <AutoComplete
            className="chat-dock-autocomplete"
            options={slashOptions}
            value={input}
            onChange={(value) => setInput(value)}
            onSelect={(value) => {
              const next = value.endsWith(" ") ? value : `${value} `;
              setInput(next);
            }}
            filterOption={(value, option) =>
              String(option?.value ?? "").toLowerCase().startsWith(value.toLowerCase())
            }
          >
            <Input
              placeholder={projectKey ? "Type a message" : "Select a project to chat"}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              disabled={!projectKey || isGenerating}
            />
          </AutoComplete>
          <button type="button" onClick={handleSend} disabled={!canSend}>
            Send
          </button>
        </div>
      </div>
    </section>
  );
}

const parsePayload = (raw: string) => {
  if (!raw) {
    return "";
  }
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
  const data = payload as {
    message?: unknown;
    artifacts?: unknown;
  };
  const message = typeof data.message === "string" ? data.message : "";
  const artifacts = Array.isArray(data.artifacts)
    ? (data.artifacts as ChatArtifact[])
    : [];
  return { message, artifacts };
};

export default ChatDock;
