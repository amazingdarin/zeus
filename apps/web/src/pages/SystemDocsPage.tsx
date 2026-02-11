import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DownOutlined,
  FileTextOutlined,
  MenuFoldOutlined,
  ReloadOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { Select, Tooltip } from "antd";

import KnowledgeBaseLayout, { useToggleTree } from "../components/KnowledgeBaseLayout";
import Markdown from "../components/Markdown";
import {
  buildSystemDocAssetUrl,
  fetchSystemDocContent,
  fetchSystemDocsTree,
  type SystemDocTreeItem,
} from "../api/system-docs";

type HrefParts = {
  pathPart: string;
  query: string;
  hash: string;
};

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

function splitHref(rawHref: string): HrefParts {
  let pathPart = rawHref;
  let hash = "";
  let query = "";

  const hashIndex = pathPart.indexOf("#");
  if (hashIndex >= 0) {
    hash = pathPart.slice(hashIndex);
    pathPart = pathPart.slice(0, hashIndex);
  }

  const queryIndex = pathPart.indexOf("?");
  if (queryIndex >= 0) {
    query = pathPart.slice(queryIndex);
    pathPart = pathPart.slice(0, queryIndex);
  }

  return {
    pathPart,
    query,
    hash,
  };
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

type SystemDocsSideNavProps = {
  tree: SystemDocTreeItem[];
  expanded: Record<string, boolean>;
  selectedPath: string;
  activePath: string;
  treeLoading: boolean;
  treeError: string | null;
  onToggleDir: (dirPath: string) => void;
  onSelectFile: (filePath: string) => void;
  onRefresh: () => void;
};

function SystemDocsSideNav({
  tree,
  expanded,
  selectedPath,
  activePath,
  treeLoading,
  treeError,
  onToggleDir,
  onSelectFile,
  onRefresh,
}: SystemDocsSideNavProps) {
  const { toggleTree } = useToggleTree();

  const renderTree = useCallback(
    (items: SystemDocTreeItem[], depth: number) => {
      return (
        <div className="kb-doc-group">
          {items.map((item) => {
            const isDir = item.type === "dir";
            const rowPaddingLeft = `${8 + depth * 14}px`;

            if (isDir) {
              const isExpanded = expanded[item.path] !== false;
              return (
                <div key={item.path} className="kb-doc-node">
                  <div className="kb-doc-row">
                    <div
                      className="kb-doc-control system-docs-doc-control-dir"
                      style={{ paddingLeft: rowPaddingLeft }}
                    >
                      <span className="kb-doc-action">
                        <button
                          type="button"
                          className="kb-doc-toggle"
                          onClick={() => onToggleDir(item.path)}
                          aria-label={isExpanded ? "折叠目录" : "展开目录"}
                        >
                          {isExpanded ? <DownOutlined /> : <RightOutlined />}
                        </button>
                      </span>
                      <button
                        type="button"
                        className="kb-doc-item system-docs-doc-item-dir"
                        onClick={() => onToggleDir(item.path)}
                        title={item.path}
                      >
                        {item.name}
                      </button>
                    </div>
                  </div>
                  {isExpanded && item.children && item.children.length > 0 ? (
                    <div className="kb-doc-children">{renderTree(item.children, depth + 1)}</div>
                  ) : null}
                </div>
              );
            }

            const selected = (activePath || selectedPath) === item.path;
            return (
              <div key={item.path} className="kb-doc-node">
                <div className="kb-doc-row">
                  <div
                    className={`kb-doc-control${selected ? " active" : ""}`}
                    style={{ paddingLeft: rowPaddingLeft }}
                  >
                    <span className="kb-doc-action">
                      <FileTextOutlined className="system-docs-file-icon" />
                    </span>
                    <button
                      type="button"
                      className="kb-doc-item"
                      onClick={() => onSelectFile(item.path)}
                      title={item.path}
                    >
                      {item.name}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
    },
    [activePath, expanded, onSelectFile, onToggleDir, selectedPath],
  );

  return (
    <aside className="kb-sidebar">
      <div className="kb-sidebar-toolbar">
        <div className="system-docs-tree-title">教程说明</div>
        <div className="kb-sidebar-toolbar-spacer" />
        <Tooltip title="刷新目录">
          <button
            className="kb-sidebar-toolbar-btn"
            type="button"
            onClick={onRefresh}
            disabled={treeLoading}
          >
            <ReloadOutlined spin={treeLoading} />
          </button>
        </Tooltip>
        <Tooltip title="隐藏文档树">
          <button
            className="kb-sidebar-toolbar-btn"
            type="button"
            onClick={toggleTree}
          >
            <MenuFoldOutlined />
          </button>
        </Tooltip>
      </div>
      <div className="kb-sidebar-content">
        {treeLoading ? (
          <div className="kb-doc-loading">加载目录中...</div>
        ) : treeError ? (
          <div className="system-docs-tree-error">{treeError}</div>
        ) : tree.length === 0 ? (
          <div className="kb-doc-empty">未发现可浏览的 Markdown 文档</div>
        ) : (
          renderTree(tree, 0)
        )}
      </div>
    </aside>
  );
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

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const contentRequestRef = useRef(0);

  const firstMarkdownPath = useMemo(() => findFirstMarkdownPath(tree), [tree]);
  const currentDocPath = activePath || selectedPath;
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
      setExpanded(expandedMap);
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载系统文档目录失败";
      setTreeError(message);
      setTree([]);
      setExpanded({});
    } finally {
      setTreeLoading(false);
    }
  }, [selectedLanguage]);

  const loadContent = useCallback(async (docPath: string) => {
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
  }, [selectedLanguage]);

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

  const handleToggleDir = useCallback((dirPath: string) => {
    setExpanded((prev) => ({
      ...prev,
      [dirPath]: !prev[dirPath],
    }));
  }, []);

  const handleSelectFile = useCallback(
    (filePath: string) => {
      updatePathQuery(filePath);
    },
    [updatePathQuery],
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

  const resolveHref = useCallback(
    (href: string): string => {
      if (!href || isExternalHref(href) || href.startsWith("#")) {
        return href;
      }
      const parts = splitHref(href);
      const resolvedPath = resolveRelativePath(currentDocPath, parts.pathPart);
      if (!resolvedPath) {
        return href;
      }
      if (isMarkdownPath(resolvedPath)) {
        return `#/system-docs?lang=${encodeURIComponent(selectedLanguage)}&path=${encodeURIComponent(resolvedPath)}`;
      }
      return buildSystemDocAssetUrl(resolvedPath);
    },
    [currentDocPath, selectedLanguage],
  );

  const resolveSrc = useCallback(
    (src: string): string => {
      if (!src || isExternalHref(src) || isInlineAssetHref(src)) {
        return src;
      }
      const parts = splitHref(src);
      const resolvedPath = resolveRelativePath(currentDocPath, parts.pathPart);
      if (!resolvedPath) {
        return src;
      }
      return buildSystemDocAssetUrl(resolvedPath);
    },
    [currentDocPath],
  );

  const onLinkClick = useCallback(
    (href: string, _event: MouseEvent): boolean => {
      if (!href || isExternalHref(href) || href.startsWith("#")) {
        return false;
      }
      const parts = splitHref(href);
      const resolvedPath = resolveRelativePath(currentDocPath, parts.pathPart);
      if (!resolvedPath) {
        return true;
      }

      if (isMarkdownPath(resolvedPath)) {
        updatePathQuery(resolvedPath);
        return true;
      }

      window.open(buildSystemDocAssetUrl(resolvedPath), "_blank", "noopener,noreferrer");
      return true;
    },
    [currentDocPath, updatePathQuery],
  );

  return (
    <KnowledgeBaseLayout
      sideNav={
        <SystemDocsSideNav
          tree={tree}
          expanded={expanded}
          selectedPath={selectedPath}
          activePath={activePath}
          treeLoading={treeLoading}
          treeError={treeError}
          onToggleDir={handleToggleDir}
          onSelectFile={handleSelectFile}
          onRefresh={handleRefresh}
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
          ) : content ? (
            <div className="doc-page-body system-docs-doc-body">
              <Markdown
                content={content}
                className="system-docs-markdown"
                resolveHref={resolveHref}
                resolveSrc={resolveSrc}
                onLinkClick={onLinkClick}
              />
            </div>
          ) : (
            <div className="doc-viewer-state">请选择文档</div>
          )}
        </div>
      </>
    </KnowledgeBaseLayout>
  );
}

export default SystemDocsPage;
