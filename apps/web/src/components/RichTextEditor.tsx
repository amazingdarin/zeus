import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { Extensions, Range } from "@tiptap/core";

import {
  BlockRefNode,
  type CodeExecBlockState,
  type CodeExecTriggerInput,
  DocEditor,
  FileBlockNode,
  OpenApiNode,
  OpenApiRefNode,
} from "@zeus/doc-editor";

import { apiFetch } from "../config/api";
import { getGeneralSettings } from "../api/general-settings";
import { fetchUrlHtml } from "../api/documents";
import { usePluginRuntime } from "../context/PluginRuntimeContext";
import BlockRefPicker from "./BlockRefPicker";
import DocEditorErrorBoundary from "./DocEditorErrorBoundary";
import type { DocumentBlockShortcutPayload } from "../constants/document-block-shortcuts";

interface RichTextEditorProps {
  onChange?: (content: JSONContent) => void;
  content?: JSONContent | null;
  projectKey?: string;
  docId?: string;
  mode?: "edit" | "view";
  onLoadDocument?: (id: string) => Promise<JSONContent>;
  onEditorReady?: (editor: Editor | null) => void;
  onCodeExecRun?: (input: CodeExecTriggerInput) => Promise<void> | void;
  codeExecStateByBlockId?: Record<string, CodeExecBlockState>;
  onBlockCommentOpen?: (input: { blockId: string }) => void;
  commentCountByBlockId?: Record<string, number>;
}

const openApiExtensions = (projectKey?: string): Extensions => [
  OpenApiNode.configure({
    projectKey,
    fetcher: apiFetch,
  }),
  OpenApiRefNode.configure({
    projectKey,
    fetcher: apiFetch,
  }),
  FileBlockNode.configure({
    projectKey,
    fetcher: apiFetch,
  }),
];

function RichTextEditor({
  onChange,
  content,
  projectKey,
  docId,
  mode = "edit",
  onLoadDocument,
  onEditorReady: onEditorReadyProp,
  onCodeExecRun,
  codeExecStateByBlockId,
  onBlockCommentOpen,
  commentCountByBlockId,
}: RichTextEditorProps) {
  const { editorContributions } = usePluginRuntime();
  const editorRef = useRef<Editor | null>(null);
  const onEditorReadyRef = useRef(onEditorReadyProp);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [triggerRange, setTriggerRange] = useState<Range | null>(null);
  const [documentBlockShortcuts, setDocumentBlockShortcuts] =
    useState<DocumentBlockShortcutPayload | undefined>(undefined);

  useEffect(() => {
    onEditorReadyRef.current = onEditorReadyProp;
  }, [onEditorReadyProp]);

  useEffect(() => {
    let mounted = true;
    void getGeneralSettings()
      .then((settings) => {
        if (!mounted) {
          return;
        }
        setDocumentBlockShortcuts(settings.documentBlockShortcuts);
      })
      .catch(() => {
        // ignore settings bootstrap failure for editor init
      });

    const handleSettingsUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { documentBlockShortcuts?: DocumentBlockShortcutPayload }
        | undefined;
      if (!detail?.documentBlockShortcuts) {
        return;
      }
      setDocumentBlockShortcuts(detail.documentBlockShortcuts);
    };

    window.addEventListener("zeus:general-settings-updated", handleSettingsUpdate);
    return () => {
      mounted = false;
      window.removeEventListener("zeus:general-settings-updated", handleSettingsUpdate);
    };
  }, []);

  const openPickerAtRange = useCallback(
    (range: Range) => {
      if (!projectKey) {
        return;
      }
      setTriggerRange(range);
      setPickerOpen(true);
    },
    [projectKey],
  );

  const handleTrigger = useCallback(
    (payload: { editor: Editor; range: Range }) => {
      openPickerAtRange(payload.range);
    },
    [openPickerAtRange],
  );

  const handleBlockSelect = useCallback(
    (payload: {
      editor: Editor;
      range: Range;
      attrs?: { doc_id?: string; block_id?: string };
    }) => {
      openPickerAtRange(payload.range);
    },
    [openPickerAtRange],
  );

  const handleCancel = useCallback(() => {
    setPickerOpen(false);
    setTriggerRange(null);
  }, []);

  const handleSelect = useCallback(
    (docIdValue: string, blockIdValue: string) => {
      const editor = editorRef.current;
      if (!editor || !triggerRange) {
        handleCancel();
        return;
      }
      editor
        .chain()
        .focus()
        .insertBlockRefAt(triggerRange, {
          doc_id: docIdValue,
          block_id: blockIdValue,
        })
        .run();
      setPickerOpen(false);
      setTriggerRange(null);
    },
    [handleCancel, triggerRange],
  );

  const extensions = useMemo<Extensions>(() => {
    const openapi = openApiExtensions(projectKey);
    const blockRef = BlockRefNode.configure({
      projectKey,
      fetcher: apiFetch,
      viewerExtensions: openapi,
      onTrigger: handleTrigger,
      onSelect: handleBlockSelect,
    });
    return [...openapi, blockRef];
  }, [handleBlockSelect, handleTrigger, projectKey]);

  const handleEditorReady = useCallback((editor: Editor | null) => {
    if (editorRef.current !== editor) {
      editorRef.current = editor;
    }
    onEditorReadyRef.current?.(editor);
  }, []);

  return (
    <>
      <DocEditorErrorBoundary>
        <DocEditor
          onChange={onChange}
          content={content}
          extensions={extensions}
          pluginContributions={editorContributions}
          mode={mode}
          docId={docId}
          onLoadDocument={onLoadDocument}
          documentBlockShortcuts={documentBlockShortcuts}
          onCodeExecRun={onCodeExecRun}
          codeExecStateByBlockId={codeExecStateByBlockId}
          onBlockCommentOpen={onBlockCommentOpen}
          commentCountByBlockId={commentCountByBlockId}
          linkPreviewFetchHtml={async (url: string) => {
            if (!projectKey) {
              return ""
            }
            const data = await fetchUrlHtml(projectKey, url)
            return data.html
          }}
          onEditorReady={handleEditorReady}
        />
      </DocEditorErrorBoundary>
      <BlockRefPicker
        open={pickerOpen}
        projectKey={projectKey ?? ""}
        onCancel={handleCancel}
        onSelect={handleSelect}
      />
    </>
  );
}

export default RichTextEditor;
