import { useCallback, useMemo, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { Range } from "@tiptap/core";

import { BlockRefNode, DocEditor } from "@zeus/doc-editor";
import { OpenApiNode, OpenApiRefNode } from "@zeus/doc-editor-openapi";

import { apiFetch } from "../config/api";
import BlockRefPicker from "./BlockRefPicker";

interface RichTextEditorProps {
  onChange?: (content: JSONContent) => void;
  content?: JSONContent | null;
  projectKey?: string;
  docId?: string;
  onLoadDocument?: (id: string) => Promise<JSONContent>;
}

const openApiExtensions = (projectKey?: string) => [
  OpenApiNode.configure({
    projectKey,
    fetcher: apiFetch,
  }),
  OpenApiRefNode.configure({
    projectKey,
    fetcher: apiFetch,
  }),
];

function RichTextEditor({
  onChange,
  content,
  projectKey,
  docId,
  onLoadDocument,
}: RichTextEditorProps) {
  const editorRef = useRef<Editor | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [triggerRange, setTriggerRange] = useState<Range | null>(null);

  const handleTrigger = useCallback(
    (payload: { editor: Editor; range: Range }) => {
      if (!projectKey) {
        return;
      }
      setTriggerRange(payload.range);
      setPickerOpen(true);
    },
    [projectKey],
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

  const extensions = useMemo(() => {
    const openapi = openApiExtensions(projectKey);
    const blockRef = BlockRefNode.configure({
      projectKey,
      fetcher: apiFetch,
      viewerExtensions: openapi,
      onTrigger: handleTrigger,
    });
    return [...openapi, blockRef];
  }, [handleTrigger, projectKey]);

  return (
    <>
      <DocEditor
        onChange={onChange}
        content={content}
        extensions={extensions}
        mode="edit"
        docId={docId}
        onLoadDocument={onLoadDocument}
        onEditorReady={(editor) => {
          editorRef.current = editor;
        }}
      />
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
