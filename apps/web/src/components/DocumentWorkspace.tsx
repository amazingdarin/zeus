import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";

import RichTextEditor from "./RichTextEditor";
import {
  isDocumentLockedError,
  updateDocumentContent,
} from "../api/documents";
import {
  createSaveScheduler,
  type SaveScheduler,
} from "../features/document-editor/save-scheduler";
import {
  initialSaveState,
  reduceSaveState,
  type EditorSaveState,
  type EditorSaveEvent,
} from "../features/document-editor/save-state";
import {
  isMeaningfulDraftChange,
  mapSaveStatusText,
  shouldPersistWorkspacePayload,
  shouldApplyIncomingWorkspaceState,
  shouldFlushOn,
} from "../features/document-editor/workspace-model";
import { reduceLockFallbackState } from "../features/document-editor/lock-fallback";
import { useScrollToBlock } from "@zeus/doc-editor";
import {
  toSelectionRange,
  type WorkspaceBridge,
  type WorkspaceSnapshot,
} from "../features/document-tabs/workspace-bridge";

const EMPTY_DOC: JSONContent = {
  type: "doc",
  content: [],
};

type FlushReason = "route-leave" | "project-switch" | "window-blur" | "manual-retry" | "input";

type SavePayload = {
  title: string;
  content: JSONContent;
};

type PersistMode = "persisted" | "ephemeral";

type DocumentWorkspaceProps = {
  projectKey: string;
  documentId: string;
  title: string;
  content: JSONContent | null;
  blockId?: string | null;
  showTitle?: boolean;
  locked?: boolean;
  persistMode?: PersistMode;
  onSaved?: (payload: SavePayload) => void;
  onFirstMeaningfulChange?: (payload: SavePayload) => Promise<void> | void;
  onLockFallback?: () => void;
  onSaveStateChange?: (state: EditorSaveState) => void;
  onRetryBind?: (handler: (() => void) | null) => void;
  onFocusBind?: (handler: (() => void) | null) => void;
  onBridgeBind?: (bridge: WorkspaceBridge | null) => void;
  onTitleChange?: (nextTitle: string) => void;
};

function reduceWith(state: EditorSaveState, event: EditorSaveEvent): EditorSaveState {
  return reduceSaveState(state, event);
}

function findEditorScrollContainer(root: HTMLElement | null): HTMLElement | null {
  if (!root) {
    return null;
  }
  return root.querySelector(".doc-editor-content") as HTMLElement | null;
}

function mapSnapshotStatusToSaveState(status: WorkspaceSnapshot["saveStatus"]): EditorSaveState {
  if (status === "draft") {
    return { status: "draft", error: "" };
  }
  if (status === "dirty") {
    return { status: "dirty", error: "" };
  }
  if (status === "saving") {
    return { status: "saving", error: "" };
  }
  if (status === "error") {
    return { status: "error", error: "save failed" };
  }
  return initialSaveState();
}

