import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { createChatRun, buildChatStreamUrl } from "../api/chat";
import { applyProposal, rejectProposal } from "../api/documents";
import { executeCommand } from "../api/commands";
import { useProjectContext } from "../context/ProjectContext";
import type { PromptTemplate } from "../lib/promptRegistry";
import { filterPromptTemplates, findPromptTemplate } from "../lib/promptRegistry";
import SlashCommandPanel from "./SlashCommandPanel";
import PromptSlashPanel from "./PromptSlashPanel";
import { parseZeusText, renderZeusText } from "../lib/zeusText";


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

const extractDocsFromArtifacts = (
  artifacts: Array<{ type?: string; data?: Record<string, unknown> }>,
) => {
  const list = artifacts.find((artifact) => artifact.type === "document.list");
  const items = Array.isArray(list?.data?.items) ? (list?.data?.items as any[]) : [];
  return items
    .map((item) => ({
      id: String(item?.id ?? item?.doc_id ?? "").trim(),
      title: String(item?.title ?? "").trim() || "Untitled",
    }))
    .filter((item) => item.id);
};

type InputMode = "normal" | "slash" | "op_sub" | "prompt_sub" | "picker";

type InputState = {
  rawText: string;
  caret: number;
  mode: InputMode;
  isComposing: boolean;
  activePrompt?: PromptTemplate;
};

type InputAction =
  | { type: "TYPE"; rawText: string; caret: number; isComposing?: boolean }
  | { type: "ENTER" }
  | { type: "ESCAPE" }
  | { type: "RESET" }
  | { type: "SLASH_DETECTED"; active: boolean }
  | { type: "SELECT_SLASH"; kind: "op" | "prompt" | "plain" }
  | { type: "SELECT_PROMPT"; prompt: PromptTemplate }
  | { type: "REMOVE_PROMPT" }
  | { type: "OPEN_PICKER" }
  | { type: "PICK_ITEM" };

const initialInputState: InputState = {
  rawText: "",
  caret: 0,
  mode: "normal",
  isComposing: false,
  activePrompt: undefined,
};

const inputReducer = (state: InputState, action: InputAction): InputState => {
  switch (action.type) {
    case "TYPE":
      return {
        ...state,
        rawText: action.rawText,
        caret: action.caret,
        isComposing:
          typeof action.isComposing === "boolean" ? action.isComposing : state.isComposing,
      };
    case "SLASH_DETECTED":
      if (action.active) {
        if (state.mode === "normal") {
          return { ...state, mode: "slash" };
        }
        if (state.mode === "slash" || state.mode === "op_sub" || state.mode === "prompt_sub") {
          return state;
        }
        return state;
      }
      if (
        state.mode === "slash" ||
        state.mode === "op_sub" ||
        state.mode === "prompt_sub" ||
        state.mode === "picker"
      ) {
        return { ...state, mode: "normal" };
      }
      return state;
    case "SELECT_SLASH":
      if (action.kind === "op") {
        return { ...state, mode: "op_sub" };
      }
      if (action.kind === "prompt") {
        return { ...state, mode: "prompt_sub" };
      }
      return { ...state, mode: "normal" };
    case "SELECT_PROMPT":
      return { ...state, activePrompt: action.prompt, mode: "normal" };
    case "REMOVE_PROMPT":
      return { ...state, activePrompt: undefined, mode: "normal" };
    case "OPEN_PICKER":
      return { ...state, mode: "picker" };
    case "PICK_ITEM":
      return { ...state, mode: "normal" };
    case "ENTER":
      return state.mode === "slash" ? { ...state, mode: "normal" } : state;
    case "ESCAPE":
      return { ...state, mode: "normal" };
    case "RESET":
      return { ...initialInputState, activePrompt: state.activePrompt };
    default:
      return state;
  }
};

type SlashTokenState = {
  mode: "normal" | "slash";
  token: string;
  start: number;
  end: number;
};

