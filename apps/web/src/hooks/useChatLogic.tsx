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

import {
  createChatRun,
  buildChatStreamUrl,
  clearChatSession,
  confirmTool,
  rejectTool,
  selectIntent,
  provideRequiredInput,
  type DocumentScope,
  type PendingToolCall,
  type PendingIntentInfo,
  type PendingRequiredInputInfo,
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

// Markdown rendering for assistant messages
export function renderMarkdown(content: string): React.ReactNode {
  return <Markdown content={content} variant="chat" />;
}

type UseChatLogicOptions = {
  onOpenSettings?: () => void;
  autoScrollEnabled?: boolean;
  deepSearchEnabled?: boolean;
  onDeepSearchChange?: (enabled: boolean) => void;
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
  llmConfig: ProviderConfig | null;
  mentions: MentionItem[];
  mentionState: MentionState;
  pendingDraft: DocumentDraft | null;
  pendingTool: PendingToolCall | null;
  pendingIntentInfo: PendingIntentInfo | null;
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
  handleSend: () => Promise<void>;
  handleStop: () => void;
  handleClearHistory: () => Promise<void>;
  handleNewSession: () => Promise<void>;
  sessionId: string;
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
  handleSelectIntent: (option: IntentOption) => Promise<void>;
  handleProvideRequiredInput: (docId: string) => Promise<void>;
  toggleSourcesExpanded: (messageId: string) => void;
  handlePaste: (e: React.ClipboardEvent) => void;
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
    sessionId: externalSessionId,
    onSessionChange,
  } = options;
  const { currentProject } = useProjectContext();
  const projectKey = currentProject?.key ?? "";
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
          const docId = typeof mr.docId === "string" ? mr.docId : "";
          if (!docId) continue;
          const title = typeof mr.title === "string" ? mr.title : "";
          const titlePath = typeof mr.titlePath === "string" ? mr.titlePath : title;
          safeMentions.push({
            docId,
            title,
            titlePath,
            includeChildren: Boolean(mr.includeChildren),
          });
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

    // Get attachments context before clearing
    const attachmentsContext = getAttachmentsContext();
    const currentAttachments = [...attachments];

    // Save to command history before clearing
    const historyEntry: CommandHistoryEntry = {
      input: input,
      command: selectedCommand,
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
    setPendingRequiredInput(null);
    clearAttachments();

    // Build display message with mention info and attachments
    const mentionInfo = currentMentions.length > 0
      ? `[检索范围: ${currentMentions.map((m) => m.titlePath + (m.includeChildren ? "/" : "")).join(", ")}]\n`
      : "";
    const attachmentInfo = currentAttachments.length > 0
      ? `[附件: ${currentAttachments.map((a) => a.name).join(", ")}]\n`
      : "";
    appendMessage("user", mentionInfo + attachmentInfo + message);
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

      source.addEventListener("assistant.intent_pending", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        if (payload && typeof payload === "object" && payload !== null) {
          setPendingIntentInfo(payload as PendingIntentInfo);
        }
      });

      source.addEventListener("assistant.input_pending", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        if (payload && typeof payload === "object" && payload !== null) {
          setPendingRequiredInput(payload as PendingRequiredInputInfo);
        }
      });

      source.addEventListener("assistant.tool_pending", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        if (payload && typeof payload === "object") {
          setPendingIntentInfo(null);
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
        setPendingRequiredInput(null);
        setIsGenerating(false);
        closeStream();
      });

      source.addEventListener("assistant.done", (event) => {
        hasCustomEventsRef.current = true;
        const payload = parsePayload((event as MessageEvent).data);
        const { message: doneMessage, artifacts, sources } = normalizeDonePayload(payload);
        setIsGenerating(false);
        setPendingIntentInfo(null);
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
        setPendingRequiredInput(null);
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
        setPendingIntentInfo(null);
        setPendingRequiredInput(null);
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

    // Clear per-session command history (both in-memory and persisted).
    try {
      if (historyKey) {
        localStorage.removeItem(historyKey);
      }
    } catch {
      // Ignore storage errors
    }
    setLoadedHistoryKey("");
    setCommandHistory([]);
    setHistoryIndex(-1);
    currentInputRef.current = null;

    try {
      await clearChatSession(projectKey, sessionId);
      setMessages([]);
      setSessionId(`session-${createId()}`);
    } catch {
      setMessages([]);
      setSessionId(`session-${createId()}`);
    }
  }, [projectKey, sessionId, setSessionId, historyKey]);

  const handleNewSession = useCallback(async () => {
    if (!projectKey) return;

    // Reset command history navigation state; do NOT delete persisted history for the old session.
    // Setting loadedHistoryKey first prevents the save effect from removing the old key.
    setLoadedHistoryKey("");
    setCommandHistory([]);
    setHistoryIndex(-1);
    currentInputRef.current = null;

    try {
      const { createSession } = await import("../api/chat-sessions");
      const session = await createSession(projectKey);
      setMessages([]);
      setSessionId(session.id);
    } catch {
      // Fallback to local-only new session
      setMessages([]);
      setSessionId(`session-${createId()}`);
    }
  }, [projectKey, setSessionId]);

  /**
   * Stop the current generation
   * Closes the SSE stream and saves partial response if any
   */
  const handleStop = useCallback(() => {
    // Close the stream connection
    closeStream();
    setPendingIntentInfo(null);
    setPendingRequiredInput(null);
    
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

  const handleProvideRequiredInput = useCallback(async (docId: string) => {
    const runId = currentRunIdRef.current;
    if (!projectKey || !runId) {
      setPendingRequiredInput(null);
      return;
    }

    try {
      await provideRequiredInput(projectKey, runId, { doc_id: docId });
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
    pendingIntentInfo,
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
    handleProvideRequiredInput,
    toggleSourcesExpanded,
    handlePaste,
    removeAttachment,

    // Render helpers
    renderMarkdown,
    formatTime,
  };
}
