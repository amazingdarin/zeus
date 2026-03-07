/**
 * useChatLogic Hook
 *
 * Encapsulates all chat logic for reuse between ChatPanel and ChatPage.
 */

import type { KeyboardEvent, ChangeEvent, RefObject, UIEvent } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import {
  createChatRun,
  buildChatStreamUrl,
  clearChatSession,
  confirmTool,
  rejectTool,
  selectIntent,
  provideRequiredInput,
  providePreflightInput,
  type PendingToolCall,
  type PendingIntentInfo,
  type PendingPreflightInfo,
  type PendingRequiredInputInfo,
  type ChatTaskStatus,
  type ProvidePreflightInputPayload,
  type ProvideRequiredInputPayload,
  type IntentOption,
} from "../api/chat";
import { applyProposal, rejectProposal } from "../api/documents";
import { executeCommand } from "../api/commands";
import { useProjectContext } from "../context/ProjectContext";
import { getConfigByType, type ProviderConfig } from "../api/llm-config";
import type { MentionItem } from "../components/MentionDropdown";
import type { DocumentDraft } from "../api/drafts";
import Markdown from "../components/Markdown";
import {
  filterCommands,
  setCommandCatalog,
  setEnabledCommands,
  type SlashCommand,
} from "../constants/slash-commands";
import {
  getEnabledCommands,
  getProjectEnabledCommands,
  type ProjectEnabledCommand,
} from "../api/skills";
import { useChatAttachments, isValidUrl } from "./useChatAttachments";
import type { ChatAttachment } from "../types/chat-attachment";
import { shouldHandleSseDisconnectError } from "../features/chat/sse-error";
import { buildDocumentScopeForChat } from "../features/chat/document-scope";

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

