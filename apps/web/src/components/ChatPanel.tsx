import type { KeyboardEvent, ChangeEvent } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DeleteOutlined,
  SendOutlined,
  RobotOutlined,
  UserOutlined,
  LoadingOutlined,
  SettingOutlined,
  UpOutlined,
  DownOutlined,
  CloseCircleOutlined,
  FolderOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { createChatRun, buildChatStreamUrl, clearChatSession, type DocumentScope } from "../api/chat";
import { applyProposal, rejectProposal } from "../api/documents";
import { executeCommand } from "../api/commands";
import { useProjectContext } from "../context/ProjectContext";
import { getConfigByType, type ProviderConfig } from "../api/llm-config";
import MentionDropdown, { type MentionItem } from "./MentionDropdown";
import DraftPreviewModal from "./DraftPreviewModal";
import type { DocumentDraft } from "../api/drafts";
import { allCommands, filterCommands, type SlashCommand } from "../constants/slash-commands";

type MentionState = {
  active: boolean;
  query: string;
  startPos: number;
};

type ChatArtifact = {
  type: string;
  title?: string;
  data?: Record<string, unknown>;
};

type SourceReference = {
  docId: string;
  blockId?: string;
  title: string;
  snippet: string;
  score: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  artifacts?: ChatArtifact[];
  sources?: SourceReference[];
  timestamp: number;
};

