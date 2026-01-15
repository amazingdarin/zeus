import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import { createChatRun, buildChatStreamUrl } from "../api/chat";
import { executeCommand } from "../api/commands";
import { useProjectContext } from "../context/ProjectContext";
import { filterPromptTemplates, findPromptTemplate } from "../lib/promptRegistry";
import SlashCommandPanel from "./SlashCommandPanel";
import PromptSlashPanel from "./PromptSlashPanel";
import { parseZeusText, renderZeusText } from "../lib/zeusText";
import { apiFetch } from "../config/api";

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
};

type InputAction =
  | { type: "TYPE"; rawText: string; caret: number; isComposing?: boolean }
  | { type: "ENTER" }
  | { type: "ESCAPE" }
  | { type: "RESET" }
  | { type: "SLASH_DETECTED"; active: boolean }
  | { type: "SELECT_SLASH"; kind: "op" | "prompt" | "plain" }
  | { type: "OPEN_PICKER" }
  | { type: "PICK_ITEM" };

const initialInputState: InputState = {
  rawText: "",
  caret: 0,
  mode: "normal",
  isComposing: false,
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
    case "OPEN_PICKER":
      return { ...state, mode: "picker" };
    case "PICK_ITEM":
      return { ...state, mode: "normal" };
    case "ENTER":
      return state.mode === "slash" ? { ...state, mode: "normal" } : state;
    case "ESCAPE":
      return { ...state, mode: "normal" };
    case "RESET":
      return initialInputState;
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
  if (!isComposing && /\s/.test(token)) {
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
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasCustomEventsRef = useRef(false);
  const prevInputModeRef = useRef<InputMode>("normal");
  const assistantBufferRef = useRef("");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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

  const highlightedInput = useMemo(() => {
    if (inputState.mode === "normal" || slashTokenState.mode !== "slash") {
      return input;
    }
    if (slashTokenState.start < 0 || slashTokenState.end < 0) {
      return input;
    }
    const before = input.slice(0, slashTokenState.start);
    const token = input.slice(slashTokenState.start, slashTokenState.end);
    const after = input.slice(slashTokenState.end);
    return (
      <>
        {before}
        <span className="chat-dock-input-highlight-token">{token}</span>
        {after}
      </>
    );
  }, [input, inputState.mode, slashTokenState.end, slashTokenState.mode, slashTokenState.start]);

  const docSearchState = useMemo(() => {
    if (inputState.mode !== "slash" && inputState.mode !== "op_sub") {
      return { active: false, query: "", start: -1, end: -1 };
    }
    if (!slashTokenState.token.startsWith("/docs.search:")) {
      return { active: false, query: "", start: -1, end: -1 };
    }
    const prefix = "/docs.search:";
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

  const docsListState = useMemo(() => {
    if (inputState.mode !== "slash" && inputState.mode !== "op_sub") {
      return { active: false };
    }
    if (slashTokenState.token !== "/docs") {
      return { active: false };
    }
    return { active: true };
  }, [inputState.mode, slashTokenState.token]);

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
    if (slashTokenState.token.startsWith("/docs.search:")) {
      return [];
    }
    if (slashTokenState.token.startsWith("/p:")) {
      return [];
    }
    return [
      { value: "/docs", label: "docs — list documents" },
      { value: "/docs.search:", label: "docs.search: — find a document by name" },
      { value: "/p:", label: "p: — insert a prompt template" },
      { value: "/propose", label: "propose — create a change proposal (doc_id required)" },
    ];
  }, [inputState.mode, slashTokenState.token]);

  const dropdownOptions = useMemo(() => {
    if (promptSlashState.active) {
      return promptOptions;
    }
    if (docSearchState.active || docsListState.active) {
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
    docsListState.active,
    promptOptions,
    promptSlashState.active,
    slashOptions,
  ]);

  const pickerOpen = useMemo(() => {
    if (inputState.mode === "normal") {
      return false;
    }
    if (promptSlashState.active || docSearchState.active || docsListState.active) {
      return true;
    }
    return inputState.mode === "slash" && slashOptions.length > 0;
  }, [
    docSearchState.active,
    docsListState.active,
    inputState.mode,
    promptSlashState.active,
    slashOptions.length,
  ]);

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
        if (
          (nextSlashState.token === "/docs" ||
            nextSlashState.token.startsWith("/docs.search:")) &&
          inputState.mode !== "op_sub"
        ) {
          dispatchInput({ type: "SELECT_SLASH", kind: "op" });
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
    if ((!docSearchState.active && !docsListState.active) || inputState.isComposing) {
      return;
    }
    if (!projectKey) {
      setDocOptions([]);
      return;
    }
    if (docSearchState.active && !docSearchState.query) {
      setDocOptions([]);
      return;
    }
    let active = true;
    const handle = setTimeout(async () => {
      try {
        const commandInput = docSearchState.active
          ? `/docs.search:${docSearchState.query}`
          : "/docs";
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
    docsListState.active,
    inputState.isComposing,
    projectKey,
  ]);

  const docRefs = useMemo(() => extractDocTokens(input), [input]);

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
      if (message.startsWith("/docs")) {
        const result = await executeCommand(projectKey, message);
        const reply = result.message || "Command completed.";
        appendMessage("assistant", reply, result.artifacts);
        setIsGenerating(false);
        return;
      }
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
    dispatchInput,
    executeCommand,
    handleDelta,
    input,
    projectKey,
    resetAssistantBuffer,
  ]);

  const handleDocSelect = useCallback(
    (docId: string, title: string) => {
      const token = `{{doc:${docId}}}`;
      const prefix =
        docSearchState.start > -1 ? input.slice(0, docSearchState.start) : "";
      const suffix =
        docSearchState.end > -1 ? input.slice(docSearchState.end) : "";
      const next = `${prefix}${token} ${suffix}`.trim();
      updateInput(next, next.length);
      dispatchInput({ type: "PICK_ITEM" });
      setDocOptions([]);
      requestAnimationFrame(() => {
        const target = inputRef.current;
        if (target) {
          target.selectionStart = target.value.length;
          target.selectionEnd = target.value.length;
        }
      });
    },
    [dispatchInput, docSearchState.end, docSearchState.start, input, updateInput],
  );

  const handlePromptSelect = useCallback(
    (promptId: string) => {
      const template = findPromptTemplate(promptId)?.template ?? promptId;
      const before =
        promptSlashState.start > -1 ? input.slice(0, promptSlashState.start) : "";
      const after =
        promptSlashState.end > -1 ? input.slice(promptSlashState.end) : "";
      const next = `${before}${template}${after}`.trim();
      updateInput(next, next.length);
      dispatchInput({ type: "PICK_ITEM" });
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
      const endpoint =
        action === "apply"
          ? `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(
              docId,
            )}/proposals/${encodeURIComponent(proposalId)}/apply`
          : `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(
              docId,
            )}/proposals/${encodeURIComponent(proposalId)}/reject`;
      try {
        const response = await apiFetch(endpoint, { method: "POST" });
        if (!response.ok) {
          throw new Error("proposal action failed");
        }
        const text = action === "apply" ? "Applied proposal." : "Rejected proposal.";
        appendMessage("system", text);
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
      const keepToken = value === "/docs";
      const next = value.endsWith(":") || keepToken
        ? value
        : value.endsWith(" ")
          ? value
          : `${value} `;
      const updated = `${before}${next}${after}`;
      updateInput(updated, updated.length);
      const kind =
        value === "/propose"
          ? "prompt"
          : value === "/docs.search:" || value === "/docs"
            ? "op"
            : "plain";
      dispatchInput({ type: "SELECT_SLASH", kind });
    },
    [dispatchInput, input, slashTokenState.end, slashTokenState.start, updateInput],
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
    (target: HTMLTextAreaElement) => {
      const start = target.selectionStart ?? input.length;
      const end = target.selectionEnd ?? input.length;
      const next = `${input.slice(0, start)}\n${input.slice(end)}`;
      updateInput(next, start + 1);
      requestAnimationFrame(() => {
        target.selectionStart = start + 1;
        target.selectionEnd = start + 1;
      });
    },
    [input, updateInput],
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
            {docRefs.length > 0 ? (
              <div className="chat-dock-doc-chips">
                {docRefs.map((doc) => (
                  <span key={doc.id} className="chat-dock-doc-chip">
                    {doc.title}
                    <button
                      type="button"
                      className="chat-dock-doc-remove"
                      onClick={() => {
                        const token = `{{doc:${doc.id}}}`;
                        const next = input
                          .replace(token, "")
                          .replace(/\s{2,}/g, " ")
                          .trim();
                        updateInput(next);
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <ActiveSlashPanel
              value={input}
              options={dropdownOptions}
              open={pickerOpen}
              placeholder={projectKey ? "Type a message" : "Select a project to chat"}
              inputRef={inputRef}
              highlightActive={inputState.mode !== "normal" && slashTokenState.mode === "slash"}
              highlightContent={highlightedInput}
              onChange={(value, caret) => updateInput(value, caret)}
              onSelect={(value) => {
                if (promptSlashState.active) {
                  handlePromptSelect(String(value));
                  return;
                }
                if (docSearchState.active || docsListState.active) {
                  if (value === "__cancel__") {
                    handleDocSearchCancel();
                    return;
                  }
                  const selected = docOptions.find((doc) => doc.id === value);
                  const title = selected?.title ?? String(value);
                  handleDocSelect(String(value), title);
                  return;
                }
                applySlashSelection(String(value));
              }}
              onDropdownVisibleChange={(open) => {
                if (!open) {
                  dispatchInput({ type: "ESCAPE" });
                }
              }}
              filterOption={
                docSearchState.active || docsListState.active || promptSlashState.active
                  ? false
                  : (_, option) => {
                      const query = slashTokenState.token || input;
                      return String(option?.value ?? "")
                        .toLowerCase()
                        .startsWith(query.toLowerCase());
                    }
              }
              notFoundContent={
                promptSlashState.active
                  ? "No matching prompts"
                  : (docSearchState.active && docSearchState.query) || docsListState.active
                    ? "No matching documents"
                    : null
              }
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }
                if (inputState.isComposing || event.nativeEvent.isComposing) {
                  return;
                }
                if (
                  pickerOpen &&
                  dropdownOptions.length > 0 &&
                  (docSearchState.active || inputState.mode === "slash") &&
                  !event.shiftKey &&
                  !event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey
                ) {
                  event.preventDefault();
                  return;
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
            />
          </div>
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

const docTokenRegex = /\{\{doc:([^}]+)\}\}/g;

const extractDocTokens = (input: string) => {
  const refs: Array<{ id: string; title: string }> = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = docTokenRegex.exec(input)) !== null) {
    const id = match[1]?.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    refs.push({ id, title: id });
  }
  return refs;
};

export default ChatDock;