const computeSlashTokenState = (
  text: string,
  caret: number,
  isComposing: boolean,
): SlashTokenState => {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const beforeCaret = text.slice(0, safeCaret);
  const lastSlash = beforeCaret.lastIndexOf("/");
  if (lastSlash < 0) {
    return { mode: "normal", token: "", start: -1, end: -1 };
  }
  const token = beforeCaret.slice(lastSlash);
  if (!isComposing && /\s/.test(token) && !token.startsWith("/in:")) {
    return { mode: "normal", token: "", start: -1, end: -1 };
  }
  return { mode: "slash", token, start: lastSlash, end: safeCaret };
};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const buildPromptMessage = (message: string, prompt?: PromptTemplate) => {
  if (!prompt) {
    return message;
  }
  if (prompt.id === "propose") {
    const trimmed = message.trim();
    return trimmed ? `/p:propose ${trimmed}` : "/p:propose";
  }
  const template = prompt.template?.trim();
  if (!template) {
    return message;
  }
  const replaced = template
    .replace(/\{\{input\}\}/g, message)
    .replace(/\{\{args\}\}/g, message);
  if (replaced !== template) {
    return replaced;
  }
  return `${template}\n${message}`;
};

function ChatDock() {
  const { currentProject } = useProjectContext();
  const projectKey = currentProject?.key ?? "";
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputState, dispatchInput] = useReducer(inputReducer, initialInputState);
  const input = inputState.rawText;
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantBuffer, setAssistantBuffer] = useState("");
  const [assistantActive, setAssistantActive] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHeight, setHistoryHeight] = useState(220);
  const [isResizing, setIsResizing] = useState(false);
  const [docOptions, setDocOptions] = useState<Array<{ id: string; title: string }>>(
    [],
  );
  const [activeDropdownKey, setActiveDropdownKey] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasCustomEventsRef = useRef(false);
  const prevInputModeRef = useRef<InputMode>("normal");
  const assistantBufferRef = useRef("");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const lastAppliedCaretRef = useRef<number | null>(null);

  const canSend = useMemo(() => {
    return !isGenerating && input.trim().length > 0 && projectKey !== "";
  }, [isGenerating, input, projectKey]);
  const showPanel = useMemo(() => {
    return historyOpen;
  }, [historyOpen]);

  const slashTokenState = useMemo(
    () =>
      computeSlashTokenState(
        inputState.rawText,
        inputState.caret,
        inputState.isComposing,
      ),
    [inputState.caret, inputState.isComposing, inputState.rawText],
  );

  const docTokenMatches = useMemo(() => extractDocTokenMatches(input), [input]);
  const highlightSlash =
    inputState.mode !== "normal" && slashTokenState.mode === "slash";
  const inputHtml = useMemo(
    () =>
      buildInputHtml(
        input,
        docTokenMatches,
        highlightSlash ? slashTokenState.start : -1,
        highlightSlash ? slashTokenState.end : -1,
      ),
    [
      docTokenMatches,
      highlightSlash,
      input,
      slashTokenState.end,
      slashTokenState.start,
    ],
  );

  const docSearchState = useMemo(() => {
    if (inputState.mode !== "slash" && inputState.mode !== "op_sub") {
      return { active: false, query: "", start: -1, end: -1 };
    }
    if (!slashTokenState.token.startsWith("/in:docs.search:")) {
      return { active: false, query: "", start: -1, end: -1 };
    }
    const prefix = "/in:docs.search:";
    const query = slashTokenState.token.slice(prefix.length).trim();
    return {
      active: true,
      query,
      start: slashTokenState.start,
      end: slashTokenState.end,
    };
  }, [inputState.mode, slashTokenState]);

  const promptSlashState = useMemo(() => {
    if (inputState.mode !== "slash" && inputState.mode !== "prompt_sub") {
      return { active: false, query: "", start: -1, end: -1 };
    }
    if (!slashTokenState.token.startsWith("/p:")) {
      return { active: false, query: "", start: -1, end: -1 };
    }
    const query = slashTokenState.token.slice(3).trim();
    return {
      active: true,
      query,
      start: slashTokenState.start,
      end: slashTokenState.end,
    };
  }, [inputState.mode, slashTokenState]);

  const promptOptions = useMemo(() => {
    if (!promptSlashState.active) {
      return [];
    }
    return filterPromptTemplates(promptSlashState.query).map((template) => ({
      value: template.id,
      label: `${template.id} — ${template.title}`,
    }));
  }, [promptSlashState.active, promptSlashState.query]);

  const slashOptions = useMemo(() => {
    if (inputState.mode !== "slash") {
      return [];
    }
    if (slashTokenState.token.startsWith("/in:docs.search:")) {
      return [];
    }
    if (slashTokenState.token.startsWith("/p:")) {
      return [];
    }
    return [
      { value: "/in:docs.search:", label: "in:docs.search: — insert a document reference" },
      { value: "/op:docs.list", label: "op:docs.list — list documents" },
      { value: "/op:docs.search", label: "op:docs.search — search documents" },
      { value: "/p:", label: "p: — insert a prompt template" },
    ];
  }, [inputState.mode, slashTokenState.token]);

  const dropdownOptions = useMemo(() => {
    if (promptSlashState.active) {
      return promptOptions;
    }
    if (docSearchState.active) {
      return [
        { value: "__cancel__", label: "Cancel" },
        ...docOptions.map((doc) => ({
          value: doc.id,
          label: doc.title,
        })),
      ];
    }
    return slashOptions;
  }, [
    docOptions,
    docSearchState.active,
    promptOptions,
    promptSlashState.active,
    slashOptions,
  ]);

  const optionFilter = useMemo(() => {
    if (docSearchState.active || promptSlashState.active) {
      return null;
    }
    return (option?: { value?: unknown }) => {
      const query = slashTokenState.token || input;
      return String(option?.value ?? "")
        .toLowerCase()
        .startsWith(query.toLowerCase());
    };
  }, [docSearchState.active, input, promptSlashState.active, slashTokenState.token]);

  const visibleOptions = useMemo(() => {
    if (!optionFilter) {
      return dropdownOptions;
    }
    return dropdownOptions.filter((option) => optionFilter(option));
  }, [dropdownOptions, optionFilter]);

  const pickerOpen = useMemo(() => {
    if (inputState.mode === "normal") {
      return false;
    }
    if (promptSlashState.active || docSearchState.active) {
      return true;
    }
    return inputState.mode === "slash" && slashOptions.length > 0;
  }, [
    docSearchState.active,
    inputState.mode,
    promptSlashState.active,
    slashOptions.length,
  ]);

  useEffect(() => {
    if (!pickerOpen || visibleOptions.length === 0) {
      setActiveDropdownKey(null);
      return;
    }
    const keys = visibleOptions.map((option) =>
      String(option.value ?? option.label ?? ""),
    );
    if (!activeDropdownKey || !keys.includes(activeDropdownKey)) {
      setActiveDropdownKey(keys[0] ?? null);
    }
  }, [activeDropdownKey, pickerOpen, visibleOptions]);

  useEffect(() => {
    const nextMode = inputState.mode;
    const prevMode = prevInputModeRef.current;
    if (nextMode !== prevMode) {
      console.log("[chat-dock] input mode switch", {
        from: prevMode,
        to: nextMode,
        token: slashTokenState.token,
        input,
      });
      prevInputModeRef.current = nextMode;
    }
  }, [input, inputState.mode, slashTokenState.token]);

  useLayoutEffect(() => {
    if (inputState.isComposing) {
      return;
    }
    const container = inputRef.current;
    if (!container) {
      return;
    }
    if (document.activeElement !== container) {
      return;
    }
    if (lastAppliedCaretRef.current === inputState.caret) {
      return;
    }
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }
    const range = document.createRange();
    let cursor = 0;
    let positioned = false;
    const placeCaret = (node: Node): boolean => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        const nextCursor = cursor + text.length;
        if (inputState.caret <= nextCursor) {
          const offset = Math.max(0, inputState.caret - cursor);
          range.setStart(node, offset);
          range.collapse(true);
          positioned = true;
          return true;
        }
        cursor = nextCursor;
        return false;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        const raw = element.dataset?.raw;
        if (raw) {
          const nextCursor = cursor + raw.length;
          if (inputState.caret <= nextCursor) {
            if (inputState.caret <= cursor) {
              range.setStartBefore(element);
            } else {
              range.setStartAfter(element);
            }
            range.collapse(true);
            positioned = true;
            return true;
          }
          cursor = nextCursor;
          return false;
        }
        for (const child of Array.from(element.childNodes)) {
          if (placeCaret(child)) {
            return true;
          }
        }
      }
      return false;
    };
    placeCaret(container);
    if (!positioned) {
      range.selectNodeContents(container);
      range.collapse(false);
    }
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    lastAppliedCaretRef.current = inputState.caret;
  }, [inputState.caret, inputState.isComposing, inputState.rawText]);

  const updateInput = useCallback(
    (next: string, caret?: number) => {
      const nextCaret = typeof caret === "number" ? caret : next.length;
      dispatchInput({ type: "TYPE", rawText: next, caret: nextCaret });
      const nextSlashState = computeSlashTokenState(
        next,
        nextCaret,
        inputState.isComposing,
      );
      dispatchInput({
        type: "SLASH_DETECTED",
        active: nextSlashState.mode === "slash",
      });
      if (nextSlashState.mode === "slash") {
        if (nextSlashState.token.startsWith("/p:") && inputState.mode !== "prompt_sub") {
          dispatchInput({ type: "SELECT_SLASH", kind: "prompt" });
        }
      }
    },
    [dispatchInput, inputState.isComposing, inputState.mode],
  );

  const setComposing = useCallback(
    (value: boolean) => {
      dispatchInput({
        type: "TYPE",
        rawText: inputState.rawText,
        caret: inputState.caret,
        isComposing: value,
      });
    },
    [dispatchInput, inputState.caret, inputState.rawText],
  );

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
      const query = proposalId
        ? `?proposal_id=${encodeURIComponent(proposalId)}`
        : "";
      navigate(`/documents/${encodeURIComponent(trimmed)}${query}`);
    },
    [navigate],
  );

  useEffect(() => {
    return () => {
      closeStream();
    };
  }, [closeStream]);

  useEffect(() => {
    if (!historyOpen) {
      return;
    }
    const container = messagesRef.current;
    if (!container) {
      return;
    }
    const handle = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => cancelAnimationFrame(handle);
  }, [assistantActive, assistantBuffer, historyHeight, historyOpen, messages]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }
    const handleMove = (event: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) {
        return;
      }
      const delta = start.y - event.clientY;
      const nextHeight = clampHistoryHeight(start.height + delta);
      setHistoryHeight(nextHeight);
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

  useEffect(() => {
    if (!docSearchState.active || inputState.isComposing) {
      return;
    }
    if (!projectKey) {
      setDocOptions([]);
      return;
    }
    let active = true;
    const handle = setTimeout(async () => {
      try {
        const commandInput = docSearchState.query
          ? `/op:docs.search ${docSearchState.query}`
          : "/op:docs.list";
        const result = await executeCommand(projectKey, commandInput);
        const docs = extractDocsFromArtifacts(result.artifacts);
        if (active) {
          setDocOptions(docs);
        }
      } catch {
        if (active) {
          setDocOptions([]);
        }
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [
    docSearchState.active,
    docSearchState.query,
    inputState.isComposing,
    projectKey,
  ]);

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
    dispatchInput({ type: "RESET" });
    setError(null);
    appendMessage("user", message);
    setHistoryOpen(true);
    setIsGenerating(true);
    resetAssistantBuffer();
    closeStream();

    try {
      if (message.startsWith("/op:")) {
        const result = await executeCommand(projectKey, message);
        const reply = result.message || "Command completed.";
        appendMessage("assistant", reply, result.artifacts);
        setIsGenerating(false);
        return;
      }
      const outboundMessage = buildPromptMessage(message, inputState.activePrompt);
      const runId = await createChatRun(projectKey, outboundMessage);
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
    dispatchInput,
    executeCommand,
    handleDelta,
    input,
    inputState.activePrompt,
    projectKey,
    resetAssistantBuffer,
  ]);

  const focusInputEnd = useCallback(() => {
    const target = inputRef.current;
    if (!target) {
      return;
    }
    target.focus();
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const handleDocSelect = useCallback(
    (docId: string, title: string) => {
      const token = `{{doc:${docId}|title:${sanitizeDocTitle(title)}}}`;
      const prefix =
        docSearchState.start > -1 ? input.slice(0, docSearchState.start) : "";
      const suffix =
        docSearchState.end > -1 ? input.slice(docSearchState.end) : "";
      const next = `${prefix}${token} ${suffix}`.trim();
      updateInput(next, next.length);
      dispatchInput({ type: "PICK_ITEM" });
      setDocOptions([]);
      requestAnimationFrame(() => {
        focusInputEnd();
      });
    },
    [
      dispatchInput,
      docSearchState.end,
      docSearchState.start,
      focusInputEnd,
      input,
      updateInput,
    ],
  );

  const handlePromptSelect = useCallback(
    (promptId: string) => {
      const template = findPromptTemplate(promptId);
      if (!template) {
        return;
      }
      const before =
        promptSlashState.start > -1 ? input.slice(0, promptSlashState.start) : "";
      const after =
        promptSlashState.end > -1 ? input.slice(promptSlashState.end) : "";
      const next = `${before}${after}`.trim();
      updateInput(next, next.length);
      dispatchInput({ type: "SELECT_PROMPT", prompt: template });
    },
    [dispatchInput, input, promptSlashState.end, promptSlashState.start, updateInput],
  );

  const handleDocSearchCancel = useCallback(() => {
    const start =
      docSearchState.active && docSearchState.start > -1
        ? docSearchState.start
        : slashTokenState.start;
    const end =
      docSearchState.active && docSearchState.end > -1
        ? docSearchState.end
        : slashTokenState.end;
    const before = start > -1 ? input.slice(0, start) : "";
    const after = end > -1 ? input.slice(end) : "";
    updateInput(`${before}${after}`.trim());
    dispatchInput({ type: "ESCAPE" });
    setDocOptions([]);
  }, [
    dispatchInput,
    docSearchState.active,
    docSearchState.end,
    docSearchState.start,
    input,
    slashTokenState.end,
    slashTokenState.start,
    updateInput,
  ]);

  const handleTokenDeletion = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Backspace" && event.key !== "Delete") {
        return false;
      }
      if (inputState.isComposing || event.nativeEvent.isComposing) {
        return false;
      }
      const target = event.currentTarget;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return false;
      }
      const range = selection.getRangeAt(0);
      if (!target.contains(range.startContainer) || !target.contains(range.endContainer)) {
        return false;
      }
      const startRange = document.createRange();
      startRange.selectNodeContents(target);
      startRange.setEnd(range.startContainer, range.startOffset);
      const endRange = document.createRange();
      endRange.selectNodeContents(target);
      endRange.setEnd(range.endContainer, range.endOffset);
      const rangeStart = serializeNodeToRaw(startRange.cloneContents()).length;
      const rangeEnd = serializeNodeToRaw(endRange.cloneContents()).length;
      if (rangeStart === rangeEnd) {
        if (event.key === "Backspace" && rangeStart > 0) {
          const nextStart = rangeStart - 1;
          const result = removeDocTokensInRange(input, nextStart, rangeStart);
          if (!result.removed) {
            return false;
          }
          event.preventDefault();
          updateInput(result.next, result.caret);
          return true;
        }
        if (event.key === "Delete") {
          const result = removeDocTokensInRange(input, rangeStart, rangeStart + 1);
          if (!result.removed) {
            return false;
          }
          event.preventDefault();
          updateInput(result.next, result.caret);
          return true;
        }
      }
      const result = removeDocTokensInRange(input, rangeStart, rangeEnd);
      if (!result.removed) {
        return false;
      }
      event.preventDefault();
      updateInput(result.next, result.caret);
      return true;
    },
    [input, inputState.isComposing, updateInput],
  );

  const handleProposalAction = useCallback(
    async (action: string, docId: string, proposalId: string) => {
      if (!projectKey || !docId) {
        return;
      }
      if (action === "open") {
        handleDocumentNavigate(docId, proposalId);
        return;
      }
      if (!proposalId) {
        return;
      }
      try {
        if (action === "apply") {
          await applyProposal(projectKey, docId, proposalId);
          appendMessage("system", "Applied proposal.");
        } else {
          await rejectProposal(projectKey, docId, proposalId);
          appendMessage("system", "Rejected proposal.");
        }
      } catch (err) {
        const messageText = err instanceof Error ? err.message : "proposal action failed";
        appendMessage("system", `Error: ${messageText}`);
      }
    },
    [appendMessage, handleDocumentNavigate, projectKey],
  );

  const applySlashSelection = useCallback(
    (value: string) => {
      const before =
        slashTokenState.start > -1 ? input.slice(0, slashTokenState.start) : "";
      const after =
        slashTokenState.end > -1 ? input.slice(slashTokenState.end) : "";
      const keepToken = false;
      const next = value.endsWith(":") || keepToken
        ? value
        : value.endsWith(" ")
          ? value
          : `${value} `;
      const updated = `${before}${next}${after}`;
      updateInput(updated, updated.length);
      if (value.startsWith("/p:")) {
        dispatchInput({ type: "SELECT_SLASH", kind: "prompt" });
        return;
      }
      if (value.startsWith("/in:")) {
        return;
      }
      dispatchInput({ type: "SELECT_SLASH", kind: "plain" });
    },
    [dispatchInput, input, slashTokenState.end, slashTokenState.start, updateInput],
  );

  const handleOptionSelect = useCallback(
    (value: string) => {
      if (promptSlashState.active) {
        handlePromptSelect(value);
        return;
      }
      if (docSearchState.active) {
        if (value === "__cancel__") {
          handleDocSearchCancel();
          return;
        }
        const selected = docOptions.find((doc) => doc.id === value);
        const title = selected?.title ?? value;
        handleDocSelect(value, title);
        return;
      }
      applySlashSelection(value);
    },
    [
      applySlashSelection,
      docOptions,
      docSearchState.active,
      handleDocSearchCancel,
      handleDocSelect,
      handlePromptSelect,
      promptSlashState.active,
    ],
  );

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
                  {artifact.title || "Change Proposals"}
                </div>
                <div className="chat-dock-artifact-list">
                  {items.map((item, itemIndex) => (
                    <div key={`${item.doc_id || itemIndex}`} className="chat-dock-artifact-row">
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
                        {String(item.title ?? item.doc_id ?? "Document")}
                      </button>
                      <div className="chat-dock-artifact-actions">
                        {actions.map((action, actionIndex) => (
                          <button
                            key={`${action.type || actionIndex}`}
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
                            {action.label ?? action.type ?? "Action"}
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

  const insertNewline = useCallback(
    (target: HTMLDivElement) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      if (!target.contains(range.startContainer)) {
        return;
      }
      range.deleteContents();
      const br = document.createElement("br");
      range.insertNode(br);
      range.setStartAfter(br);
      range.setEndAfter(br);
      selection.removeAllRanges();
      selection.addRange(range);
      requestAnimationFrame(() => {
        const rawText = serializeNodeToRaw(target);
        const caretRange = document.createRange();
        caretRange.selectNodeContents(target);
        caretRange.setEnd(range.endContainer, range.endOffset);
        const caret = serializeNodeToRaw(caretRange.cloneContents()).length;
        updateInput(rawText, caret);
      });
    },
    [updateInput],
  );

  const ActiveSlashPanel = promptSlashState.active ? PromptSlashPanel : SlashCommandPanel;

  return (
    <section className="chat-dock">
      {showPanel ? (
        <div className="chat-dock-panel" style={{ height: `${historyHeight}px` }}>
          <div
            className="chat-dock-resize-handle"
            onMouseDown={(event) => {
              event.preventDefault();
              resizeStartRef.current = { y: event.clientY, height: historyHeight };
              setIsResizing(true);
            }}
          />
          <div className="chat-dock-header">
            <span>Chat</span>
            {isGenerating ? (
              <span className="chat-dock-status">Generating...</span>
            ) : null}
          </div>
          <div className="chat-dock-messages" ref={messagesRef}>
            {messages.length === 0 ? (
              <div className="chat-dock-empty">Start a conversation</div>
            ) : (
              <>
                {messages.map((message) => (
                  <div key={message.id} className={`chat-dock-message ${message.role}`}>
                    <div className="chat-dock-message-header">
                      <span className="chat-dock-role">{message.role}</span>
                      <span className="chat-dock-text">
                        {renderZeusText(parseZeusText(message.content))}
                      </span>
                    </div>
                    {renderArtifacts(message.artifacts)}
                  </div>
                ))}
                {assistantActive ? (
                  <div className="chat-dock-message assistant">
                    <div className="chat-dock-message-header">
                      <span className="chat-dock-role">assistant</span>
                      <span className="chat-dock-text">
                        {renderZeusText(parseZeusText(assistantBuffer))}
                      </span>
                    </div>
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
          <div className="chat-dock-input-body">
            {inputState.activePrompt ? (
              <div className="chat-dock-prompt-chip">
                <span className="chat-dock-prompt-label">
                  {inputState.activePrompt.title}
                </span>
                <button
                  type="button"
                  className="chat-dock-prompt-remove"
                  onClick={() => dispatchInput({ type: "REMOVE_PROMPT" })}
                >
                  ×
                </button>
              </div>
            ) : null}
            <div className="chat-dock-input-row">
              <ActiveSlashPanel
                value={input}
                options={visibleOptions}
                open={pickerOpen}
                placeholder={projectKey ? "Type a message" : "Select a project to chat"}
                inputRef={inputRef as any}
                renderHtml={inputHtml}
                onChange={(value, caret) => updateInput(value, caret)}
                onSelect={(value) => handleOptionSelect(String(value))}
                onDropdownVisibleChange={(open) => {
                  if (!open) {
                    if (!slashTokenState.token.startsWith("/in:")) {
                      dispatchInput({ type: "ESCAPE" });
                    }
                  }
                }}
                filterOption={false}
                notFoundContent={
                  promptSlashState.active
                    ? "No matching prompts"
                    : docSearchState.active
                      ? "No matching documents"
                      : null
                }
                onKeyDown={(event) => {
                  if (
                    pickerOpen &&
                    visibleOptions.length > 0 &&
                    (event.key === "ArrowDown" || event.key === "ArrowUp")
                  ) {
                    event.preventDefault();
                    const keys = visibleOptions.map((option) =>
                      String(option.value ?? option.label ?? ""),
                    );
                    if (keys.length === 0) {
                      return;
                    }
                    const currentIndex = activeDropdownKey
                      ? keys.indexOf(activeDropdownKey)
                      : -1;
                    const direction = event.key === "ArrowDown" ? 1 : -1;
                    const nextIndex =
                      currentIndex === -1
                        ? 0
                        : (currentIndex + direction + keys.length) % keys.length;
                    setActiveDropdownKey(keys[nextIndex]);
                    return;
                  }
                  if (handleTokenDeletion(event)) {
                    return;
                  }
                  if (event.key !== "Enter") {
                    return;
                  }
                  if (inputState.isComposing || event.nativeEvent.isComposing) {
                    return;
                  }
                  if (
                    pickerOpen &&
                    visibleOptions.length > 0 &&
                    activeDropdownKey &&
                    !input.trim().startsWith("/op:")
                  ) {
                    event.preventDefault();
                    handleOptionSelect(activeDropdownKey);
                    return;
                  }
                  if (
                    pickerOpen &&
                    visibleOptions.length > 0 &&
                    (docSearchState.active || inputState.mode === "slash") &&
                    !event.shiftKey &&
                    !event.altKey &&
                    !event.ctrlKey &&
                    !event.metaKey
                  ) {
                    if (!input.trim().startsWith("/op:")) {
                      event.preventDefault();
                      return;
                    }
                  }
                  if (
                    docSearchState.active &&
                    !event.shiftKey &&
                    !event.altKey &&
                    !event.ctrlKey &&
                    !event.metaKey
                  ) {
                    event.preventDefault();
                    return;
                  }
                  if (event.altKey || event.getModifierState("Alt")) {
                    event.preventDefault();
                    event.stopPropagation();
                    insertNewline(event.currentTarget);
                    return;
                  }
                  const allowNewline =
                    event.shiftKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.getModifierState("AltGraph");
                  if (allowNewline) {
                    return;
                  }
                  event.preventDefault();
                  handleSend();
                }}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                disabled={!projectKey || isGenerating}
                activeKey={activeDropdownKey}
              />
              <div className="chat-dock-actions">
                <button type="button" onClick={handleSend} disabled={!canSend}>
                  Send
                </button>
                <button
                  type="button"
                  className="chat-dock-toggle"
                  onClick={() => setHistoryOpen((prev) => !prev)}
                >
                  {historyOpen ? <DownOutlined /> : <UpOutlined />}
                </button>
              </div>
            </div>
          </div>
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

const minHistoryHeight = 160;
const maxHistoryHeight = 480;

const clampHistoryHeight = (value: number) => {
  return Math.min(maxHistoryHeight, Math.max(minHistoryHeight, value));
};

const docTokenRegex = /\{\{doc:([^}|]+)(?:\|title:([^}]+))?\}\}/g;

const sanitizeDocTitle = (value: string) => {
  return value.replace(/\|/g, " ").replace(/\}\}/g, "").replace(/\s+/g, " ").trim();
};

type DocTokenMatch = {
  id: string;
  title: string;
  start: number;
  end: number;
  raw: string;
};

const extractDocTokenMatches = (input: string): DocTokenMatch[] => {
  const tokens: DocTokenMatch[] = [];
  docTokenRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = docTokenRegex.exec(input)) !== null) {
    const id = match[1]?.trim() ?? "";
    if (!id) {
      continue;
    }
    const title = match[2]?.trim() ?? "";
    tokens.push({
      id,
      title: title || id,
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
    });
  }
  return tokens;
};

const escapeHtml = (value: string) => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const formatHtmlText = (value: string) => {
  if (!value) {
    return "";
  }
  return escapeHtml(value).replace(/\n/g, "<br/>");
};

const buildInputHtml = (
  input: string,
  tokens: DocTokenMatch[],
  slashStart: number,
  slashEnd: number,
): string => {
  if (!input && tokens.length === 0) {
    return "";
  }
  let html = "";
  let cursor = 0;
  const highlightSlash = slashStart >= 0 && slashEnd > slashStart;

  const pushText = (value: string, start: number, end: number) => {
    if (!value) {
      return;
    }
    if (!highlightSlash || slashEnd <= start || slashStart >= end) {
      html += formatHtmlText(value);
      return;
    }
    const localStart = Math.max(slashStart, start);
    const localEnd = Math.min(slashEnd, end);
    const before = value.slice(0, localStart - start);
    const mid = value.slice(localStart - start, localEnd - start);
    const after = value.slice(localEnd - start);
    html += formatHtmlText(before);
    if (mid) {
      html += `<span class="chat-dock-input-highlight-token">${formatHtmlText(mid)}</span>`;
    }
    html += formatHtmlText(after);
  };

  tokens.forEach((token) => {
    if (token.start > cursor) {
      pushText(input.slice(cursor, token.start), cursor, token.start);
    }
    html += `<span class="chat-dock-doc-token" data-raw="${escapeHtml(
      token.raw,
    )}" contenteditable="false">${escapeHtml(token.title)}</span>`;
    cursor = token.end;
  });

  if (cursor < input.length) {
    pushText(input.slice(cursor), cursor, input.length);
  }

  return html;
};

const serializeNodeToRaw = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    return Array.from(node.childNodes).map(serializeNodeToRaw).join("");
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement;
    if (element.tagName === "BR") {
      return "\n";
    }
    const raw = element.dataset?.raw;
    if (raw) {
      return raw;
    }
    return Array.from(element.childNodes).map(serializeNodeToRaw).join("");
  }
  return "";
};

const removeDocTokensInRange = (
  input: string,
  rangeStart: number,
  rangeEnd: number,
): { next: string; caret: number; removed: boolean } => {
  if (rangeEnd < rangeStart) {
    return { next: input, caret: rangeStart, removed: false };
  }
  const matches = extractDocTokenMatches(input);
  if (matches.length === 0) {
    return { next: input, caret: rangeStart, removed: false };
  }
  let removed = false;
  let caret = rangeStart;
  let cursor = 0;
  let output = "";
  for (const token of matches) {
    if (token.start > cursor) {
      output += input.slice(cursor, token.start);
    }
    const intersects = token.start < rangeEnd && token.end > rangeStart;
    if (intersects) {
      removed = true;
      caret = Math.min(caret, token.start);
    } else {
      output += input.slice(token.start, token.end);
    }
    cursor = token.end;
  }
  if (cursor < input.length) {
    output += input.slice(cursor);
  }
  if (!removed) {
    return { next: input, caret: rangeStart, removed: false };
  }
  return { next: output.replace(/\s{2,}/g, " ").trim(), caret, removed: true };
};

export default ChatDock;