type ChatPanelProps = {
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
): { message: string; artifacts: ChatArtifact[]; sources: SourceReference[] } => {
  if (!payload || typeof payload !== "object") {
    return { message: "", artifacts: [], sources: [] };
  }
  const data = payload as { message?: unknown; artifacts?: unknown; sources?: unknown };
  const message = typeof data.message === "string" ? data.message : "";
  const artifacts = Array.isArray(data.artifacts)
    ? (data.artifacts as ChatArtifact[])
    : [];
  const sources = Array.isArray(data.sources)
    ? (data.sources as SourceReference[])
    : [];
  return { message, artifacts, sources };
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

function ChatPanel({ onOpenSettings }: ChatPanelProps) {
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [panelHeight, setPanelHeight] = useState(320);
  const [isResizing, setIsResizing] = useState(false);

  // @ Mention state
  const [mentions, setMentions] = useState<MentionItem[]>([]);
  const [mentionState, setMentionState] = useState<MentionState>({
    active: false,
    query: "",
    startPos: 0,
  });

  // Draft state for AI-generated document changes
  const [pendingDraft, setPendingDraft] = useState<DocumentDraft | null>(null);

  // Slash command state
  const [slashActive, setSlashActive] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasCustomEventsRef = useRef(false);
  const assistantBufferRef = useRef("");
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);

  // Track which messages have expanded sources
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

  const toggleSourcesExpanded = useCallback((messageId: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

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
    if (!isExpanded) return;
    const container = messagesRef.current;
    if (!container) return;
    const handle = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => cancelAnimationFrame(handle);
  }, [messages, assistantBuffer, isExpanded]);

  // Focus input when panel opens
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isExpanded]);

  // Handle resize
  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (event: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const delta = start.y - event.clientY;
      const nextHeight = Math.min(600, Math.max(200, start.height + delta));
      setPanelHeight(nextHeight);
    };
    const handleUp = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isResizing]);

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
    (
      role: ChatMessage["role"],
      content: string,
      artifacts?: ChatArtifact[],
      sources?: SourceReference[],
    ) => {
      setMessages((prev) => [
        ...prev,
        { id: createId(), role, content, artifacts, sources, timestamp: Date.now() },
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
    (
      artifacts?: ChatArtifact[],
      fallbackMessage?: string,
      sources?: SourceReference[],
    ) => {
      const content = assistantBufferRef.current;
      const trimmed = content.trim();
      if (trimmed) {
        appendMessage("assistant", content, artifacts, sources);
      } else if (fallbackMessage?.trim()) {
        appendMessage("assistant", fallbackMessage, artifacts, sources);
      } else if (artifacts && artifacts.length > 0) {
        appendMessage("assistant", "", artifacts, sources);
      }
      resetAssistantBuffer();
    },
    [appendMessage, resetAssistantBuffer],
  );

  const handleDocumentNavigate = useCallback(
    (docId: string, options?: { proposalId?: string; blockId?: string }) => {
      const trimmed = docId.trim();
      if (!trimmed) return;
      const params = new URLSearchParams();
      if (options?.proposalId) {
        params.set("proposal_id", options.proposalId);
      }
      if (options?.blockId) {
        params.set("block", options.blockId);
      }
      const query = params.toString() ? `?${params.toString()}` : "";
      navigate(`/documents/${encodeURIComponent(trimmed)}${query}`);
    },
    [navigate],
  );

  const handleProposalAction = useCallback(
    async (action: string, docId: string, proposalId: string) => {
      if (!projectKey || !docId) return;
      if (action === "open") {
        handleDocumentNavigate(docId, { proposalId });
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
    const currentMentions = [...mentions];
    setInput("");
    setMentions([]);
    setMentionState({ active: false, query: "", startPos: 0 });
    setError(null);

    // Build display message with mention info
    const mentionInfo = currentMentions.length > 0
      ? `[检索范围: ${currentMentions.map((m) => m.titlePath + (m.includeChildren ? "/" : "")).join(", ")}]\n`
      : "";
    appendMessage("user", mentionInfo + message);
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

      // Convert mentions to document scope
      const documentScope: DocumentScope[] | undefined = currentMentions.length > 0
        ? currentMentions.map((m) => ({
            docId: m.docId,
            includeChildren: m.includeChildren,
          }))
        : undefined;

      const runId = await createChatRun(projectKey, message, sessionId, documentScope);
      const url = buildChatStreamUrl(projectKey, runId);
      const source = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = source;

      source.addEventListener("assistant.delta", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const delta = typeof payload === "string" ? payload : String(payload ?? "");
        if (delta) handleDelta(delta);
      });

      source.addEventListener("assistant.thinking", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const content = typeof payload === "object" && payload !== null
          ? String((payload as { content?: string }).content ?? "")
          : String(payload ?? "");
        if (content) {
          // Show thinking status in UI
          setAssistantBuffer(`*${content}*\n`);
        }
      });

      source.addEventListener("assistant.draft", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        if (payload && typeof payload === "object") {
          setPendingDraft(payload as DocumentDraft);
        }
      });

      source.addEventListener("assistant.done", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const { message: doneMessage, artifacts, sources } = normalizeDonePayload(payload);
        setIsGenerating(false);
        commitAssistantBuffer(artifacts, doneMessage, sources);
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
          commitAssistantBuffer(donePayload.artifacts, donePayload.message, donePayload.sources);
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
    mentions,
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

  // Handle draft applied
  const handleDraftApplied = useCallback((docId: string, isNew: boolean) => {
    setPendingDraft(null);
    const action = isNew ? "创建" : "更新";
    appendMessage("system", `文档已${action}。`);
    // Navigate to the document
    handleDocumentNavigate(docId, {});
  }, [appendMessage, handleDocumentNavigate]);

  // Handle draft closed/rejected
  const handleDraftClose = useCallback(() => {
    setPendingDraft(null);
  }, []);

  // Keep a ref to track the latest mentionState for callbacks
  const mentionStateRef = useRef(mentionState);
  useEffect(() => {
    mentionStateRef.current = mentionState;
  }, [mentionState]);

  // Handle @ mention selection
  const handleMentionSelect = useCallback(
    (item: MentionItem) => {
      const currentMentionState = mentionStateRef.current;

      // Add to mentions list
      setMentions((prev) => {
        // Avoid duplicates
        if (prev.some((m) => m.docId === item.docId)) {
          return prev;
        }
        return [...prev, item];
      });

      // Remove the @query from input
      setInput((prev) => {
        const before = prev.slice(0, currentMentionState.startPos);
        const after = prev.slice(currentMentionState.startPos + currentMentionState.query.length + 1); // +1 for @
        return before + after;
      });

      // Close mention mode
      setMentionState({ active: false, query: "", startPos: 0 });
    },
    [],
  );

  // Handle @ mention close
  const handleMentionClose = useCallback(() => {
    setMentionState({ active: false, query: "", startPos: 0 });
  }, []);

  // Remove a mention tag
  const handleRemoveMention = useCallback((docId: string) => {
    setMentions((prev) => prev.filter((m) => m.docId !== docId));
  }, []);

  // Get filtered slash commands
  const filteredSlashCommands = useMemo(() => {
    if (!slashActive) return [];
    return filterCommands(slashQuery);
  }, [slashActive, slashQuery]);

  // Handle slash command selection
  const handleSlashSelect = useCallback((command: SlashCommand) => {
    // Insert the command into input
    setInput((prev) => {
      // Replace /query with the full command
      const beforeSlash = prev.slice(0, prev.lastIndexOf("/"));
      return beforeSlash + command.command + " ";
    });
    setSlashActive(false);
    setSlashQuery("");
    setSlashSelectedIndex(0);
    // Focus input
    inputRef.current?.focus();
  }, []);

  // Handle input change with @ and / detection
  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const cursorPos = e.target.selectionStart ?? value.length;

      setInput(value);

      // Check if we're in mention mode
      if (mentionState.active) {
        // Extract query after @
        const queryPart = value.slice(mentionState.startPos + 1, cursorPos);

        // Check for space (ends mention mode)
        if (queryPart.includes(" ") || cursorPos <= mentionState.startPos) {
          setMentionState({ active: false, query: "", startPos: 0 });
        } else {
          setMentionState((prev) => ({ ...prev, query: queryPart }));
        }
      } else if (slashActive) {
        // Check if we're in slash command mode
        const slashIndex = value.lastIndexOf("/");
        if (slashIndex < 0 || cursorPos <= slashIndex) {
          setSlashActive(false);
          setSlashQuery("");
        } else {
          const queryPart = value.slice(slashIndex + 1, cursorPos);
          // Check for space after command
          if (queryPart.includes(" ")) {
            setSlashActive(false);
            setSlashQuery("");
          } else {
            setSlashQuery(queryPart);
          }
        }
      } else {
        // Check for @ trigger
        const atIndex = value.lastIndexOf("@");
        if (atIndex >= 0 && atIndex === cursorPos - 1) {
          const charBefore = atIndex > 0 ? value[atIndex - 1] : " ";
          if (/\s/.test(charBefore) || atIndex === 0) {
            setMentionState({
              active: true,
              query: "",
              startPos: atIndex,
            });
          }
        }

        // Check for / trigger at the start of input
        if (value === "/" || (cursorPos === 1 && value.startsWith("/"))) {
          setSlashActive(true);
          setSlashQuery("");
          setSlashSelectedIndex(0);
        }
      }
    },
    [mentionState.active, mentionState.startPos, slashActive],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // If mention dropdown is active, let it handle keyboard events
      if (mentionState.active) {
        if (["ArrowDown", "ArrowUp", "Tab", "Escape", "Enter"].includes(event.key)) {
          event.preventDefault();
          return;
        }
      }

      // Handle slash command navigation
      if (slashActive && filteredSlashCommands.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashSelectedIndex((prev) =>
            prev < filteredSlashCommands.length - 1 ? prev + 1 : 0,
          );
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredSlashCommands.length - 1,
          );
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          handleSlashSelect(filteredSlashCommands[slashSelectedIndex]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSlashActive(false);
          setSlashQuery("");
          return;
        }
      }

      if (event.key !== "Enter") return;
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      handleSend();
    },
    [handleSend, mentionState.active, slashActive, filteredSlashCommands, slashSelectedIndex, handleSlashSelect],
  );

  const renderArtifacts = (artifacts?: ChatArtifact[]) => {
    if (!artifacts || artifacts.length === 0) return null;

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
                  📄 {artifact.title || "相关文档"}
                </div>
                <div className="chat-dock-artifact-list">
                  {items.map((item, i) => (
                    <button
                      key={`${item.id || i}`}
                      type="button"
                      className="chat-dock-artifact-link"
                      onClick={() => handleDocumentNavigate(String(item.id ?? ""), {})}
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
              <div key={`${artifact.type}-${index}`} className="chat-dock-artifact">
                <div className="chat-dock-artifact-title">
                  📝 {artifact.title || "修改建议"}
                </div>
                <button
                  type="button"
                  className="chat-dock-artifact-link"
                  onClick={() => handleDocumentNavigate(docId, { proposalId })}
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
              <div key={`${artifact.type}-${index}`} className="chat-dock-artifact">
                <div className="chat-dock-artifact-title">
                  📝 {artifact.title || "修改建议"}
                </div>
                <div className="chat-dock-artifact-list">
                  {items.map((item, i) => (
                    <div key={`${item.doc_id || i}`} className="chat-dock-artifact-row">
                      <button
                        type="button"
                        className="chat-dock-artifact-link"
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
                      <div className="chat-dock-artifact-actions">
                        {actions.map((action, j) => (
                          <button
                            key={`${action.type || j}`}
                            type="button"
                            className="chat-dock-artifact-action"
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
            <div key={`${artifact.type}-${index}`} className="chat-dock-artifact">
              <div className="chat-dock-artifact-title">
                📎 {artifact.title || artifact.type}
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

  const renderSources = (messageId: string, sources?: SourceReference[]) => {
    if (!sources || sources.length === 0) return null;

    const isExpanded = expandedSources.has(messageId);

    return (
      <div className="chat-sources">
        <button
          type="button"
          className="chat-sources-toggle"
          onClick={() => toggleSourcesExpanded(messageId)}
        >
          <span className="chat-sources-icon">📚</span>
          <span className="chat-sources-label">
            引用了 {sources.length} 个文档
          </span>
          <span className={`chat-sources-arrow ${isExpanded ? "expanded" : ""}`}>
            {isExpanded ? <DownOutlined /> : <UpOutlined />}
          </span>
        </button>
        {isExpanded && (
          <div className="chat-sources-list">
            {sources.map((source, index) => (
              <div
                key={`${source.docId}-${source.blockId || ""}-${index}`}
                className="chat-source-item"
                onClick={() => handleDocumentNavigate(source.docId, { blockId: source.blockId })}
              >
                <div className="chat-source-title">
                  {source.title}
                  {source.blockId && (
                    <span className="chat-source-block-hint">
                      #{source.blockId.slice(0, 8)}
                    </span>
                  )}
                </div>
                <div className="chat-source-snippet">{source.snippet}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="chat-dock-bottom">
      {/* Draft Preview Modal */}
      {pendingDraft && (
        <DraftPreviewModal
          draft={pendingDraft}
          projectKey={projectKey}
          onClose={handleDraftClose}
          onApplied={handleDraftApplied}
        />
      )}

      {/* Expanded Panel */}
      {isExpanded && (
        <div
          className="chat-dock-panel"
          style={{ height: `${panelHeight}px` }}
        >
          {/* Resize Handle */}
          <div
            className="chat-dock-resize-handle"
            onMouseDown={(e) => {
              e.preventDefault();
              resizeStartRef.current = { y: e.clientY, height: panelHeight };
              setIsResizing(true);
            }}
          />

          {/* Header */}
          <header className="chat-dock-header">
            <div className="chat-dock-header-left">
              <div className="chat-dock-avatar">
                <RobotOutlined />
              </div>
              <div className="chat-dock-title-group">
                <span className="chat-dock-title">AI 助手</span>
                {llmConfig ? (
                  <span className="chat-dock-model">
                    {llmConfig.displayName} · {llmConfig.defaultModel}
                  </span>
                ) : (
                  <span className="chat-dock-model chat-dock-model-warning">
                    未配置模型
                  </span>
                )}
              </div>
            </div>
            <div className="chat-dock-header-actions">
              {onOpenSettings && (
                <button
                  type="button"
                  className="chat-dock-header-btn"
                  onClick={onOpenSettings}
                  title="设置"
                >
                  <SettingOutlined />
                </button>
              )}
              <button
                type="button"
                className="chat-dock-header-btn"
                onClick={handleClearHistory}
                title="清空对话"
              >
                <DeleteOutlined />
              </button>
            </div>
            {isGenerating && (
              <span className="chat-dock-status">
                <LoadingOutlined spin /> 生成中...
              </span>
            )}
          </header>

          {/* Messages */}
          <div className="chat-dock-messages" ref={messagesRef}>
            {messages.length === 0 && !assistantBuffer ? (
              <div className="chat-dock-empty">
                <div className="chat-dock-empty-icon">
                  <RobotOutlined />
                </div>
                <div className="chat-dock-empty-text">有什么可以帮助你的？</div>
                <div className="chat-dock-empty-hint">
                  {projectKey ? `当前项目: ${projectKey}` : "请先选择一个项目"}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`chat-msg chat-msg-${msg.role}`}
                  >
                    <div className="chat-msg-avatar">
                      {msg.role === "user" ? (
                        <UserOutlined />
                      ) : msg.role === "assistant" ? (
                        <RobotOutlined />
                      ) : (
                        "⚠️"
                      )}
                    </div>
                    <div className="chat-msg-content">
                      <div className="chat-msg-header">
                        <span className="chat-msg-role">
                          {msg.role === "user"
                            ? "你"
                            : msg.role === "assistant"
                              ? "AI"
                              : "系统"}
                        </span>
                        <span className="chat-msg-time">
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>
                      <div className="chat-msg-text">
                        {msg.role === "assistant"
                          ? renderMarkdown(msg.content)
                          : msg.content}
                      </div>
                      {renderArtifacts(msg.artifacts)}
                      {msg.role === "assistant" && renderSources(msg.id, msg.sources)}
                    </div>
                  </div>
                ))}

                {/* Streaming message */}
                {assistantBuffer && (
                  <div className="chat-msg chat-msg-assistant">
                    <div className="chat-msg-avatar">
                      <RobotOutlined />
                    </div>
                    <div className="chat-msg-content">
                      <div className="chat-msg-header">
                        <span className="chat-msg-role">AI</span>
                        <span className="chat-msg-time">
                          <LoadingOutlined spin /> 思考中...
                        </span>
                      </div>
                      <div className="chat-msg-text">
                        {renderMarkdown(assistantBuffer)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Generating indicator */}
                {isGenerating && !assistantBuffer && (
                  <div className="chat-msg chat-msg-assistant">
                    <div className="chat-msg-avatar">
                      <RobotOutlined />
                    </div>
                    <div className="chat-msg-content">
                      <div className="chat-msg-header">
                        <span className="chat-msg-role">AI</span>
                      </div>
                      <div className="chat-msg-text chat-msg-typing">
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
            <div className="chat-dock-error">
              {error}
              <button type="button" onClick={() => setError(null)}>
                ×
              </button>
            </div>
          )}
        </div>
      )}

      {/* Input Bar (Always visible) */}
      <div className="chat-dock-bar">
        {/* Mention Tags */}
        {mentions.length > 0 && (
          <div className="chat-mention-tags">
            {mentions.map((m) => (
              <span key={m.docId} className="chat-mention-tag">
                <span className="chat-mention-tag-icon">
                  {m.includeChildren ? <FolderOutlined /> : <FileTextOutlined />}
                </span>
                <span className="chat-mention-tag-text" title={m.titlePath}>
                  {m.title}
                  {m.includeChildren && "/"}
                </span>
                <button
                  type="button"
                  className="chat-mention-tag-remove"
                  onClick={() => handleRemoveMention(m.docId)}
                >
                  <CloseCircleOutlined />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Mention Dropdown - positioned relative to chat-dock-bar */}
        <MentionDropdown
          projectKey={projectKey}
          query={mentionState.query}
          visible={mentionState.active && projectKey !== ""}
          onSelect={handleMentionSelect}
          onClose={handleMentionClose}
        />

        {/* Slash Command Dropdown */}
        {slashActive && filteredSlashCommands.length > 0 && (
          <div className="slash-command-dropdown">
            <ul className="slash-command-list">
              {filteredSlashCommands.map((cmd, index) => (
                <li
                  key={cmd.command}
                  className={`slash-command-item ${index === slashSelectedIndex ? "selected" : ""}`}
                  onClick={() => handleSlashSelect(cmd)}
                  onMouseEnter={() => setSlashSelectedIndex(index)}
                >
                  <span className="slash-command-icon">{cmd.icon}</span>
                  <span className="slash-command-name">{cmd.command}</span>
                  <span className="slash-command-desc">{cmd.description}</span>
                </li>
              ))}
            </ul>
            <div className="slash-command-hint">
              <span>↑↓ 选择</span>
              <span>Tab/Enter 确认</span>
              <span>Esc 取消</span>
            </div>
          </div>
        )}

        <div className="chat-dock-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-dock-textarea"
            placeholder={
              projectKey ? "输入消息，@ 指定文档范围..." : "请先选择项目"
            }
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={!projectKey || isGenerating}
            rows={1}
          />
          <div className="chat-dock-bar-actions">
            <button
              type="button"
              className="chat-dock-send-btn"
              onClick={handleSend}
              disabled={!canSend}
            >
              {isGenerating ? <LoadingOutlined spin /> : <SendOutlined />}
            </button>
            <button
              type="button"
              className="chat-dock-toggle-btn"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "收起" : "展开"}
            >
              {isExpanded ? <DownOutlined /> : <UpOutlined />}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ChatPanel;
