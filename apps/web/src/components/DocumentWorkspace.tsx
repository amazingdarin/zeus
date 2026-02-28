import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";

import RichTextEditor from "./RichTextEditor";
import { updateDocumentContent } from "../api/documents";
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
  mapSaveStatusText,
  shouldFlushOn,
} from "../features/document-editor/workspace-model";
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

type DocumentWorkspaceProps = {
  projectKey: string;
  documentId: string;
  title: string;
  content: JSONContent | null;
  blockId?: string | null;
  showTitle?: boolean;
  onSaved?: (payload: SavePayload) => void;
  onSaveStateChange?: (state: EditorSaveState) => void;
  onRetryBind?: (handler: (() => void) | null) => void;
  onFocusBind?: (handler: (() => void) | null) => void;
  onBridgeBind?: (bridge: WorkspaceBridge | null) => void;
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
  onSaved,
  onSaveStateChange,
  onRetryBind,
  onFocusBind,
  onBridgeBind,
}: DocumentWorkspaceProps) {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [titleValue, setTitleValue] = useState(title);
  const [editorContent, setEditorContent] = useState<JSONContent>(content ?? EMPTY_DOC);
  const [saveState, setSaveState] = useState<EditorSaveState>(initialSaveState());

  const schedulerRef = useRef<SaveScheduler<SavePayload> | null>(null);
  const latestContentRef = useRef<JSONContent>(content ?? EMPTY_DOC);
  const latestTitleRef = useRef<string>(title);
  const latestSerializedRef = useRef<string>(JSON.stringify(content ?? EMPTY_DOC));
  const lastSavedSerializedRef = useRef<string>(JSON.stringify(content ?? EMPTY_DOC));
  const lastSavedTitleRef = useRef<string>(title);

  useScrollToBlock(blockId, editorReady);

  const dispatchSaveEvent = useCallback((event: EditorSaveEvent) => {
    setSaveState((prev) => reduceWith(prev, event));
  }, []);

  const flushPending = useCallback(
    async (reason: FlushReason, options?: { throwOnError?: boolean }) => {
      if (!shouldFlushOn(reason)) {
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
    [],
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
      saveStatus: saveState.status,
    };
  }, [editor, saveState.status]);

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
    [editor],
  );

  useEffect(() => {
    onBridgeBind?.({
      captureSnapshot,
      restoreSnapshot,
      flush: flushForBridge,
    });
    return () => {
      onBridgeBind?.(null);
    };
  }, [captureSnapshot, flushForBridge, onBridgeBind, restoreSnapshot]);

  const saveNow = useCallback(
    async (payload: SavePayload) => {
      dispatchSaveEvent({ type: "save-start" });
      const normalizedTitle = payload.title.trim() || "无标题文档";
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
    },
    [dispatchSaveEvent, documentId, onSaved, projectKey],
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
    const serialized = JSON.stringify(nextContent);
    setTitleValue(title);
    setEditorContent(nextContent);
    latestContentRef.current = nextContent;
    latestTitleRef.current = title;
    latestSerializedRef.current = serialized;
    lastSavedSerializedRef.current = serialized;
    lastSavedTitleRef.current = title;
    setSaveState(initialSaveState());
  }, [content, documentId, projectKey, title]);

  useEffect(() => {
    onSaveStateChange?.(saveState);
  }, [onSaveStateChange, saveState]);

  const retrySave = useCallback(() => {
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
  }, [dispatchSaveEvent]);

  useEffect(() => {
    onRetryBind?.(retrySave);
    return () => {
      onRetryBind?.(null);
    };
  }, [onRetryBind, retrySave]);

  const focusEditor = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    editor.chain().focus("end").run();
  }, [editor]);

  useEffect(() => {
    onFocusBind?.(focusEditor);
    return () => {
      onFocusBind?.(null);
    };
  }, [focusEditor, onFocusBind]);

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
      setEditorContent(nextContent);
      latestContentRef.current = nextContent;
      const serialized = JSON.stringify(nextContent);
      latestSerializedRef.current = serialized;
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
    [dispatchSaveEvent],
  );

  const handleTitleChange = useCallback(
    (nextTitle: string) => {
      setTitleValue(nextTitle);
      latestTitleRef.current = nextTitle;
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
    [dispatchSaveEvent],
  );

  const saveHint = useMemo(() => mapSaveStatusText(saveState.status), [saveState.status]);

  return (
    <div className="document-workspace" ref={workspaceRef}>
      {showTitle ? (
        <input
          className="document-workspace-title-input"
          value={titleValue}
          placeholder="无标题文档"
          onChange={(event) => handleTitleChange(event.target.value)}
        />
      ) : null}
      <RichTextEditor
        content={editorContent}
        projectKey={projectKey}
        docId={documentId}
        onChange={handleEditorChange}
        onEditorReady={(instance) => {
          setEditor(instance);
          setEditorReady(Boolean(instance));
        }}
      />
      {saveState.status === "error" && saveState.error ? (
        <div className="document-workspace-save-tip error" title={saveState.error}>
          {saveHint}: {saveState.error}
        </div>
      ) : null}
    </div>
  );
}
