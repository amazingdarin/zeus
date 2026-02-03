/**
 * useChatLogic Hook
 *
 * Encapsulates all chat logic for reuse between ChatPanel and ChatPage.
 */

import type { KeyboardEvent, ChangeEvent, RefObject } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import { createChatRun, buildChatStreamUrl, clearChatSession, confirmTool, rejectTool, type DocumentScope, type PendingToolCall } from "../api/chat";
import { applyProposal, rejectProposal } from "../api/documents";
import { executeCommand } from "../api/commands";
import { useProjectContext } from "../context/ProjectContext";
import { getConfigByType, type ProviderConfig } from "../api/llm-config";
import type { MentionItem } from "../components/MentionDropdown";
import type { DocumentDraft } from "../api/drafts";
import { filterCommands, setEnabledCommands, type SlashCommand } from "../constants/slash-commands";
import { getEnabledCommands } from "../api/skills";

// Types
export type MentionState = {
  active: boolean;
  query: string;
  startPos: number;
};

export type CommandHistoryEntry = {
  input: string;
  command: SlashCommand | null;
  mentions: MentionItem[];
  timestamp: number;
};

export type ChatArtifact = {
  type: string;
  title?: string;
  data?: Record<string, unknown>;
};

export type SourceReference = {
  type?: "kb" | "web";  // "kb" = knowledge base (default), "web" = web search
  docId?: string;       // For KB sources
  blockId?: string;     // For KB sources
  url?: string;         // For web sources
  title: string;
  snippet: string;
  score: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  artifacts?: ChatArtifact[];
  sources?: SourceReference[];
  timestamp: number;
};