export default function DocumentWorkspace({
  projectKey,
  documentId,
  title,
  content,
  blockId = null,
  showTitle = true,
  locked = false,
  persistMode = "persisted",
  onSaved,
  onFirstMeaningfulChange,
  onLockFallback,
  onSaveStateChange,
  onRetryBind,
  onFocusBind,
  onBridgeBind,
  onTitleChange,
}: DocumentWorkspaceProps) {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [titleValue, setTitleValue] = useState(title);
  const [editorContent, setEditorContent] = useState<JSONContent>(content ?? EMPTY_DOC);
  const [readonlyFallback, setReadonlyFallback] = useState(false);
  const [saveState, setSaveState] = useState<EditorSaveState>(() =>
    persistMode === "ephemeral"
      ? { status: "draft", error: "" }
      : initialSaveState(),
  );

  const schedulerRef = useRef<SaveScheduler<SavePayload> | null>(null);
  const latestContentRef = useRef<JSONContent>(content ?? EMPTY_DOC);
  const latestTitleRef = useRef<string>(title);
  const latestSerializedRef = useRef<string>(JSON.stringify(content ?? EMPTY_DOC));
  const lastSavedSerializedRef = useRef<string>(JSON.stringify(content ?? EMPTY_DOC));
  const lastSavedTitleRef = useRef<string>(title);
  const onSaveStateChangeRef = useRef(onSaveStateChange);
  const onRetryBindRef = useRef(onRetryBind);
  const onFocusBindRef = useRef(onFocusBind);
  const onBridgeBindRef = useRef(onBridgeBind);
  const captureSnapshotRef = useRef<() => WorkspaceSnapshot>(() => ({
    scrollTop: 0,
    selection: null,
    draftTitle: "",
    draftContent: EMPTY_DOC,
    saveStatus: "idle",
  }));
  const restoreSnapshotRef = useRef<(snapshot: WorkspaceSnapshot) => void>(() => undefined);
  const flushForBridgeRef = useRef<() => Promise<void>>(async () => undefined);
  const bridgeRef = useRef<WorkspaceBridge | null>(null);
  const workspaceIdentityRef = useRef(`${projectKey}:${documentId}`);
  const hasMaterializedRef = useRef(persistMode === "persisted");
  const materializingRef = useRef(false);
  const lockedRef = useRef(locked);
  const readonly = locked || readonlyFallback;

  useScrollToBlock(blockId, editorReady);

  useEffect(() => {
    onSaveStateChangeRef.current = onSaveStateChange;
  }, [onSaveStateChange]);

  useEffect(() => {
    onRetryBindRef.current = onRetryBind;
  }, [onRetryBind]);

  useEffect(() => {
    onFocusBindRef.current = onFocusBind;
  }, [onFocusBind]);

  useEffect(() => {
    onBridgeBindRef.current = onBridgeBind;
  }, [onBridgeBind]);

  useEffect(() => {
    if (persistMode === "persisted") {
      hasMaterializedRef.current = true;
      setSaveState((prev) => (prev.status === "draft" ? initialSaveState() : prev));
      return;
    }
    hasMaterializedRef.current = false;
    setSaveState((prev) => {
      if (prev.status === "saving" || prev.status === "error") {
        return prev;
      }
      if (prev.status === "draft") {
        return prev;
      }
      return { status: "draft", error: "" };
    });
  }, [persistMode]);

  useEffect(() => {
    if (!locked && lockedRef.current) {
      setReadonlyFallback(false);
    }
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => {
    if (!readonly) {
      return;
    }
    schedulerRef.current?.cancel();
  }, [readonly]);

  const dispatchSaveEvent = useCallback((event: EditorSaveEvent) => {
    setSaveState((prev) => reduceWith(prev, event));
  }, []);

  const flushPending = useCallback(
    async (reason: FlushReason, options?: { throwOnError?: boolean }) => {
      if (!shouldFlushOn(reason)) {
        return;
      }
      if (readonly) {
        return;
      }
      if (!shouldPersistWorkspacePayload({
        persistMode,
        hasMaterialized: hasMaterializedRef.current,
      })) {
        return;
      }
      const scheduler = schedulerRef.current;
      if (!scheduler) {
        return;
      }
      try {
        await scheduler.flush();
      } catch (error) {
        if (options?.throwOnError) {
          throw error;
        }
        // save-state handled via scheduler error callback
      }
    },
    [persistMode, readonly],
  );

  const flushForBridge = useCallback(async () => {
    await flushPending("route-leave", { throwOnError: true });
  }, [flushPending]);

  const captureSnapshot = useCallback((): WorkspaceSnapshot => {
    const selection = editor ? toSelectionRange(editor.state.selection) : null;
    const scrollContainer = findEditorScrollContainer(workspaceRef.current);
    return {
      scrollTop: scrollContainer?.scrollTop ?? 0,
      selection,
      draftTitle: latestTitleRef.current,
      draftContent: latestContentRef.current,
      locked: readonly,
      saveStatus: saveState.status,
    };
  }, [editor, readonly, saveState.status]);

  const restoreSnapshot = useCallback(
    (snapshot: WorkspaceSnapshot) => {
      const nextTitle = snapshot.draftTitle;
      const nextContent = snapshot.draftContent;
      const serialized = JSON.stringify(nextContent);

      setTitleValue(nextTitle);
      setEditorContent(nextContent);
      latestTitleRef.current = nextTitle;
      latestContentRef.current = nextContent;
      latestSerializedRef.current = serialized;
      if (snapshot.locked) {
        setReadonlyFallback(true);
      } else if (!locked) {
        setReadonlyFallback(false);
      }
      setSaveState(mapSnapshotStatusToSaveState(snapshot.saveStatus));

      window.requestAnimationFrame(() => {
        const scrollContainer = findEditorScrollContainer(workspaceRef.current);
        if (scrollContainer) {
          scrollContainer.scrollTop = snapshot.scrollTop;
        }
      });

      if (!editor || editor.isDestroyed) {
        return;
      }

      const currentSerialized = JSON.stringify(editor.getJSON());
      if (currentSerialized !== serialized) {
        editor.commands.setContent(nextContent, { emitUpdate: false });
      }

      if (!snapshot.selection) {
        return;
      }
      const docSize = editor.state.doc.content.size;
      const from = Math.max(1, Math.min(snapshot.selection.from, docSize));
      const to = Math.max(1, Math.min(snapshot.selection.to, docSize));
      if (from <= to) {
        editor.commands.setTextSelection({ from, to });
      }
    },
    [editor, locked],
  );

  useEffect(() => {
    captureSnapshotRef.current = captureSnapshot;
  }, [captureSnapshot]);

  useEffect(() => {
    restoreSnapshotRef.current = restoreSnapshot;
  }, [restoreSnapshot]);

  useEffect(() => {
    flushForBridgeRef.current = flushForBridge;
  }, [flushForBridge]);

  useEffect(() => {
    if (!bridgeRef.current) {
      bridgeRef.current = {
        captureSnapshot: () => captureSnapshotRef.current(),
        restoreSnapshot: (snapshot) => restoreSnapshotRef.current(snapshot),
        flush: () => flushForBridgeRef.current(),
      };
    }
    onBridgeBindRef.current?.(bridgeRef.current);
    return () => {
      onBridgeBindRef.current?.(null);
    };
  }, []);

  const saveNow = useCallback(
    async (payload: SavePayload) => {
      if (readonly) {
        return;
      }
      if (!shouldPersistWorkspacePayload({
        persistMode,
        hasMaterialized: hasMaterializedRef.current,
      })) {
        return;
      }
      dispatchSaveEvent({ type: "save-start" });
      const normalizedTitle = payload.title.trim() || "无标题文档";
      try {
        await updateDocumentContent(projectKey, documentId, {
          title: normalizedTitle,
          content: payload.content,
        });
        const serialized = JSON.stringify(payload.content);
        lastSavedSerializedRef.current = serialized;
        lastSavedTitleRef.current = normalizedTitle;
        dispatchSaveEvent({ type: "save-success" });
        onSaved?.({
          title: normalizedTitle,
          content: payload.content,
        });
      } catch (error) {
        const status = typeof (error as { status?: unknown })?.status === "number"
          ? (error as { status: number }).status
          : undefined;
        const code = typeof (error as { code?: unknown })?.code === "string"
          ? (error as { code: string }).code
          : undefined;
        const lockFallback = reduceLockFallbackState(
          { readonly: readonlyFallback },
          {
            status,
            code,
          },
        );
        if (lockFallback.readonly && !readonlyFallback && isDocumentLockedError(error)) {
          setReadonlyFallback(true);
          schedulerRef.current?.cancel();
          onLockFallback?.();
        }
        throw error;
      }
    },
    [
      dispatchSaveEvent,
      documentId,
      onLockFallback,
      onSaved,
      persistMode,
      projectKey,
      readonly,
      readonlyFallback,
    ],
  );

  useEffect(() => {
    const scheduler = createSaveScheduler<SavePayload>({
      debounceMs: 600,
      save: saveNow,
      onError: (error) => {
        const message = error instanceof Error ? error.message : "保存失败";
        dispatchSaveEvent({ type: "save-error", error: message });
      },
    });
    schedulerRef.current = scheduler;
    return () => {
      void scheduler.flush().catch(() => undefined);
      scheduler.cancel();
      if (schedulerRef.current === scheduler) {
        schedulerRef.current = null;
      }
    };
  }, [dispatchSaveEvent, saveNow]);

  useEffect(() => {
    const nextContent = content ?? EMPTY_DOC;
    const nextTitle = title;
    const serialized = JSON.stringify(nextContent);
    const nextIdentity = `${projectKey}:${documentId}`;
    const identityChanged = workspaceIdentityRef.current !== nextIdentity;
    workspaceIdentityRef.current = nextIdentity;

    const shouldSyncFromIncoming = shouldApplyIncomingWorkspaceState({
      saveStatus: saveState.status,
      incomingTitle: nextTitle,
      localTitle: latestTitleRef.current,
      incomingSerialized: serialized,
      localSerialized: latestSerializedRef.current,
      force: identityChanged,
    });
    if (!shouldSyncFromIncoming) {
      return;
    }

    if (nextTitle !== latestTitleRef.current) {
      setTitleValue(nextTitle);
    }
    if (serialized !== latestSerializedRef.current) {
      setEditorContent(nextContent);
    }
    latestContentRef.current = nextContent;
    latestTitleRef.current = nextTitle;
    latestSerializedRef.current = serialized;
    lastSavedSerializedRef.current = serialized;
    lastSavedTitleRef.current = nextTitle;
    hasMaterializedRef.current = persistMode === "persisted";
    if (identityChanged) {
      setSaveState(
        persistMode === "ephemeral"
          ? { status: "draft", error: "" }
          : initialSaveState(),
      );
      setReadonlyFallback(false);
    }
  }, [content, documentId, persistMode, projectKey, saveState.status, title]);

  const triggerFirstMeaningfulChange = useCallback(
    async (payload: SavePayload) => {
      if (persistMode !== "ephemeral" || !onFirstMeaningfulChange) {
        return;
      }
      if (!isMeaningfulDraftChange({
        title: payload.title,
        content: payload.content,
        defaultTitle: "无标题文档",
      })) {
        return;
      }
      if (materializingRef.current || hasMaterializedRef.current) {
        return;
      }
      materializingRef.current = true;
      dispatchSaveEvent({ type: "save-start" });
      try {
        await onFirstMeaningfulChange(payload);
        hasMaterializedRef.current = true;
        dispatchSaveEvent({ type: "save-success" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "首次保存失败";
        dispatchSaveEvent({ type: "save-error", error: message });
      } finally {
        materializingRef.current = false;
      }
    },
    [dispatchSaveEvent, onFirstMeaningfulChange, persistMode],
  );

  useEffect(() => {
    onSaveStateChangeRef.current?.(saveState);
  }, [saveState]);

  const retrySave = useCallback(() => {
    if (readonly) {
      return;
    }
    if (persistMode === "ephemeral") {
      void triggerFirstMeaningfulChange({
        title: latestTitleRef.current,
        content: latestContentRef.current,
      });
      return;
    }
    const scheduler = schedulerRef.current;
    if (!scheduler) {
      return;
    }
    const nextPayload: SavePayload = {
      title: latestTitleRef.current,
      content: latestContentRef.current,
    };
    const serialized = latestSerializedRef.current;
    const normalizedTitle = nextPayload.title.trim() || "无标题文档";
    const titleChanged = normalizedTitle !== (lastSavedTitleRef.current.trim() || "无标题文档");
    if (serialized === lastSavedSerializedRef.current && !titleChanged) {
      return;
    }
    dispatchSaveEvent({ type: "changed" });
    scheduler.schedule(nextPayload);
    void scheduler.flush().catch(() => undefined);
  }, [dispatchSaveEvent, persistMode, readonly, triggerFirstMeaningfulChange]);

  useEffect(() => {
    onRetryBindRef.current?.(retrySave);
    return () => {
      onRetryBindRef.current?.(null);
    };
  }, [retrySave]);

  const focusEditor = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    editor.chain().focus("end").run();
  }, [editor]);

  useEffect(() => {
    onFocusBindRef.current?.(focusEditor);
    return () => {
      onFocusBindRef.current?.(null);
    };
  }, [focusEditor]);

  const handleEditorReady = useCallback((instance: Editor | null) => {
    setEditor((prev) => (prev === instance ? prev : instance));
    const nextReady = Boolean(instance);
    setEditorReady((prev) => (prev === nextReady ? prev : nextReady));
  }, []);

  useEffect(() => {
    const onWindowBlur = () => {
      void flushPending("window-blur");
    };
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [flushPending]);

  useEffect(() => {
    return () => {
      const reason: FlushReason = "route-leave";
      void flushPending(reason);
    };
  }, [flushPending, documentId, projectKey]);

  const handleEditorChange = useCallback(
    (nextContent: JSONContent) => {
      if (readonly) {
        return;
      }
      setEditorContent(nextContent);
      latestContentRef.current = nextContent;
      const serialized = JSON.stringify(nextContent);
      latestSerializedRef.current = serialized;
      if (persistMode === "ephemeral") {
        const payload: SavePayload = {
          title: latestTitleRef.current,
          content: nextContent,
        };
        if (!isMeaningfulDraftChange({
          title: payload.title,
          content: payload.content,
          defaultTitle: "无标题文档",
        })) {
          setSaveState((prev) => (prev.status === "draft" ? prev : { status: "draft", error: "" }));
          return;
        }
        void triggerFirstMeaningfulChange(payload);
        return;
      }
      const normalizedTitle = latestTitleRef.current.trim() || "无标题文档";
      const savedTitle = lastSavedTitleRef.current.trim() || "无标题文档";
      if (serialized === lastSavedSerializedRef.current && normalizedTitle === savedTitle) {
        return;
      }
      dispatchSaveEvent({ type: "changed" });
      schedulerRef.current?.schedule({
        title: latestTitleRef.current,
        content: nextContent,
      });
    },
    [dispatchSaveEvent, persistMode, readonly, triggerFirstMeaningfulChange],
  );

  const handleTitleChange = useCallback(
    (nextTitle: string) => {
      if (readonly) {
        return;
      }
      setTitleValue(nextTitle);
      latestTitleRef.current = nextTitle;
      onTitleChange?.(nextTitle);
      if (persistMode === "ephemeral") {
        const payload: SavePayload = {
          title: nextTitle,
          content: latestContentRef.current,
        };
        if (!isMeaningfulDraftChange({
          title: payload.title,
          content: payload.content,
          defaultTitle: "无标题文档",
        })) {
          setSaveState((prev) => (prev.status === "draft" ? prev : { status: "draft", error: "" }));
          return;
        }
        void triggerFirstMeaningfulChange(payload);
        return;
      }
      const normalizedTitle = nextTitle.trim() || "无标题文档";
      const savedTitle = lastSavedTitleRef.current.trim() || "无标题文档";
      const contentChanged = latestSerializedRef.current !== lastSavedSerializedRef.current;
      if (!contentChanged && normalizedTitle === savedTitle) {
        return;
      }
      dispatchSaveEvent({ type: "changed" });
      schedulerRef.current?.schedule({
        title: nextTitle,
        content: latestContentRef.current,
      });
    },
    [dispatchSaveEvent, onTitleChange, persistMode, readonly, triggerFirstMeaningfulChange],
  );

  const saveHint = useMemo(() => mapSaveStatusText(saveState.status), [saveState.status]);

  return (
    <div className={`document-workspace${readonly ? " document-workspace-readonly" : ""}`} ref={workspaceRef}>
      {showTitle ? (
        <div className="document-workspace-title-row">
          <input
            className="document-workspace-title-input"
            value={titleValue}
            placeholder="无标题文档"
            readOnly={readonly}
            onChange={(event) => handleTitleChange(event.target.value)}
          />
        </div>
      ) : null}
      <RichTextEditor
        content={editorContent}
        projectKey={projectKey}
        docId={documentId}
        mode={readonly ? "view" : "edit"}
        onChange={handleEditorChange}
        onEditorReady={handleEditorReady}
      />
      {saveState.status === "error" && saveState.error ? (
        <div className="document-workspace-save-tip error" title={saveState.error}>
          {saveHint}: {saveState.error}
        </div>
      ) : null}
    </div>
  );
}
