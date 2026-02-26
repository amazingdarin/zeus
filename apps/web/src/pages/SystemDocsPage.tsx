import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ReloadOutlined } from "@ant-design/icons";
import { Select, Tooltip } from "antd";
import type { JSONContent } from "@tiptap/react";

import { ensureBlockIds } from "@zeus/doc-editor";
import { markdownToTiptapJson } from "@zeus/shared";

import KnowledgeBaseLayout from "../components/KnowledgeBaseLayout";
import KnowledgeBaseSideNav, {
  type KnowledgeBaseDocument,
  type KnowledgeBaseMoveRequest,
} from "../components/KnowledgeBaseSideNav";
import RichTextViewer from "../components/RichTextViewer";
import {
  buildSystemDocAssetUrl,
  fetchSystemDocContent,
  fetchSystemDocsTree,
  type SystemDocTreeItem,
} from "../api/system-docs";

const DEFAULT_LANGUAGE = "en";
const LANGUAGE_TAG_PATTERN = /^[a-z]{2}(?:-[a-z0-9]{2,8})*$/i;
const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  zh: "中文",
  "zh-cn": "中文（简体）",
  "zh-tw": "中文（繁體）",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  pt: "Português",
  ru: "Русский",
};

function normalizeLanguageTag(rawLanguage: string): string {
  const normalized = String(rawLanguage ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (!normalized) {
    return DEFAULT_LANGUAGE;
  }
  if (!LANGUAGE_TAG_PATTERN.test(normalized)) {
    return DEFAULT_LANGUAGE;
  }
  return normalized;
}

function formatLanguageLabel(language: string): string {
  const normalized = normalizeLanguageTag(language);
  return LANGUAGE_LABELS[normalized] || normalized.toUpperCase();
}

function sortLanguageTags(codes: Iterable<string>): string[] {
  return Array.from(new Set(codes))
    .map((code) => normalizeLanguageTag(code))
    .sort((a, b) => {
      if (a === b) {
        return 0;
      }
      if (a === DEFAULT_LANGUAGE) {
        return -1;
      }
      if (b === DEFAULT_LANGUAGE) {
        return 1;
      }
      return a.localeCompare(b, "en", { sensitivity: "base" });
    });
}

function getHrefPathPart(rawHref: string): string {
  let pathPart = rawHref;
  const hashIndex = pathPart.indexOf("#");
  if (hashIndex >= 0) {
    pathPart = pathPart.slice(0, hashIndex);
  }
  const queryIndex = pathPart.indexOf("?");
  if (queryIndex >= 0) {
    pathPart = pathPart.slice(0, queryIndex);
  }
  return pathPart;
}

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href) || href.startsWith("//");
}

function isInlineAssetHref(href: string): boolean {
  return /^(data:|blob:)/i.test(href);
}

function isMarkdownPath(docPath: string): boolean {
  const lower = docPath.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function dirname(docPath: string): string {
  const index = docPath.lastIndexOf("/");
  if (index < 0) {
    return "";
  }
  return docPath.slice(0, index);
}

function normalizePosixPath(rawPath: string): string | null {
  const normalized = rawPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const stack: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (stack.length === 0) {
        return null;
      }
      stack.pop();
      continue;
    }
    stack.push(part);
  }

  return stack.join("/");
}

function resolveRelativePath(currentDocPath: string, targetPath: string): string | null {
  const normalizedTarget = targetPath.replace(/\\/g, "/");
  if (!normalizedTarget) {
    return normalizePosixPath(currentDocPath);
  }

  if (normalizedTarget.startsWith("/")) {
    return normalizePosixPath(normalizedTarget.slice(1));
  }

  const baseDir = dirname(currentDocPath);
  const joined = baseDir ? `${baseDir}/${normalizedTarget}` : normalizedTarget;
  return normalizePosixPath(joined);
}

