import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { useNavigate, useSearchParams } from "react-router-dom";

import RichTextEditor from "../components/RichTextEditor";
import RichTextViewer from "../components/RichTextViewer";
import { apiFetch } from "../config/api";
import { useProjectContext } from "../context/ProjectContext";
import {
  exportContentJson,
  type ContentMetaInput,
} from "../utils/exportContentJson";

function NewDocumentPage() {
  const { currentProject } = useProjectContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [content, setContent] = useState<JSONContent | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [parentID, setParentID] = useState("");
  const [contentMeta, setContentMeta] = useState<ContentMetaInput>(null);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState(false);
  const [baselineContent, setBaselineContent] = useState<JSONContent | null>(null);
  const inFlightRef = useRef<Map<string, Promise<Awaited<ReturnType<typeof fetchDocumentDetail>>>>>(
    new Map(),
  );
  const currentRequestRef = useRef<string | null>(null);

  const parentIdParam = useMemo(() => {
    return (searchParams.get("parent_id") || "").trim();
  }, [searchParams]);
  const documentIdParam = useMemo(() => {
    return (searchParams.get("document_id") || "").trim();
  }, [searchParams]);

  const contentPayload = useMemo(() => {
    return exportContentJson(
      content ?? { type: "doc", content: [] },
      contentMeta,
    );
  }, [content, contentMeta]);

  const parsedJsonDraft = useMemo(() => {
    if (!jsonMode) {
      return null;
    }
    return parseContentJson(jsonDraft);
  }, [jsonDraft, jsonMode]);

  const diffContent = useMemo(() => {
    if (jsonMode) {
      return parsedJsonDraft?.content ?? null;
    }
    return content;
  }, [content, jsonMode, parsedJsonDraft]);

  const diffContentError = useMemo(() => {
    if (!jsonMode) {
      return null;
    }
    if (!jsonDraft.trim()) {
      return null;
    }
    return parsedJsonDraft ? null : "Invalid JSON content.";
  }, [jsonDraft, jsonMode, parsedJsonDraft]);

  const diffEntries = useMemo(() => {
    return buildBlockDiff(baselineContent, diffContent);
  }, [baselineContent, diffContent]);

  useEffect(() => {
    if (jsonMode) {
      setJsonDraft(JSON.stringify(contentPayload, null, 2));
      setJsonError(null);
    }
  }, [contentPayload, jsonMode]);

  const handleLoadDocument = useCallback(async (id: string) => {
    if (!currentProject?.key) return { type: "doc", content: [] };
    
    setLoadingDocument(true);
    try {
      const detail = await fetchDocumentDetail(currentProject.key, id);
      
      const metaValue = detail?.meta;
      let contentToReturn: JSONContent | null = null;
      
      if (metaValue) {
        setTitle(String(metaValue.title ?? ""));
        setParentID(String(metaValue.parent_id ?? metaValue.parent ?? "").trim());

        const bodyValue = detail?.body ?? detail?.content ?? {};
        const contentValue =
          bodyValue &&
          typeof bodyValue === "object" &&
          "type" in bodyValue &&
          "content" in bodyValue
            ? (bodyValue as { content?: unknown }).content
            : bodyValue;
        const contentMetaValue =
          contentValue &&
          typeof contentValue === "object" &&
          "meta" in contentValue &&
          typeof (contentValue as { meta?: unknown }).meta === "object"
            ? ((contentValue as { meta?: EditorMeta }).meta ?? null)
            : null;
        setContentMeta(contentMetaValue);

        const nestedContent =
          contentValue &&
          typeof contentValue === "object" &&
          "content" in contentValue
            ? (contentValue as { content?: unknown }).content
            : null;
        if (
          nestedContent &&
          typeof nestedContent === "object" &&
          !Array.isArray(nestedContent) &&
          "type" in (nestedContent as Record<string, unknown>)
        ) {
          contentToReturn = nestedContent as JSONContent;
        } else if (
          contentValue &&
          typeof contentValue === "object" &&
          "type" in contentValue
        ) {
          contentToReturn = contentValue as JSONContent;
        }
      } else {
        setTitle(String(detail?.title ?? ""));
        setParentID(String(detail?.parent_id ?? "").trim());
        
        const storageId = String(detail?.storage_object_id ?? "").trim();
        if (storageId) {
           // We create a one-off controller just for this fetch
           const controller = new AbortController();
           const download = await fetchStorageDownload(
             currentProject.key,
             storageId,
             controller.signal
           );
           if (download) {
             const response = await fetch(download, { signal: controller.signal });
             if (response.ok) {
               const text = await response.text();
               const parsed = parseEditorPayload(text);
               if (parsed) {
                 contentToReturn = parsed.content;
                 setContentMeta(parsed.meta ?? null);
               }
             }
           }
        }
      }
      
      if (contentToReturn) {
        setBaselineContent(contentToReturn);
      }
      
      return contentToReturn || { type: "doc", content: [] };
    } catch (err) {
      setSaveError("Failed to load document.");
      throw err;
    } finally {
      setLoadingDocument(false);
    }
  }, [currentProject?.key]);

  useEffect(() => {
    setDocumentId(documentIdParam);
    if (!documentIdParam) {
      setParentID(parentIdParam);
      setContent(null);
      setContentMeta(null);
      setSaveError(null);
      setDiffMode(false);
      setBaselineContent(null);
      currentRequestRef.current = null;
      return;
    }
  }, [documentIdParam, parentIdParam]);

  const handleSave = async () => {

    const projectKey = currentProject?.key ?? "";
    if (!projectKey) {
      setSaveError("Project is required before saving.");
      return;
    }
    setSaveError(null);
    setSaving(true);

    try {
      let payloadForSave = exportContentJson(
        content ?? { type: "doc", content: [] },
        contentMeta,
      );
      if (jsonMode) {
        const parsed = parseContentJson(jsonDraft);
        if (!parsed) {
          setJsonError("Invalid JSON content.");
          setSaving(false);
          return;
        }
        payloadForSave = exportContentJson(parsed.content, parsed.meta ?? null);
        setContent(parsed.content);
        setContentMeta(parsed.meta ?? null);
      }
      let documentPayload;
      const normalizedTitle = title.trim() || "Untitled Document";
      const safeSlug = sanitizeFileName(normalizedTitle);
      const meta = {
        id: documentId || undefined,
        slug: safeSlug || undefined,
        title: normalizedTitle,
        parent_id: (parentID || parentIdParam || "root").trim(),
        extra: {
          status: "draft",
          tags: [],
        },
      };
      documentPayload = await saveDocumentRecord(projectKey, meta, {
        type: "tiptap",
        content: payloadForSave,
      });
      const targetID = String(
        documentPayload?.data?.meta?.id ?? documentPayload?.data?.id ?? documentId ?? "",
      );
      if (targetID) {
        navigate(`/documents?document_id=${encodeURIComponent(targetID)}`, {
          state: { refreshToken: Date.now() },
        });
      }
      setContentMeta(payloadForSave.meta);
      console.log("document_saved", documentPayload);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save document.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleJsonMode = () => {
    if (!jsonMode) {
      setJsonMode(true);
      return;
    }
    const parsed = parseContentJson(jsonDraft);
    if (!parsed) {
      setJsonError("Invalid JSON content.");
      return;
    }
    setContent(parsed.content);
    setContentMeta(parsed.meta);
    setJsonError(null);
    setJsonMode(false);
  };

  const handleToggleDiffMode = () => {
    setDiffMode((prev) => !prev);
  };

  useEffect(() => {
    if (!diffMode) {
      return;
    }
    const changes = diffEntries
      .filter((entry) => entry.status !== "unchanged")
      .map((entry) => ({
        status: entry.status,
        before: entry.originalContent,
        after: entry.editedContent,
        fields: diffFieldChanges(entry.originalContent, entry.editedContent),
      }));
    console.log("document_diff", {
      documentId,
      changes,
    });
  }, [diffEntries, diffMode, documentId]);

  return (
    <div className="new-doc-page">
      <div className="new-doc-header">
        <button className="btn primary" type="button" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          className="btn ghost"
          type="button"
          onClick={handleToggleDiffMode}
          disabled={!baselineContent || Boolean(diffContentError)}
          title={diffContentError ?? ""}
        >
          {diffMode ? "Exit Diff" : "Diff"}
        </button>
        <button className="btn ghost" type="button" onClick={handleToggleJsonMode}>
          {jsonMode ? "Editor" : "JSON"}
        </button>
      </div>
      {saveError ? <div className="doc-viewer-error">{saveError}</div> : null}
      {loadingDocument ? (
        <div className="doc-viewer-state">Loading document...</div>
      ) : null}
      {diffContentError ? <div className="doc-viewer-error">{diffContentError}</div> : null}
      <div className="new-doc-metadata">
        <input
          className="kb-title-input new-doc-title-input"
          type="text"
          value={title}
          placeholder="Untitled Document"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="new-doc-body">
        {diffMode ? (
          <div className="doc-diff-view">
            {diffEntries.length === 0 ? (
              <div className="doc-viewer-state">No changes detected.</div>
            ) : (
              diffEntries.map((entry, index) =>
                entry.status === "unchanged" ? (
                  <div key={`${entry.status}-${index}`} className="doc-diff-plain">
                    {entry.content ? (
                      <RichTextViewer
                        content={entry.content}
                        projectKey={currentProject?.key ?? ""}
                      />
                    ) : (
                      <div className="doc-viewer-state">No content</div>
                    )}
                  </div>
                ) : (
                  <div
                    key={`${entry.status}-${index}`}
                    className={`doc-diff-block doc-diff-${entry.status}`}
                  >
                    <div className="doc-diff-label">{renderDiffLabel(entry.status)}</div>
                    <div className="doc-diff-change">
                      {entry.originalContent ? (
                        <div className="doc-diff-change-item">
                          <div className="doc-diff-change-title">Before</div>
                          <RichTextViewer
                            content={entry.originalContent}
                            projectKey={currentProject?.key ?? ""}
                          />
                        </div>
                      ) : null}
                      {entry.editedContent ? (
                        <div className="doc-diff-change-item">
                          <div className="doc-diff-change-title">After</div>
                          <RichTextViewer
                            content={entry.editedContent}
                            projectKey={currentProject?.key ?? ""}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                ),
              )
            )}
          </div>
        ) : jsonMode ? (
          <div className="new-doc-json">
            <div className="new-doc-json-title">Document JSON</div>
            <textarea
              className="new-doc-json-editor"
              value={jsonDraft}
              onChange={(event) => setJsonDraft(event.target.value)}
              spellCheck={false}
            />
            {jsonError ? <div className="doc-viewer-error">{jsonError}</div> : null}
          </div>
        ) : (
          <div className="new-doc-editor">
            <RichTextEditor
              content={content}
              onChange={setContent}
              projectKey={currentProject?.key ?? ""}
              docId={documentIdParam || undefined}
              onLoadDocument={handleLoadDocument}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default NewDocumentPage;

const saveDocumentRecord = async (
  projectKey: string,
  meta: {
    id?: string;
    slug?: string;
    title: string;
    parent_id: string;
    extra?: {
      status?: string;
      tags?: string[];
    };
  },
  body: {
    type: string;
    content: { meta: EditorMeta; content: JSONContent } | JSONContent;
  },
) => {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/documents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meta,
        body,
      }),
    },
  );
  if (!response.ok) {
    throw new Error("save document failed");
  }
  return response.json();
};

const sanitizeFileName = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  const cleaned = trimmed.replace(/[^a-z0-9-_]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 48);
};

const fetchDocumentDetail = async (
  projectKey: string,
  documentId: string,
) => {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(
      documentId,
    )}`,
  );
  if (!response.ok) {
    throw new Error("failed to load document");
  }
  const payload = (await response.json()) as {
    data?: {
      meta?: {
        id?: string;
        slug?: string;
        title?: string;
        parent_id?: string;
        extra?: {
          status?: string;
          tags?: string[];
        };
      };
      body?: {
        type?: string;
        content?: {
          meta?: EditorMeta;
          content?: JSONContent;
        };
      };
      content?: {
        meta?: EditorMeta;
        content?: JSONContent;
      };
      id?: string;
      title?: string;
      parent_id?: string;
      storage_object_id?: string;
    };
  };
  return payload?.data ?? null;
};

const fetchStorageDownload = async (
  projectKey: string,
  storageObjectID: string,
  signal: AbortSignal,
) => {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/storage-objects/${encodeURIComponent(
      storageObjectID,
    )}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error("failed to load storage object");
  }
  const payload = (await response.json()) as {
    download?: { url?: string };
  };
  return payload?.download?.url ?? "";
};

type EditorMeta = {
  zeus?: boolean;
  format?: string;
  schema_version?: number;
  editor?: string;
  created_at?: string;
  updated_at?: string;
};

type EditorPayload = {
  meta?: EditorMeta;
  content?: JSONContent;
} & JSONContent;

const parseEditorPayload = (raw: string) => {
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as EditorPayload;
    if (parsed.meta?.zeus && parsed.meta.format === "tiptap" && parsed.content) {
      return {
        meta: parsed.meta,
        content: parsed.content,
      };
    }
    if (parsed.type === "doc") {
      return {
        content: parsed,
      };
    }
    if (parsed.content?.type === "doc") {
      return {
        content: parsed.content,
      };
    }
    return null;
  } catch {
    return null;
  }
};

const parseContentJson = (raw: string) => {
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as {
      meta?: EditorMeta;
      content?: JSONContent;
      type?: string;
    };
    if (parsed?.content && parsed.content.type === "doc") {
      return { meta: parsed.meta ?? null, content: parsed.content };
    }
    if (parsed?.type === "doc") {
      return { meta: null, content: parsed as JSONContent };
    }
    return null;
  } catch {
    return null;
  }
};

type BlockDiffStatus = "added" | "removed" | "modified" | "unchanged";

type BlockDiffEntry = {
  status: BlockDiffStatus;
  content: JSONContent | null;
  originalContent?: JSONContent | null;
  editedContent?: JSONContent | null;
};

const renderDiffLabel = (status: BlockDiffStatus) => {
  switch (status) {
    case "added":
      return "Added";
    case "removed":
      return "Removed";
    case "modified":
      return "Modified";
    default:
      return "Unchanged";
  }
};

const buildBlockDiff = (
  original: JSONContent | null,
  edited: JSONContent | null,
): BlockDiffEntry[] => {
  const originalBlocks = extractBlocks(original);
  const editedBlocks = extractBlocks(edited);

  // LCS-based diffing logic for block lists
  const m = originalBlocks.length;
  const n = editedBlocks.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const oldId = originalBlocks[i - 1].attrs?.id;
      const newId = editedBlocks[j - 1].attrs?.id;

      if (oldId && newId && oldId === newId) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const results: BlockDiffEntry[] = [];
  let i = m;
  let j = n;

  // Backtracking to find the diff path (raw unmerged)
  const rawPath: BlockDiffEntry[] = [];
  while (i > 0 || j > 0) {
    const originalBlock = i > 0 ? originalBlocks[i - 1] : null;
    const editedBlock = j > 0 ? editedBlocks[j - 1] : null;
    const oldId = originalBlock?.attrs?.id;
    const newId = editedBlock?.attrs?.id;

    if (i > 0 && j > 0 && oldId && newId && oldId === newId) {
      if (originalBlock && editedBlock) {
        if (blocksEqual(originalBlock, editedBlock)) {
          appendRawDiffBlock(rawPath, "unchanged", originalBlock, originalBlock);
        } else {
          appendRawDiffBlock(rawPath, "modified", originalBlock, editedBlock);
        }
      }
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      if (editedBlock && !isPureEmptyBlock(editedBlock)) {
        appendRawDiffBlock(rawPath, "added", null, editedBlock);
      }
      j--;
    } else {
      if (originalBlock && !isPureEmptyBlock(originalBlock)) {
        appendRawDiffBlock(rawPath, "removed", originalBlock, null);
      }
      i--;
    }
  }

  // Reverse to get chronological order, then merge
  const chronOrder = rawPath.reverse();
  const mergedResults: BlockDiffEntry[] = [];
  
  for (const entry of chronOrder) {
      mergeDiffBlock(mergedResults, entry);
  }

  return mergedResults;
};

const appendRawDiffBlock = (
  results: BlockDiffEntry[],
  status: BlockDiffStatus,
  originalBlock: JSONContent | null,
  editedBlock: JSONContent | null,
) => {
  const entry: BlockDiffEntry = {
    status,
    originalContent: originalBlock ? wrapDoc(originalBlock) : null,
    editedContent: editedBlock ? wrapDoc(editedBlock) : null,
  };
  if (status === "unchanged" && originalBlock) {
    entry.content = wrapDoc(originalBlock);
  }
  results.push(entry);
};

const mergeDiffBlock = (
    results: BlockDiffEntry[],
    entry: BlockDiffEntry
) => {
  const last = results.at(-1);
  if (last && last.status === entry.status) {
    // Merge logic
    if (entry.originalContent?.content && last.originalContent?.content) {
      last.originalContent.content.push(...entry.originalContent.content);
    }
    if (entry.editedContent?.content && last.editedContent?.content) {
        last.editedContent.content.push(...entry.editedContent.content);
    }
    if (entry.content?.content && last.content?.content) {
        last.content.content.push(...entry.content.content);
    }
    return;
  }
  results.push(entry);
};


const isPureEmptyBlock = (block: JSONContent): boolean => {
  // A block is considered "pure empty" if it has no content array
  // AND no meaningful attributes (other than ID)
  // AND is a basic paragraph (usually default empty state)
  if (block.type !== "paragraph") {
    return false;
  }
  if (block.content && block.content.length > 0) {
    return false;
  }
  // Check attrs
  if (block.attrs) {
    const attrs = { ...block.attrs };
    delete attrs.id;
    // If it has other attributes (like textAlign, class), it's not "pure empty"
    // However, stripNullFields logic might leave empty objects, so we check keys
    const validKeys = Object.keys(attrs).filter(
      (k) => attrs[k] !== null && attrs[k] !== undefined,
    );
    if (validKeys.length > 0) {
      return false;
    }
  }
  return true;
};


const extractBlocks = (content: JSONContent | null): JSONContent[] => {
  if (!content || !Array.isArray(content.content)) {
    return [];
  }
  return content.content.filter((block) => block && typeof block === "object");
};

const wrapDoc = (block: JSONContent): JSONContent => ({
  type: "doc",
  content: [block],
});

const blocksEqual = (left: JSONContent, right: JSONContent): boolean => {
  return normalizeBlock(left) === normalizeBlock(right);
};

const normalizeBlock = (block: JSONContent): string => {
  const clone = JSON.parse(JSON.stringify(block)) as JSONContent;
  const cleaned = stripNullFields(clone) as JSONContent;
  if (cleaned.attrs && typeof cleaned.attrs === "object") {
    delete cleaned.attrs.id;
    if (Object.keys(cleaned.attrs).length === 0) {
      delete cleaned.attrs;
    }
  }
  return stableStringify(cleaned);
};

const stableStringify = (obj: unknown): string => {
  if (obj !== null && typeof obj === "object") {
    if (Array.isArray(obj)) {
      return "[" + obj.map(stableStringify).join(",") + "]";
    }
    return (
      "{" +
      Object.keys(obj)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + stableStringify((obj as Record<string, unknown>)[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(obj);
};

const stripNullFields = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripNullFields);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).flatMap(([key, val]) => {
      if (val === null || val === undefined) {
        return [];
      }
      return [[key, stripNullFields(val)]] as Array<[string, unknown]>;
    });
    return Object.fromEntries(entries);
  }
  return value;
};

const diffFieldChanges = (
  before: JSONContent | null | undefined,
  after: JSONContent | null | undefined,
) => {
  const beforeValue = before ? stripNullFields(before) : null;
  const afterValue = after ? stripNullFields(after) : null;
  const differences: Array<{ path: string; before: unknown; after: unknown }> = [];
  const seen = new Set<string>();

  const walk = (left: unknown, right: unknown, path: string) => {
    if (left === right) {
      return;
    }
    const leftType = getValueType(left);
    const rightType = getValueType(right);
    if (leftType !== rightType) {
      differences.push({ path, before: left, after: right });
      return;
    }
    if (leftType === "array") {
      const leftArray = left as unknown[];
      const rightArray = right as unknown[];
      const maxLength = Math.max(leftArray.length, rightArray.length);
      for (let index = 0; index < maxLength; index += 1) {
        walk(leftArray[index], rightArray[index], `${path}[${index}]`);
      }
      return;
    }
    if (leftType === "object") {
      const leftObject = left as Record<string, unknown>;
      const rightObject = right as Record<string, unknown>;
      const keys = new Set([...Object.keys(leftObject), ...Object.keys(rightObject)]);
      keys.forEach((key) => {
        walk(leftObject[key], rightObject[key], path ? `${path}.${key}` : key);
      });
      return;
    }
    differences.push({ path, before: left, after: right });
  };

  walk(beforeValue, afterValue, "");
  const unique = differences.filter((diff) => {
    const key = `${diff.path}:${String(diff.before)}:${String(diff.after)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return unique;
};

const getValueType = (value: unknown) => {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value && typeof value === "object") {
    return "object";
  }
  if (value === null || value === undefined) {
    return "null";
  }
  return "primitive";
};
