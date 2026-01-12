import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createChatRun, buildChatStreamUrl } from "../api/chat";
import { useProjectContext } from "../context/ProjectContext";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
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

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    hasCustomEventsRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      closeStream();
    };
  }, [closeStream]);

  const appendMessage = useCallback((role: ChatMessage["role"], content: string) => {
    setMessages((prev) => [...prev, { id: createId(), role, content }]);
  }, []);

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

  const commitAssistantBuffer = useCallback(() => {
    const content = assistantBufferRef.current;
    if (content.trim()) {
      appendMessage("assistant", content);
    }
    resetAssistantBuffer();
  }, [appendMessage, resetAssistantBuffer]);

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

      source.addEventListener("assistant.done", () => {
        hasCustomEventsRef.current = true;
        setIsGenerating(false);
        commitAssistantBuffer();
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

  return (
    <section className="chat-dock">
      <div className="chat-dock-header">
        <span>Chat</span>
        {isGenerating ? <span className="chat-dock-status">Generating...</span> : null}
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
      <div className="chat-dock-input">
        <input
          type="text"
          placeholder={projectKey ? "Type a message" : "Select a project to chat"}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          disabled={!projectKey || isGenerating}
        />
        <button type="button" onClick={handleSend} disabled={!canSend}>
          Send
        </button>
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

export default ChatDock;