function findFirstMarkdownPath(items: SystemDocTreeItem[]): string | null {
  for (const item of items) {
    if (item.type === "file") {
      return item.path;
    }
    const children = item.children ?? [];
    const nested = findFirstMarkdownPath(children);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function collectDirectoryPaths(items: SystemDocTreeItem[], out: Record<string, boolean>): void {
  for (const item of items) {
    if (item.type !== "dir") {
      continue;
    }
    out[item.path] = true;
    collectDirectoryPaths(item.children ?? [], out);
  }
}

function collectLanguageTags(items: SystemDocTreeItem[], out: Set<string>): void {
  for (const item of items) {
    if (item.type === "dir") {
      collectLanguageTags(item.children ?? [], out);
      continue;
    }
    const languages = Array.isArray(item.languages) ? item.languages : [];
    for (const language of languages) {
      out.add(normalizeLanguageTag(language));
    }
  }
}

type KnowledgeBaseTreeModel = {
  rootDocuments: KnowledgeBaseDocument[];
  childrenByParent: Record<string, KnowledgeBaseDocument[]>;
};

function toKnowledgeBaseTree(items: SystemDocTreeItem[]): KnowledgeBaseTreeModel {
  const childrenByParent: Record<string, KnowledgeBaseDocument[]> = {};

  const mapItems = (nodes: SystemDocTreeItem[], parentId: string): KnowledgeBaseDocument[] => {
    return nodes.map((node, index) => {
      const children = node.type === "dir" ? node.children ?? [] : [];
      const hasChild = children.length > 0;
      const doc: KnowledgeBaseDocument = {
        id: node.path,
        title: node.name,
        type: node.type,
        parentId,
        kind: node.type,
        hasChild,
        order: index,
        storageObjectId: "",
      };

      if (hasChild) {
        childrenByParent[doc.id] = mapItems(children, doc.id);
      }

      return doc;
    });
  };

  const rootDocuments = mapItems(items, "");
  return { rootDocuments, childrenByParent };
}

function rewriteImageSources(node: JSONContent, currentDocPath: string): JSONContent {
  const nextNode: JSONContent = { ...node };

  if ((nextNode.type === "image" || nextNode.type === "imageUpload") && nextNode.attrs) {
    const attrs = nextNode.attrs as Record<string, unknown>;
    const rawSrc = typeof attrs.src === "string" ? attrs.src : "";
    if (rawSrc && !isExternalHref(rawSrc) && !isInlineAssetHref(rawSrc)) {
      const resolvedPath = resolveRelativePath(currentDocPath, getHrefPathPart(rawSrc));
      if (resolvedPath) {
        nextNode.attrs = {
          ...attrs,
          src: buildSystemDocAssetUrl(resolvedPath),
        };
      }
    }
  }

  if (Array.isArray(nextNode.content) && nextNode.content.length > 0) {
    nextNode.content = nextNode.content.map((child) => rewriteImageSources(child, currentDocPath));
  }

  return nextNode;
}

function SystemDocsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPath = String(searchParams.get("path") ?? "").trim();
  const rawLanguage = String(searchParams.get("lang") ?? "").trim();
  const selectedLanguage = normalizeLanguageTag(rawLanguage);

  const [tree, setTree] = useState<SystemDocTreeItem[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [content, setContent] = useState("");
  const [activePath, setActivePath] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [outlineMode, setOutlineMode] = useState(false);

  const contentRequestRef = useRef(0);
  const emptyLoadingIds = useMemo<Record<string, boolean>>(() => ({}), []);

  const firstMarkdownPath = useMemo(() => findFirstMarkdownPath(tree), [tree]);
  const currentDocPath = activePath || selectedPath;
  const activeDocId = currentDocPath || null;

  const availableLanguages = useMemo(() => {
    const langSet = new Set<string>([DEFAULT_LANGUAGE, selectedLanguage]);
    collectLanguageTags(tree, langSet);
    return sortLanguageTags(langSet);
  }, [selectedLanguage, tree]);

  const languageOptions = useMemo(
    () =>
      availableLanguages.map((language) => ({
        value: language,
        label: formatLanguageLabel(language),
      })),
    [availableLanguages],
  );

  const { rootDocuments, childrenByParent } = useMemo(() => toKnowledgeBaseTree(tree), [tree]);

  const allExpandableDocumentIds = useMemo(() => {
    const ids = new Set<string>();
    rootDocuments.forEach((doc) => {
      if (doc.hasChild) {
        ids.add(doc.id);
      }
    });
    Object.entries(childrenByParent).forEach(([parentId, children]) => {
      if (children.length > 0) {
        ids.add(parentId);
      }
    });
    return Array.from(ids);
  }, [childrenByParent, rootDocuments]);

  const updatePathQuery = useCallback(
    (nextPath: string, replace = false) => {
      const params = new URLSearchParams(searchParams);
      params.set("lang", selectedLanguage);
      params.set("path", nextPath);
      setSearchParams(params, { replace });
    },
    [searchParams, selectedLanguage, setSearchParams],
  );

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const result = await fetchSystemDocsTree(selectedLanguage);
      setTree(result);
      const expandedMap: Record<string, boolean> = {};
      collectDirectoryPaths(result, expandedMap);
      setExpandedIds(expandedMap);
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载系统文档目录失败";
      setTreeError(message);
      setTree([]);
      setExpandedIds({});
    } finally {
      setTreeLoading(false);
    }
  }, [selectedLanguage]);

  const loadContent = useCallback(
    async (docPath: string) => {
      const requestId = ++contentRequestRef.current;
      setContentLoading(true);
      setContentError(null);

      try {
        const data = await fetchSystemDocContent(docPath, selectedLanguage);
        if (requestId !== contentRequestRef.current) {
          return;
        }
        setContent(data.content);
        setActivePath(data.path);
      } catch (err) {
        if (requestId !== contentRequestRef.current) {
          return;
        }
        const message = err instanceof Error ? err.message : "加载系统文档失败";
        setContentError(message);
        setContent("");
        setActivePath(docPath);
      } finally {
        if (requestId === contentRequestRef.current) {
          setContentLoading(false);
        }
      }
    },
    [selectedLanguage],
  );

  useEffect(() => {
    if (rawLanguage === selectedLanguage) {
      return;
    }
    const params = new URLSearchParams(searchParams);
    params.set("lang", selectedLanguage);
    setSearchParams(params, { replace: true });
  }, [rawLanguage, searchParams, selectedLanguage, setSearchParams]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  useEffect(() => {
    if (!selectedPath && firstMarkdownPath) {
      updatePathQuery(firstMarkdownPath, true);
    }
  }, [firstMarkdownPath, selectedPath, updatePathQuery]);

  useEffect(() => {
    if (!selectedPath) {
      setContent("");
      setActivePath("");
      setContentError(null);
      setContentLoading(false);
      return;
    }
    void loadContent(selectedPath);
  }, [loadContent, selectedPath]);

  const handleRefresh = useCallback(() => {
    void loadTree();
    if (selectedPath) {
      void loadContent(selectedPath);
    }
  }, [loadContent, loadTree, selectedPath]);

  const handleToggleDoc = useCallback((doc: KnowledgeBaseDocument) => {
    if (!doc.hasChild) {
      return;
    }
    setExpandedIds((prev) => ({
      ...prev,
      [doc.id]: !prev[doc.id],
    }));
  }, []);

  const handleExpandAllTree = useCallback(() => {
    if (treeLoading || allExpandableDocumentIds.length === 0) {
      return;
    }
    const expandedMap: Record<string, boolean> = {};
    allExpandableDocumentIds.forEach((id) => {
      expandedMap[id] = true;
    });
    setExpandedIds(expandedMap);
  }, [allExpandableDocumentIds, treeLoading]);

  const handleCollapseTreeToRoot = useCallback(() => {
    setExpandedIds({});
  }, []);

  const handleSelectDoc = useCallback(
    (doc: KnowledgeBaseDocument) => {
      if (doc.hasChild) {
        handleToggleDoc(doc);
        return;
      }
      updatePathQuery(doc.id);
    },
    [handleToggleDoc, updatePathQuery],
  );

  const handleLanguageChange = useCallback(
    (nextLanguage: string) => {
      const params = new URLSearchParams(searchParams);
      params.set("lang", normalizeLanguageTag(nextLanguage));
      if (!params.get("path") && firstMarkdownPath) {
        params.set("path", firstMarkdownPath);
      }
      setSearchParams(params);
    },
    [firstMarkdownPath, searchParams, setSearchParams],
  );

  const viewerContent = useMemo<JSONContent | null>(() => {
    if (!content) {
      return null;
    }

    try {
      const parsed = markdownToTiptapJson(content);
      const rewritten = rewriteImageSources(parsed, currentDocPath);
      return ensureBlockIds(rewritten);
    } catch (err) {
      console.error("[SystemDocsPage] markdown parse failed:", err);
      return null;
    }
  }, [content, currentDocPath]);

  const handleViewerLinkClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor) {
        return;
      }

      const href = anchor.getAttribute("href") ?? "";
      if (!href) {
        return;
      }

      if (isExternalHref(href)) {
        event.preventDefault();
        event.stopPropagation();
        window.open(href, "_blank", "noopener,noreferrer");
        return;
      }

      if (href.startsWith("#/system-docs")) {
        event.preventDefault();
        event.stopPropagation();
        const query = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
        const next = new URLSearchParams(query);
        const nextPath = String(next.get("path") ?? "").trim();
        const nextLang = normalizeLanguageTag(String(next.get("lang") ?? selectedLanguage));
        const merged = new URLSearchParams(searchParams);
        merged.set("lang", nextLang);
        if (nextPath) {
          merged.set("path", nextPath);
        }
        setSearchParams(merged);
        return;
      }

      if (href.startsWith("#")) {
        return;
      }

      const resolvedPath = resolveRelativePath(currentDocPath, getHrefPathPart(href));
      if (!resolvedPath) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (isMarkdownPath(resolvedPath)) {
        updatePathQuery(resolvedPath);
        return;
      }

      window.open(buildSystemDocAssetUrl(resolvedPath), "_blank", "noopener,noreferrer");
    },
    [currentDocPath, searchParams, selectedLanguage, setSearchParams, updatePathQuery],
  );

  const handleMoveNoop = useCallback((_request: KnowledgeBaseMoveRequest) => {
    // System docs are read-only.
  }, []);

  return (
    <KnowledgeBaseLayout
      sideNav={
        <KnowledgeBaseSideNav
          documents={rootDocuments}
          childrenByParent={childrenByParent}
          expandedIds={expandedIds}
          activeId={activeDocId}
          loadingIds={emptyLoadingIds}
          rootLoading={treeLoading}
          onSelect={handleSelectDoc}
          onToggle={handleToggleDoc}
          onMove={handleMoveNoop}
          onRefresh={handleRefresh}
          onExpandAll={handleExpandAllTree}
          onCollapseToRoot={handleCollapseTreeToRoot}
          outlineMode={outlineMode}
          onToggleOutline={() => setOutlineMode((prev) => !prev)}
          documentContent={viewerContent}
          errorMessage={treeError}
          emptyMessage="未发现可浏览的 Markdown 文档"
          emptyClickable={false}
        />
      }
    >
      <>
        <div className="kb-main-header">
          <div className="system-docs-main-header-title">
            <div className="doc-page-title">教程说明</div>
            <div className="system-docs-subtitle">
              {currentDocPath || "请选择左侧文档"}
            </div>
          </div>
          <div className="system-docs-header-actions">
            <Select
              className="system-docs-language-select"
              size="small"
              value={selectedLanguage}
              options={languageOptions}
              onChange={handleLanguageChange}
            />
            <Tooltip title="刷新文档">
              <button
                type="button"
                className="kb-refresh-button"
                onClick={handleRefresh}
                disabled={treeLoading || contentLoading}
              >
                <ReloadOutlined className={`kb-refresh-icon${contentLoading ? " spinning" : ""}`} />
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="doc-viewer-page">
          {contentLoading ? (
            <div className="doc-viewer-state">加载文档中...</div>
          ) : contentError ? (
            <div className="doc-viewer-error">{contentError}</div>
          ) : viewerContent ? (
            <div className="doc-page-body system-docs-doc-body" onClickCapture={handleViewerLinkClickCapture}>
              <RichTextViewer content={viewerContent} />
            </div>
          ) : content ? (
            <div className="doc-viewer-error">文档解析失败，请检查 Markdown 语法。</div>
          ) : (
            <div className="doc-viewer-state">请选择文档</div>
          )}
        </div>
      </>
    </KnowledgeBaseLayout>
  );
}

export default SystemDocsPage;