export type ThinkingStep = {
  id: string;
  kind: "thinking" | "search_start" | "search_result";
  content: string;
  phase?: string;
  subQueries?: string[];
  searchQuery?: string;
  resultCount?: number;
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

function isPluginTemplateMention(item: MentionItem): boolean {
  return item.kind === "plugin_template";
}

function isDocMention(item: MentionItem): boolean {
  return !isPluginTemplateMention(item);
}

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

const normalizeThinkingPayload = (payload: unknown) => {
  const data = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
  const content = typeof data.content === "string"
    ? data.content
    : typeof payload === "string"
      ? payload
      : "";
  const phase = typeof data.phase === "string" ? data.phase : "";
  const searchQuery = typeof data.searchQuery === "string" ? data.searchQuery : "";
  const resultRaw = data.resultCount;
  const resultValue = resultRaw === undefined || resultRaw === null
    ? undefined
    : Number(resultRaw);
  const resultCount = Number.isFinite(resultValue) ? resultValue : undefined;
  const subQueries = Array.isArray(data.subQueries)
    ? data.subQueries
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
    : undefined;

  return {
    content: content.trim(),
    phase: phase.trim(),
    searchQuery: searchQuery.trim(),
    resultCount,
    subQueries: subQueries && subQueries.length > 0 ? subQueries : undefined,
  };
};

const normalizeTaskStatusPayload = (payload: unknown): ChatTaskStatus | null => {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const taskId = typeof data.taskId === "string" ? data.taskId.trim() : "";
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const skillId = typeof data.skillId === "string" ? data.skillId.trim() : "";
  const statusRaw = typeof data.status === "string" ? data.status.trim() : "";
  const status = statusRaw === "pending"
    || statusRaw === "running"
    || statusRaw === "completed"
    || statusRaw === "failed"
    || statusRaw === "skipped"
    ? statusRaw
    : "";
  if (!taskId || !title || !skillId || !status) return null;

  const indexValue = Number(data.index);
  const totalValue = Number(data.total);
  const index = Number.isFinite(indexValue) ? Math.max(1, Math.trunc(indexValue)) : 1;
  const total = Number.isFinite(totalValue) ? Math.max(index, Math.trunc(totalValue)) : index;
  const failurePolicy = data.failurePolicy === "best_effort" ? "best_effort" : "required";
  const message = typeof data.message === "string" ? data.message.trim() : undefined;
  const error = typeof data.error === "string" ? data.error.trim() : undefined;

  return {
    taskId,
    title,
    skillId,
    index,
    total,
    failurePolicy,
    status,
    ...(message ? { message } : {}),
    ...(error ? { error } : {}),
  };
};

const taskStatusToThinkingContent = (status: ChatTaskStatus): string => {
  const prefix = `子任务 ${status.index}/${status.total}`;
  switch (status.status) {
    case "pending":
      return `${prefix} 待执行：${status.title}`;
    case "running":
      return `${prefix} 开始执行：${status.title}`;
    case "completed":
      return status.message
        ? `${prefix} 已完成：${status.title}（${status.message}）`
        : `${prefix} 已完成：${status.title}`;
    case "skipped":
      return status.error
        ? `${prefix} 已跳过：${status.title}（${status.error}）`
        : `${prefix} 已跳过：${status.title}`;
    case "failed":
    default:
      return status.error
        ? `${prefix} 失败：${status.title}（${status.error}）`
        : `${prefix} 失败：${status.title}`;
  }
};

// Markdown rendering for assistant messages
export function renderMarkdown(content: string): React.ReactNode {
  return <Markdown content={content} variant="chat" />;
}

type UseChatLogicOptions = {
  onOpenSettings?: () => void;
  autoScrollEnabled?: boolean;
  deepSearchEnabled?: boolean;
  onDeepSearchChange?: (enabled: boolean) => void;
  defaultDocumentId?: string;
  /** Externally managed session ID (takes priority over internal state) */
  sessionId?: string;
  /** Callback when a new session is created internally */
  onSessionChange?: (id: string) => void;
};

export type UseChatLogicReturn = {
  // State
  messages: ChatMessage[];
  input: string;
  isGenerating: boolean;
  deepSearchEnabled: boolean;
  error: string | null;
  assistantBuffer: string;
  thinkingSteps: ThinkingStep[];
  taskTodoItems: ChatTaskStatus[];
  llmConfig: ProviderConfig | null;
  mentions: MentionItem[];
  mentionState: MentionState;
  pendingDraft: DocumentDraft | null;
  pendingTool: PendingToolCall | null;
  pendingIntentInfo: PendingIntentInfo | null;
  pendingPreflightInfo: PendingPreflightInfo | null;
  pendingRequiredInput: PendingRequiredInputInfo | null;
  slashActive: boolean;
  slashQuery: string;
  slashSelectedIndex: number;
  selectedCommand: SlashCommand | null;
  filteredSlashCommands: SlashCommand[];
  expandedSources: Set<string>;
  canSend: boolean;
  projectKey: string;

  // Attachments
  attachments: ChatAttachment[];
  hasAttachments: boolean;
  attachmentsLoading: boolean;

  // Refs
  messagesRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;

  // Actions
  setInput: (value: string) => void;
  setError: (error: string | null) => void;
  setSlashSelectedIndex: (index: number) => void;
  setDeepSearchEnabled: (enabled: boolean) => void;
  handleMessagesScroll: (event: UIEvent<HTMLDivElement>) => void;
  handleSend: () => Promise<void>;
  handleStop: () => void;
  handleClearHistory: () => Promise<void>;
  handleNewSession: () => Promise<void>;
  sessionId: string;
  handleInputChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleMentionSelect: (item: MentionItem) => void;
  handleMentionClose: () => void;
  handleRemoveMention: (mentionId: string) => void;
  handleSlashSelect: (command: SlashCommand) => void;
  handleDraftApplied: (docId: string, isNew: boolean) => void;
  handleDraftClose: () => void;
  handleDocumentNavigate: (docId: string, options?: { proposalId?: string; blockId?: string }) => void;
  handleProposalAction: (action: string, docId: string, proposalId: string) => Promise<void>;
  handleConfirmTool: () => Promise<void>;
  handleRejectTool: () => Promise<void>;
  handleSelectIntent: (option: IntentOption) => Promise<void>;
  handleProvidePreflightInput: (payload: ProvidePreflightInputPayload) => Promise<void>;
  handleProvideRequiredInput: (payload: ProvideRequiredInputPayload) => Promise<void>;
  toggleSourcesExpanded: (messageId: string) => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  handleAddAttachmentFile: (file: File) => void;
  removeAttachment: (id: string) => void;

  // Render helpers
  renderMarkdown: typeof renderMarkdown;
  formatTime: typeof formatTime;
};

export function useChatLogic(options: UseChatLogicOptions = {}): UseChatLogicReturn {
  const {
    autoScrollEnabled = true,
    deepSearchEnabled: externalDeepSearch,
    onDeepSearchChange,
    defaultDocumentId,
    sessionId: externalSessionId,
    onSessionChange,
  } = options;
  const { currentProject } = useProjectContext();
  const projectKey = currentProject?.projectRef ?? "";
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [internalDeepSearch, setInternalDeepSearch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chat attachments
  const {
    attachments,
    addFile: addAttachmentFile,
    addUrl: addAttachmentUrl,
    removeAttachment,
    clearAttachments,
    hasAttachments,
    isLoading: attachmentsLoading,
    getAttachmentsContext,
  } = useChatAttachments();

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
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [taskTodoItems, setTaskTodoItems] = useState<ChatTaskStatus[]>([]);
  const [isUserBrowsingHistory, setIsUserBrowsingHistory] = useState(false);
  const [llmConfig, setLlmConfig] = useState<ProviderConfig | null>(null);
  const [internalSessionId, setInternalSessionId] = useState<string>(() => `session-${createId()}`);

  // Use external sessionId if provided, otherwise internal
  const sessionId = externalSessionId || internalSessionId;
  const setSessionId = useCallback((id: string) => {
    setInternalSessionId(id);
    onSessionChange?.(id);
  }, [onSessionChange]);

  // Load history when sessionId changes (from external switching)
  useEffect(() => {
    if (!projectKey || !externalSessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const { getSessionMessages } = await import("../api/chat-sessions");
        const msgs = await getSessionMessages(projectKey, externalSessionId);
        if (cancelled) return;
        setMessages(
          msgs.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            sources: m.sources,
            artifacts: m.artifacts,
            timestamp: new Date(m.createdAt).getTime(),
          })),
        );
      } catch {
        if (!cancelled) setMessages([]);
      }
    })();
    return () => { cancelled = true; };
  }, [projectKey, externalSessionId]);

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
  const [pendingIntentInfo, setPendingIntentInfo] = useState<PendingIntentInfo | null>(null);
  const [pendingPreflightInfo, setPendingPreflightInfo] = useState<PendingPreflightInfo | null>(null);
  const [pendingRequiredInput, setPendingRequiredInput] = useState<PendingRequiredInputInfo | null>(null);
  const currentRunIdRef = useRef<string | null>(null);

  // Slash command state
  const [slashActive, setSlashActive] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  // Selected command (displayed as a tag, acts as a unit for undo)
  const [selectedCommand, setSelectedCommand] = useState<SlashCommand | null>(null);

  // Command history (for arrow up/down navigation)
  const MAX_HISTORY = 50;
  const historyKey = projectKey && sessionId
    ? `zeus-cmd-history-${projectKey}-${sessionId}`
    : "";
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const currentInputRef = useRef<CommandHistoryEntry | null>(null);
  const [loadedHistoryKey, setLoadedHistoryKey] = useState<string>("");

  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasCustomEventsRef = useRef(false);
  const assistantBufferRef = useRef("");
  const programmaticScrollRef = useRef(false);
  const prevAutoScrollEnabledRef = useRef(autoScrollEnabled);
  const lastScrollTopRef = useRef(0);

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
    const hasTypedInput = input.trim().length > 0;
    const hasSelectedCommand = Boolean(selectedCommand);
    const hasPluginTemplateMention = mentions.some(isPluginTemplateMention);
    return !isGenerating
      && projectKey !== ""
      && (hasTypedInput || hasSelectedCommand || hasPluginTemplateMention);
  }, [isGenerating, input, projectKey, selectedCommand, mentions]);

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
      if (!projectKey) {
        setCommandCatalog(undefined);
        setEnabledCommands([]);
        return;
      }

      try {
        const projectData = await getProjectEnabledCommands(projectKey);
        const commandCatalog = projectData.commands.map((cmd: ProjectEnabledCommand) => ({
          command: cmd.command,
          name: cmd.name || cmd.command.replace(/^\//, ""),
          description: cmd.description || cmd.command,
          category: cmd.category || "system",
          requiresDocScope: cmd.requiresDocScope,
        }));
        setCommandCatalog(commandCatalog);
        setEnabledCommands(commandCatalog.map((cmd) => cmd.command));
      } catch {
        try {
          const legacyData = await getEnabledCommands();
          setCommandCatalog(undefined);
          setEnabledCommands(legacyData.commands);
        } catch {
          // Default to local command catalog if both endpoints fail
          console.warn("Failed to load enabled commands, defaulting to local command catalog");
          setCommandCatalog(undefined);
        }
      }
    };
    loadEnabledSkills();
  }, [projectKey]);

  // Load command history for the current session from localStorage
  useEffect(() => {
    setHistoryIndex(-1);
    currentInputRef.current = null;
    setLoadedHistoryKey("");

    if (!historyKey) {
      setCommandHistory([]);
      return;
    }

    try {
      const saved = localStorage.getItem(historyKey);
      if (!saved) {
        setCommandHistory([]);
        return;
      }

      const parsed = JSON.parse(saved) as unknown;
      if (!Array.isArray(parsed)) {
        setCommandHistory([]);
        return;
      }

      const normalized: CommandHistoryEntry[] = [];
      for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        if (typeof record.input !== "string") continue;

        const mentionsRaw = Array.isArray(record.mentions) ? record.mentions : [];
        const safeMentions: MentionItem[] = [];
        for (const m of mentionsRaw) {
          if (!m || typeof m !== "object") continue;
          const mr = m as Record<string, unknown>;
          const kind = mr.kind === "plugin_template" ? "plugin_template" : "doc";
          const docId = typeof mr.docId === "string" ? mr.docId : "";
          if (!docId) continue;
          const title = typeof mr.title === "string" ? mr.title : "";
          const titlePath = typeof mr.titlePath === "string" ? mr.titlePath : title;
          if (kind === "plugin_template") {
            safeMentions.push({
              kind,
              docId,
              title,
              titlePath,
              includeChildren: false,
              pluginId: typeof mr.pluginId === "string" ? mr.pluginId : "ppt-plugin",
              command: typeof mr.command === "string" ? mr.command : "/ppt-agent",
              templateId: typeof mr.templateId === "string" ? mr.templateId : undefined,
            });
          } else {
            safeMentions.push({
              kind: "doc",
              docId,
              title,
              titlePath,
              includeChildren: Boolean(mr.includeChildren),
            });
          }
        }

        let safeCommand: SlashCommand | null = null;
        if (record.command && typeof record.command === "object") {
          const cr = record.command as Record<string, unknown>;
          const cmd = typeof cr.command === "string" ? cr.command : "";
          if (cmd.startsWith("/")) {
            safeCommand = {
              command: cmd,
              name: typeof cr.name === "string" ? cr.name : cmd.replace(/^\//, ""),
              description: typeof cr.description === "string" ? cr.description : cmd,
              category: typeof cr.category === "string" ? cr.category : "system",
              icon: typeof cr.icon === "string" ? cr.icon : undefined,
              requiresDocScope: Boolean(cr.requiresDocScope),
            };
          }
        }

        normalized.push({
          input: record.input,
          command: safeCommand,
          mentions: safeMentions,
          timestamp: typeof record.timestamp === "number" ? record.timestamp : Date.now(),
        });
      }

      setCommandHistory(normalized.slice(-MAX_HISTORY));
    } catch {
      // Ignore parse errors
      setCommandHistory([]);
    } finally {
      setLoadedHistoryKey(historyKey);
    }
  }, [historyKey]);

  // Save command history for the current session to localStorage
  useEffect(() => {
    if (!historyKey) return;
    if (loadedHistoryKey !== historyKey) return;
    try {
      const toSave = commandHistory.slice(-MAX_HISTORY);
      if (toSave.length === 0) {
        localStorage.removeItem(historyKey);
      } else {
        localStorage.setItem(historyKey, JSON.stringify(toSave));
      }
    } catch {
      // Ignore storage errors
    }
  }, [historyKey, loadedHistoryKey, commandHistory]);

  const isNearBottom = useCallback((container: HTMLDivElement) => {
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distance <= 40;
  }, []);

  const handleMessagesScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!autoScrollEnabled || programmaticScrollRef.current) {
      return;
    }
    const container = event.currentTarget;
    const currentTop = container.scrollTop;
    const scrollingUp = currentTop < lastScrollTopRef.current - 1;
    lastScrollTopRef.current = currentTop;
    const nearBottom = isNearBottom(container);
    setIsUserBrowsingHistory((prev) => {
      if (nearBottom) {
        return false;
      }
      if (scrollingUp) {
        return true;
      }
      return prev ? prev : true;
    });
  }, [autoScrollEnabled, isNearBottom]);

  useEffect(() => {
    const prev = prevAutoScrollEnabledRef.current;
    prevAutoScrollEnabledRef.current = autoScrollEnabled;
    if (autoScrollEnabled && !prev) {
      setIsUserBrowsingHistory(false);
      lastScrollTopRef.current = 0;
    }
    if (!autoScrollEnabled) {
      programmaticScrollRef.current = false;
    }
  }, [autoScrollEnabled]);

  useEffect(() => {
    setIsUserBrowsingHistory(false);
    lastScrollTopRef.current = 0;
  }, [projectKey, sessionId]);

  // Auto scroll to bottom
  useEffect(() => {
    if (!autoScrollEnabled || isUserBrowsingHistory) return;
    const container = messagesRef.current;
    if (!container) return;
    let releaseHandle = 0;
    const handle = requestAnimationFrame(() => {
      programmaticScrollRef.current = true;
      container.scrollTop = container.scrollHeight;
      lastScrollTopRef.current = container.scrollTop;
      releaseHandle = requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
    });
    return () => {
      cancelAnimationFrame(handle);
      if (releaseHandle) {
        cancelAnimationFrame(releaseHandle);
      }
      programmaticScrollRef.current = false;
    };
  }, [messages, assistantBuffer, thinkingSteps, taskTodoItems, autoScrollEnabled, isUserBrowsingHistory]);

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

  const resetThinkingSteps = useCallback(() => {
    setThinkingSteps([]);
  }, []);

  const resetTaskTodoItems = useCallback(() => {
    setTaskTodoItems([]);
  }, []);

  const upsertTaskTodoItem = useCallback((taskStatus: ChatTaskStatus) => {
    setTaskTodoItems((prev) => {
      const next = [...prev];
      const index = next.findIndex((item) => item.taskId === taskStatus.taskId);
      if (index >= 0) {
        const existing = next[index];
        next[index] = {
          ...existing,
          ...taskStatus,
        };
      } else {
        next.push(taskStatus);
      }
      next.sort((a, b) => {
        if (a.index !== b.index) return a.index - b.index;
        return a.taskId.localeCompare(b.taskId);
      });
      return next;
    });
  }, []);

  const appendThinkingStep = useCallback((step: Omit<ThinkingStep, "id" | "timestamp">) => {
    const fallbackContent = step.kind === "search_start"
      ? "开始检索"
      : step.kind === "search_result"
        ? "检索结果已返回"
        : "正在思考";

    const normalized: ThinkingStep = {
      id: createId(),
      kind: step.kind,
      content: step.content?.trim() || fallbackContent,
      phase: step.phase?.trim() || undefined,
      searchQuery: step.searchQuery?.trim() || undefined,
      resultCount: typeof step.resultCount === "number" && Number.isFinite(step.resultCount)
        ? step.resultCount
        : undefined,
      subQueries: step.subQueries && step.subQueries.length > 0 ? step.subQueries : undefined,
      timestamp: Date.now(),
    };

    setThinkingSteps((prev) => {
      const last = prev[prev.length - 1];
      if (
        last
        && last.kind === normalized.kind
        && last.content === normalized.content
        && (last.phase ?? "") === (normalized.phase ?? "")
        && (last.searchQuery ?? "") === (normalized.searchQuery ?? "")
        && (last.resultCount ?? -1) === (normalized.resultCount ?? -1)
        && (last.subQueries ?? []).join("\n") === (normalized.subQueries ?? []).join("\n")
      ) {
        return prev;
      }
      return [...prev, normalized];
    });
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

    const currentMentions = [...mentions];
    const docMentions = currentMentions.filter(isDocMention);
    const pluginTemplateMentions = currentMentions.filter(isPluginTemplateMention);
    const selectedPptTemplateMention = pluginTemplateMentions[pluginTemplateMentions.length - 1];
    const autoPptAgentCommand: SlashCommand | null = !selectedCommand && selectedPptTemplateMention
      ? {
          command: selectedPptTemplateMention.command || "/ppt-agent",
          name: "PPT Agent",
          description: "基于文档与知识库生成 PPT 类文档并导出",
          category: "plugin",
          icon: "📊",
          requiresDocScope: false,
        }
      : null;
    const effectiveCommand = selectedCommand || autoPptAgentCommand;
    const commandPrefix = effectiveCommand ? `${effectiveCommand.command} ` : "";
    const displayMessage = `${commandPrefix}${input.trim()}`.trim();
    let messageBody = input.trim();
    if (effectiveCommand?.command === "/ppt-agent" && selectedPptTemplateMention?.templateId) {
      const templateArg = `template_id=${selectedPptTemplateMention.templateId}`;
      messageBody = messageBody ? `${templateArg} ${messageBody}` : templateArg;
    }
    const message = `${commandPrefix}${messageBody}`.trim();
    if (!message) return;

    // Get attachments context before clearing
    const attachmentsContext = getAttachmentsContext();
    const currentAttachments = [...attachments];

    // Save to command history before clearing
    const historyEntry: CommandHistoryEntry = {
      input: input,
      command: effectiveCommand,
      mentions: [...currentMentions],
      timestamp: Date.now(),
    };
    setCommandHistory((prev) => [...prev, historyEntry].slice(-MAX_HISTORY));
    setHistoryIndex(-1);
    currentInputRef.current = null;

    setInput("");
    setMentions([]);
    setSelectedCommand(null);
    setMentionState({ active: false, query: "", startPos: 0 });
    setError(null);
    setPendingIntentInfo(null);
    setPendingPreflightInfo(null);
    setPendingRequiredInput(null);
    clearAttachments();

    // Build display message with mention info and attachments
    const docScopeInfo = docMentions.length > 0
      ? `[检索范围: ${docMentions.map((m) => m.titlePath + (m.includeChildren ? "/" : "")).join(", ")}]\n`
      : "";
    const pluginResourceInfo = pluginTemplateMentions.length > 0
      ? `[插件资源: ${pluginTemplateMentions.map((m) => `@ppt:${m.title}`).join(", ")}]\n`
      : "";
    const mentionInfo = `${docScopeInfo}${pluginResourceInfo}`;
    const attachmentInfo = currentAttachments.length > 0
      ? `[附件: ${currentAttachments.map((a) => a.name).join(", ")}]\n`
      : "";
    appendMessage("user", mentionInfo + attachmentInfo + (displayMessage || message));
    setIsGenerating(true);
    resetAssistantBuffer();
    resetThinkingSteps();
    resetTaskTodoItems();
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

      const documentScope = buildDocumentScopeForChat({
        mentions: currentMentions,
        defaultDocumentId,
      });

      const attachmentAssets = currentAttachments.flatMap((a) => {
        if (a.status !== "ready" || !a.assetId) return [];
        if (a.type !== "file" && a.type !== "image") return [];
        return [{
          assetId: a.assetId,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
          type: a.type,
        }];
      });

      // Combine message with attachments context
      const fullMessage = attachmentsContext
        ? `${message}\n\n---\n附件内容:\n${attachmentsContext}`
        : message;

      const runId = await createChatRun(projectKey, fullMessage, {
        sessionId,
        documentScope,
        ...(attachmentAssets.length > 0 ? { attachments: attachmentAssets } : {}),
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
        const thinking = normalizeThinkingPayload(payload);
        appendThinkingStep({
          kind: "thinking",
          content: thinking.content,
          phase: thinking.phase,
          searchQuery: thinking.searchQuery,
          resultCount: thinking.resultCount,
          subQueries: thinking.subQueries,
        });
      });

      source.addEventListener("assistant.search_start", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const thinking = normalizeThinkingPayload(payload);
        appendThinkingStep({
          kind: "search_start",
          content: thinking.content,
          phase: thinking.phase,
          searchQuery: thinking.searchQuery,
          resultCount: thinking.resultCount,
          subQueries: thinking.subQueries,
        });
      });

      source.addEventListener("assistant.search_result", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const thinking = normalizeThinkingPayload(payload);
        appendThinkingStep({
          kind: "search_result",
          content: thinking.content,
          phase: thinking.phase,
          searchQuery: thinking.searchQuery,
          resultCount: thinking.resultCount,
          subQueries: thinking.subQueries,
        });
      });

      source.addEventListener("assistant.task_status", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const taskStatus = normalizeTaskStatusPayload(payload);
        if (!taskStatus) return;
        upsertTaskTodoItem(taskStatus);
        if (taskStatus.status === "pending") return;
        appendThinkingStep({
          kind: "thinking",
          content: taskStatusToThinkingContent(taskStatus),
        });
      });

      source.addEventListener("assistant.draft", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        if (payload && typeof payload === "object") {
          setPendingDraft(payload as DocumentDraft);
        }
      });

      source.addEventListener("assistant.intent_pending", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        if (payload && typeof payload === "object" && payload !== null) {
          setPendingPreflightInfo(null);
          setPendingIntentInfo(payload as PendingIntentInfo);
        }
      });

      source.addEventListener("assistant.preflight_pending", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        if (payload && typeof payload === "object" && payload !== null) {
          setPendingIntentInfo(null);
          setPendingRequiredInput(null);
          setPendingPreflightInfo(payload as PendingPreflightInfo);
        }
      });

      source.addEventListener("assistant.input_pending", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        if (payload && typeof payload === "object" && payload !== null) {
          setPendingPreflightInfo(null);
          setPendingRequiredInput(payload as PendingRequiredInputInfo);
        }
      });

      source.addEventListener("assistant.tool_pending", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        if (payload && typeof payload === "object") {
          setPendingIntentInfo(null);
          setPendingPreflightInfo(null);
          setPendingRequiredInput(null);
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
        setPendingIntentInfo(null);
        setPendingPreflightInfo(null);
        setPendingRequiredInput(null);
        setIsGenerating(false);
        resetThinkingSteps();
        resetTaskTodoItems();
        closeStream();
      });

      source.addEventListener("assistant.done", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const { message: doneMessage, artifacts, sources } = normalizeDonePayload(payload);
        setIsGenerating(false);
        setPendingIntentInfo(null);
        setPendingPreflightInfo(null);
        setPendingRequiredInput(null);
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
        setPendingIntentInfo(null);
        setPendingPreflightInfo(null);
        setPendingRequiredInput(null);
        resetThinkingSteps();
        resetTaskTodoItems();
        resetAssistantBuffer();
        closeStream();
      });

      source.onmessage = (event) => {
        if (hasCustomEventsRef.current) return;
        const payload = parsePayload(event.data);
        if (payload === null || payload === "null") {
          setIsGenerating(false);
          resetThinkingSteps();
          resetTaskTodoItems();
          closeStream();
          return;
        }
        if (payload && typeof payload === "object" && "error" in payload) {
          const errMsg = String((payload as { error?: string }).error ?? "对话失败");
          setError(errMsg);
          appendMessage("system", `错误: ${errMsg}`);
          setIsGenerating(false);
          resetThinkingSteps();
          resetTaskTodoItems();
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
        if (!shouldHandleSseDisconnectError({
          isActiveSource: eventSourceRef.current === source,
          readyState: source.readyState,
        })) {
          return;
        }
        setError("连接中断");
        appendMessage("system", "错误: 连接中断");
        setIsGenerating(false);
        setPendingIntentInfo(null);
        setPendingPreflightInfo(null);
        setPendingRequiredInput(null);
        resetThinkingSteps();
        resetTaskTodoItems();
        resetAssistantBuffer();
        closeStream();
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "发送失败";
      setError(errMsg);
      appendMessage("system", `错误: ${errMsg}`);
      setIsGenerating(false);
      resetThinkingSteps();
      resetTaskTodoItems();
      resetAssistantBuffer();
      closeStream();
    }
  }, [
    appendMessage,
    appendThinkingStep,
    canSend,
    closeStream,
    commitAssistantBuffer,
    handleDelta,
    input,
    upsertTaskTodoItem,
    projectKey,
    resetAssistantBuffer,
    resetThinkingSteps,
    resetTaskTodoItems,
    sessionId,
    mentions,
    selectedCommand,
  ]);

  const handleClearHistory = useCallback(async () => {
    if (!projectKey || !sessionId) return;

    // Clear per-session command history (both in-memory and persisted).
    try {
      if (historyKey) {
        localStorage.removeItem(historyKey);
      }
      localStorage.removeItem(`zeus-task-todo-expanded-${projectKey}-${sessionId}`);
    } catch {
      // Ignore storage errors
    }
    setLoadedHistoryKey("");
    setCommandHistory([]);
    setHistoryIndex(-1);
    currentInputRef.current = null;
    resetAssistantBuffer();
    resetThinkingSteps();
    resetTaskTodoItems();

    try {
      await clearChatSession(projectKey, sessionId);
      setMessages([]);
      setSessionId(`session-${createId()}`);
    } catch {
      setMessages([]);
      setSessionId(`session-${createId()}`);
    }
  }, [historyKey, projectKey, resetAssistantBuffer, resetThinkingSteps, resetTaskTodoItems, sessionId, setSessionId]);

  const handleNewSession = useCallback(async () => {
    if (!projectKey) return;

    // Reset command history navigation state; do NOT delete persisted history for the old session.
    // Setting loadedHistoryKey first prevents the save effect from removing the old key.
    setLoadedHistoryKey("");
    setCommandHistory([]);
    setHistoryIndex(-1);
    currentInputRef.current = null;
    resetAssistantBuffer();
    resetThinkingSteps();
    resetTaskTodoItems();

    // Do not create empty sessions in backend; persist only after first message is sent.
    setMessages([]);
    setSessionId(`session-${createId()}`);
  }, [projectKey, resetAssistantBuffer, resetThinkingSteps, resetTaskTodoItems, setSessionId]);

  /**
   * Stop the current generation
   * Closes the SSE stream and saves partial response if any
   */
  const handleStop = useCallback(() => {
    // Close the stream connection
    closeStream();
    setPendingIntentInfo(null);
    setPendingPreflightInfo(null);
    setPendingRequiredInput(null);
    resetThinkingSteps();
    resetTaskTodoItems();

    // If there's a partial response in the buffer, save it
    if (assistantBufferRef.current) {
      appendMessage("assistant", assistantBufferRef.current + "\n\n[已停止]");
      resetAssistantBuffer();
    }
    
    setIsGenerating(false);
  }, [appendMessage, closeStream, resetAssistantBuffer, resetThinkingSteps, resetTaskTodoItems]);

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
      resetThinkingSteps();
      resetTaskTodoItems();
      closeStream();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "取消失败";
      appendMessage("system", `错误: ${msg}`);
      setPendingTool(null);
      setIsGenerating(false);
    }
  }, [projectKey, appendMessage, closeStream, resetThinkingSteps, resetTaskTodoItems]);

  const handleSelectIntent = useCallback(async (option: IntentOption) => {
    const runId = currentRunIdRef.current;
    if (!projectKey || !runId) {
      setPendingIntentInfo(null);
      return;
    }

    try {
      await selectIntent(projectKey, runId, option);
      setPendingIntentInfo(null);
      // The SSE stream will continue after selection.
    } catch (err) {
      const msg = err instanceof Error ? err.message : "选择失败";
      appendMessage("system", `错误: ${msg}`);
      setPendingIntentInfo(null);
      setIsGenerating(false);
      closeStream();
    }
  }, [projectKey, appendMessage, closeStream]);

  const handleProvidePreflightInput = useCallback(async (payload: ProvidePreflightInputPayload) => {
    const runId = currentRunIdRef.current;
    if (!projectKey || !runId) {
      setPendingPreflightInfo(null);
      return;
    }

    try {
      await providePreflightInput(projectKey, runId, payload);
      setPendingPreflightInfo(null);
      // SSE stream will continue after providing preflight input.
    } catch (err) {
      const msg = err instanceof Error ? err.message : "提交失败";
      appendMessage("system", `错误: ${msg}`);
      setPendingPreflightInfo(null);
      setIsGenerating(false);
      closeStream();
    }
  }, [projectKey, appendMessage, closeStream]);

  const handleProvideRequiredInput = useCallback(async (payload: ProvideRequiredInputPayload) => {
    const runId = currentRunIdRef.current;
    if (!projectKey || !runId) {
      setPendingRequiredInput(null);
      return;
    }

    try {
      await provideRequiredInput(projectKey, runId, payload);
      setPendingRequiredInput(null);
      // SSE stream will continue after providing input.
    } catch (err) {
      const msg = err instanceof Error ? err.message : "提交失败";
      appendMessage("system", `错误: ${msg}`);
      setPendingRequiredInput(null);
      setIsGenerating(false);
      closeStream();
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
        if (item.kind === "plugin_template") {
          const filtered = prev.filter((m) => m.kind !== "plugin_template");
          return [...filtered, item];
        }
        if (prev.some((m) => m.docId === item.docId && m.kind !== "plugin_template")) {
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

  const handleRemoveMention = useCallback((mentionId: string) => {
    setMentions((prev) => prev.filter((m) => m.docId !== mentionId));
  }, []);

  // Paste handling for attachments
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!projectKey) return;

      // Check for files (images, etc.)
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        e.preventDefault();
        for (let i = 0; i < files.length; i++) {
          addAttachmentFile(projectKey, files[i]);
        }
        return;
      }

      // Check for URL text
      const text = e.clipboardData?.getData("text/plain") || "";
      const trimmedText = text.trim();
      if (isValidUrl(trimmedText)) {
        e.preventDefault();
        addAttachmentUrl(projectKey, trimmedText);
        return;
      }

      // Let normal paste behavior continue for plain text
    },
    [projectKey, addAttachmentFile, addAttachmentUrl]
  );

  const handleAddAttachmentFile = useCallback((file: File) => {
    if (!projectKey || !file) {
      return;
    }
    addAttachmentFile(projectKey, file);
  }, [addAttachmentFile, projectKey]);

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
    thinkingSteps,
    taskTodoItems,
    llmConfig,
    mentions,
    mentionState,
    pendingDraft,
    pendingTool,
    pendingIntentInfo,
    pendingPreflightInfo,
    pendingRequiredInput,
    slashActive,
    slashQuery,
    slashSelectedIndex,
    selectedCommand,
    filteredSlashCommands,
    expandedSources,
    canSend,
    projectKey,

    // Attachments
    attachments,
    hasAttachments,
    attachmentsLoading,

    // Refs
    messagesRef,
    inputRef,

    // Actions
    setInput,
    setError,
    setSlashSelectedIndex,
    setDeepSearchEnabled,
    handleMessagesScroll,
    handleSend,
    handleStop,
    handleClearHistory,
    handleNewSession,
    sessionId,
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
    handleSelectIntent,
    handleProvidePreflightInput,
    handleProvideRequiredInput,
    toggleSourcesExpanded,
    handlePaste,
    handleAddAttachmentFile,
    removeAttachment,

    // Render helpers
    renderMarkdown,
    formatTime,
  };
}