// Helpers
export const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const formatTime = (timestamp: number) => {
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
export function renderMarkdown(content: string): React.ReactNode {
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

type UseChatLogicOptions = {
  onOpenSettings?: () => void;
  autoScrollEnabled?: boolean;
  deepSearchEnabled?: boolean;
  onDeepSearchChange?: (enabled: boolean) => void;
};

export type UseChatLogicReturn = {
  // State
  messages: ChatMessage[];
  input: string;
  isGenerating: boolean;
  deepSearchEnabled: boolean;
  error: string | null;
  assistantBuffer: string;
  llmConfig: ProviderConfig | null;
  mentions: MentionItem[];
  mentionState: MentionState;
  pendingDraft: DocumentDraft | null;
  pendingTool: PendingToolCall | null;
  slashActive: boolean;
  slashQuery: string;
  slashSelectedIndex: number;
  selectedCommand: SlashCommand | null;
  filteredSlashCommands: SlashCommand[];
  expandedSources: Set<string>;
  canSend: boolean;
  projectKey: string;

  // Refs
  messagesRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;

  // Actions
  setInput: (value: string) => void;
  setError: (error: string | null) => void;
  setSlashSelectedIndex: (index: number) => void;
  setDeepSearchEnabled: (enabled: boolean) => void;
  handleSend: () => Promise<void>;
  handleStop: () => void;
  handleClearHistory: () => Promise<void>;
  handleInputChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleMentionSelect: (item: MentionItem) => void;
  handleMentionClose: () => void;
  handleRemoveMention: (docId: string) => void;
  handleSlashSelect: (command: SlashCommand) => void;
  handleDraftApplied: (docId: string, isNew: boolean) => void;
  handleDraftClose: () => void;
  handleDocumentNavigate: (docId: string, options?: { proposalId?: string; blockId?: string }) => void;
  handleProposalAction: (action: string, docId: string, proposalId: string) => Promise<void>;
  handleConfirmTool: () => Promise<void>;
  handleRejectTool: () => Promise<void>;
  toggleSourcesExpanded: (messageId: string) => void;

  // Render helpers
  renderMarkdown: typeof renderMarkdown;
  formatTime: typeof formatTime;
};

export function useChatLogic(options: UseChatLogicOptions = {}): UseChatLogicReturn {
  const { autoScrollEnabled = true, deepSearchEnabled: externalDeepSearch, onDeepSearchChange } = options;
  const { currentProject } = useProjectContext();
  const projectKey = currentProject?.key ?? "";
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [internalDeepSearch, setInternalDeepSearch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use external deepSearch state if provided, otherwise internal
  const deepSearchEnabled = externalDeepSearch ?? internalDeepSearch;
  const setDeepSearchEnabled = useCallback((enabled: boolean) => {
    if (onDeepSearchChange) {
      onDeepSearchChange(enabled);
    } else {
      setInternalDeepSearch(enabled);
    }
  }, [onDeepSearchChange]);
  const [assistantBuffer, setAssistantBuffer] = useState("");
  const [llmConfig, setLlmConfig] = useState<ProviderConfig | null>(null);
  const [sessionId, setSessionId] = useState<string>(() => `session-${createId()}`);

  // @ Mention state
  const [mentions, setMentions] = useState<MentionItem[]>([]);
  const [mentionState, setMentionState] = useState<MentionState>({
    active: false,
    query: "",
    startPos: 0,
  });

  // Draft state for AI-generated document changes
  const [pendingDraft, setPendingDraft] = useState<DocumentDraft | null>(null);

  // Pending tool confirmation state
  const [pendingTool, setPendingTool] = useState<PendingToolCall | null>(null);
  const currentRunIdRef = useRef<string | null>(null);

  // Slash command state
  const [slashActive, setSlashActive] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  // Selected command (displayed as a tag, acts as a unit for undo)
  const [selectedCommand, setSelectedCommand] = useState<SlashCommand | null>(null);

  // Command history (for arrow up/down navigation)
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const currentInputRef = useRef<CommandHistoryEntry | null>(null);

  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasCustomEventsRef = useRef(false);
  const assistantBufferRef = useRef("");

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

  // Load enabled skills and update command filtering
  useEffect(() => {
    const loadEnabledSkills = async () => {
      try {
        const data = await getEnabledCommands();
        setEnabledCommands(data.commands);
      } catch {
        // Default to all commands enabled if fetch fails
        console.warn("Failed to load enabled commands, defaulting to all enabled");
      }
    };
    loadEnabledSkills();
  }, []);

  // Load command history from localStorage
  const MAX_HISTORY = 50;
  useEffect(() => {
    if (!projectKey) return;
    const historyKey = `zeus-cmd-history-${projectKey}`;
    try {
      const saved = localStorage.getItem(historyKey);
      if (saved) {
        const parsed = JSON.parse(saved) as CommandHistoryEntry[];
        setCommandHistory(parsed);
      }
    } catch {
      // Ignore parse errors
    }
  }, [projectKey]);

  // Save command history to localStorage
  useEffect(() => {
    if (!projectKey || commandHistory.length === 0) return;
    const historyKey = `zeus-cmd-history-${projectKey}`;
    try {
      const toSave = commandHistory.slice(-MAX_HISTORY);
      localStorage.setItem(historyKey, JSON.stringify(toSave));
    } catch {
      // Ignore storage errors
    }
  }, [projectKey, commandHistory]);

  // Auto scroll to bottom
  useEffect(() => {
    if (!autoScrollEnabled) return;
    const container = messagesRef.current;
    if (!container) return;
    const handle = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => cancelAnimationFrame(handle);
  }, [messages, assistantBuffer, autoScrollEnabled]);

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

    // Build full message with command prefix if selected
    const commandPrefix = selectedCommand ? selectedCommand.command + " " : "";
    const message = (commandPrefix + input).trim();
    const currentMentions = [...mentions];

    // Save to command history before clearing
    const historyEntry: CommandHistoryEntry = {
      input: input,
      command: selectedCommand,
      mentions: [...mentions],
      timestamp: Date.now(),
    };
    setCommandHistory((prev) => [...prev, historyEntry]);
    setHistoryIndex(-1);
    currentInputRef.current = null;

    setInput("");
    setMentions([]);
    setSelectedCommand(null);
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

      const runId = await createChatRun(projectKey, message, {
        sessionId,
        documentScope,
        deepSearch: deepSearchEnabled,
      });
      currentRunIdRef.current = runId;
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

      source.addEventListener("assistant.tool_pending", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        if (payload && typeof payload === "object") {
          setPendingTool(payload as PendingToolCall);
        }
      });

      source.addEventListener("assistant.tool_rejected", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const msg = typeof payload === "object" && payload !== null
          ? String((payload as { message?: string }).message ?? "操作已取消")
          : "操作已取消";
        appendMessage("system", msg);
        setPendingTool(null);
        setIsGenerating(false);
        closeStream();
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
    selectedCommand,
  ]);

  const handleClearHistory = useCallback(async () => {
    if (!projectKey || !sessionId) return;
    try {
      await clearChatSession(projectKey, sessionId);
      setMessages([]);
      setSessionId(`session-${createId()}`);
    } catch {
      setMessages([]);
      setSessionId(`session-${createId()}`);
    }
  }, [projectKey, sessionId]);

  /**
   * Stop the current generation
   * Closes the SSE stream and saves partial response if any
   */
  const handleStop = useCallback(() => {
    // Close the stream connection
    closeStream();
    
    // If there's a partial response in the buffer, save it
    if (assistantBufferRef.current) {
      appendMessage("assistant", assistantBufferRef.current + "\n\n[已停止]");
      resetAssistantBuffer();
    }
    
    setIsGenerating(false);
  }, [closeStream, appendMessage, resetAssistantBuffer]);

  const handleDraftApplied = useCallback((docId: string, isNew: boolean) => {
    setPendingDraft(null);
    const action = isNew ? "创建" : "更新";
    appendMessage("system", `文档已${action}。`);
    handleDocumentNavigate(docId, {});
  }, [appendMessage, handleDocumentNavigate]);

  const handleDraftClose = useCallback(() => {
    setPendingDraft(null);
  }, []);

  const handleConfirmTool = useCallback(async () => {
    const runId = currentRunIdRef.current;
    if (!projectKey || !runId || !pendingTool) return;

    try {
      await confirmTool(projectKey, runId);
      setPendingTool(null);
      // The SSE stream will continue after confirmation
    } catch (err) {
      const msg = err instanceof Error ? err.message : "确认失败";
      appendMessage("system", `错误: ${msg}`);
      setPendingTool(null);
      setIsGenerating(false);
    }
  }, [projectKey, pendingTool, appendMessage]);

  const handleRejectTool = useCallback(async () => {
    const runId = currentRunIdRef.current;
    if (!projectKey || !runId) {
      setPendingTool(null);
      return;
    }

    try {
      await rejectTool(projectKey, runId);
      setPendingTool(null);
      appendMessage("system", "操作已取消");
      setIsGenerating(false);
      closeStream();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "取消失败";
      appendMessage("system", `错误: ${msg}`);
      setPendingTool(null);
      setIsGenerating(false);
    }
  }, [projectKey, appendMessage, closeStream]);

  const mentionStateRef = useRef(mentionState);
  useEffect(() => {
    mentionStateRef.current = mentionState;
  }, [mentionState]);

  const handleMentionSelect = useCallback(
    (item: MentionItem) => {
      const currentMentionState = mentionStateRef.current;

      setMentions((prev) => {
        if (prev.some((m) => m.docId === item.docId)) {
          return prev;
        }
        return [...prev, item];
      });

      setInput((prev) => {
        const before = prev.slice(0, currentMentionState.startPos);
        const after = prev.slice(currentMentionState.startPos + currentMentionState.query.length + 1);
        return before + after;
      });

      setMentionState({ active: false, query: "", startPos: 0 });
    },
    [],
  );

  const handleMentionClose = useCallback(() => {
    setMentionState({ active: false, query: "", startPos: 0 });
  }, []);

  const handleRemoveMention = useCallback((docId: string) => {
    setMentions((prev) => prev.filter((m) => m.docId !== docId));
  }, []);

  const filteredSlashCommands = useMemo(() => {
    if (!slashActive) return [];
    return filterCommands(slashQuery);
  }, [slashActive, slashQuery]);

  const handleSlashSelect = useCallback((command: SlashCommand) => {
    setSelectedCommand(command);
    setInput((prev) => {
      const slashIndex = prev.lastIndexOf("/");
      if (slashIndex >= 0) {
        return prev.slice(0, slashIndex);
      }
      return prev;
    });
    setSlashActive(false);
    setSlashQuery("");
    setSlashSelectedIndex(0);
    inputRef.current?.focus();
  }, []);

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const cursorPos = e.target.selectionStart ?? value.length;

      setInput(value);

      if (mentionState.active) {
        const queryPart = value.slice(mentionState.startPos + 1, cursorPos);
        if (queryPart.includes(" ") || cursorPos <= mentionState.startPos) {
          setMentionState({ active: false, query: "", startPos: 0 });
        } else {
          setMentionState((prev) => ({ ...prev, query: queryPart }));
        }
      } else if (slashActive) {
        const slashIndex = value.lastIndexOf("/");
        if (slashIndex < 0 || cursorPos <= slashIndex) {
          setSlashActive(false);
          setSlashQuery("");
        } else {
          const queryPart = value.slice(slashIndex + 1, cursorPos);
          if (queryPart.includes(" ")) {
            setSlashActive(false);
            setSlashQuery("");
          } else {
            setSlashQuery(queryPart);
          }
        }
      } else {
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

        if (!selectedCommand && (value === "/" || (cursorPos === 1 && value.startsWith("/")))) {
          setSlashActive(true);
          setSlashQuery("");
          setSlashSelectedIndex(0);
        }
      }
    },
    [mentionState.active, mentionState.startPos, slashActive, selectedCommand],
  );

  const restoreHistoryEntry = useCallback((entry: CommandHistoryEntry) => {
    setInput(entry.input);
    setSelectedCommand(entry.command);
    setMentions(entry.mentions);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionState.active) {
        if (["ArrowDown", "ArrowUp", "Tab", "Escape", "Enter"].includes(event.key)) {
          event.preventDefault();
          return;
        }
      }

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

      if (event.key === "Backspace" && input === "" && selectedCommand) {
        event.preventDefault();
        setSelectedCommand(null);
        return;
      }

      if (event.key === "ArrowUp" && commandHistory.length > 0) {
        const textarea = event.currentTarget;
        const cursorAtStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0;

        if (cursorAtStart || input === "") {
          event.preventDefault();

          if (historyIndex === -1) {
            currentInputRef.current = {
              input,
              command: selectedCommand,
              mentions: [...mentions],
              timestamp: Date.now(),
            };
            const newIndex = commandHistory.length - 1;
            setHistoryIndex(newIndex);
            restoreHistoryEntry(commandHistory[newIndex]);
          } else if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            restoreHistoryEntry(commandHistory[newIndex]);
          }
          return;
        }
      }

      if (event.key === "ArrowDown" && historyIndex >= 0) {
        const textarea = event.currentTarget;
        const cursorAtEnd = textarea.selectionStart === input.length;

        if (cursorAtEnd || input === "") {
          event.preventDefault();

          if (historyIndex < commandHistory.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            restoreHistoryEntry(commandHistory[newIndex]);
          } else {
            setHistoryIndex(-1);
            if (currentInputRef.current) {
              restoreHistoryEntry(currentInputRef.current);
              currentInputRef.current = null;
            } else {
              setInput("");
              setSelectedCommand(null);
              setMentions([]);
            }
          }
          return;
        }
      }

      if (event.key !== "Enter") return;
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      handleSend();
    },
    [handleSend, mentionState.active, slashActive, filteredSlashCommands, slashSelectedIndex, handleSlashSelect, input, selectedCommand, commandHistory, historyIndex, mentions, restoreHistoryEntry],
  );

  return {
    // State
    messages,
    input,
    isGenerating,
    deepSearchEnabled,
    error,
    assistantBuffer,
    llmConfig,
    mentions,
    mentionState,
    pendingDraft,
    pendingTool,
    slashActive,
    slashQuery,
    slashSelectedIndex,
    selectedCommand,
    filteredSlashCommands,
    expandedSources,
    canSend,
    projectKey,

    // Refs
    messagesRef,
    inputRef,

    // Actions
    setInput,
    setError,
    setSlashSelectedIndex,
    setDeepSearchEnabled,
    handleSend,
    handleStop,
    handleClearHistory,
    handleInputChange,
    handleKeyDown,
    handleMentionSelect,
    handleMentionClose,
    handleRemoveMention,
    handleSlashSelect,
    handleDraftApplied,
    handleDraftClose,
    handleDocumentNavigate,
    handleProposalAction,
    handleConfirmTool,
    handleRejectTool,
    toggleSourcesExpanded,

    // Render helpers
    renderMarkdown,
    formatTime,
  };
}
