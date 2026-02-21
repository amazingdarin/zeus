import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOutlined, FileTextOutlined, LeftOutlined, HomeOutlined, AppstoreOutlined } from "@ant-design/icons";
import type { DocumentSuggestion } from "../api/documents";
import { suggestDocuments } from "../api/documents";
import { loadPptTemplateCatalog, type PptTemplateItem } from "../lib/ppt-template-catalog";

export type MentionItem = {
  kind?: "doc" | "plugin_template";
  docId: string;
  title: string;
  titlePath: string;
  includeChildren: boolean;
  pluginId?: string;
  command?: string;
  templateId?: string;
};

type DisplayItem = {
  id: string;
  title: string;
  titlePath: string;
  hasChildren: boolean;
  includeChildren: boolean;  // true = include children, false = doc only
  kind: "doc" | "plugin_template";
  pluginId?: string;
  command?: string;
  templateId?: string;
  description?: string;
  templateSource?: "preset" | "custom";
};

/** Navigation path item for breadcrumb */
type NavPathItem = {
  id: string;
  title: string;
};

/** Number of items per page */
const PAGE_SIZE = 10;
async function loadPptTemplates(projectKey: string): Promise<PptTemplateItem[]> {
  const { merged } = await loadPptTemplateCatalog(projectKey);
  return merged;
}

type MentionDropdownProps = {
  projectKey: string;
  query: string;
  visible: boolean;
  onSelect: (item: MentionItem) => void;
  onClose: () => void;
  position?: { top: number; left: number };
};

function MentionDropdown({
  projectKey,
  query,
  visible,
  onSelect,
  onClose,
  position,
}: MentionDropdownProps) {
  const [suggestions, setSuggestions] = useState<DocumentSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pptTemplates, setPptTemplates] = useState<PptTemplateItem[]>([]);
  // Navigation path: empty = root level, [parentId...] = children of that parent
  const [navPath, setNavPath] = useState<NavPathItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const normalizedQuery = query.trim();
  const isPptMode = /^ppt(?::|$)/i.test(normalizedQuery);

  // Get current parentId from navigation path
  const currentParentId = useMemo(() => {
    if (navPath.length === 0) return "root";
    return navPath[navPath.length - 1].id;
  }, [navPath]);

  // Reset navigation path when visibility changes
  useEffect(() => {
    if (!visible) {
      setNavPath([]);
      setSuggestions([]);
      setPptTemplates([]);
      setCurrentPage(0);
    }
  }, [visible]);

  // Fetch suggestions on query or navigation change
  useEffect(() => {
    if (!visible || !projectKey) {
      setSuggestions([]);
      setPptTemplates([]);
      return;
    }

    // Clear previous timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Debounce the API call
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        if (isPptMode) {
          const keyword = normalizedQuery.replace(/^ppt:?/i, "").trim().toLowerCase();
          const merged = (await loadPptTemplates(projectKey)).filter((item) => {
            if (!keyword) return true;
            const text = `${item.id} ${item.name} ${item.description || ""}`.toLowerCase();
            return text.includes(keyword);
          });
          setPptTemplates(merged);
          setSuggestions([]);
        } else {
          // Fetch more items to support pagination (up to 50)
          const results = await suggestDocuments(projectKey, query, 50, currentParentId);
          setSuggestions(results);
          setPptTemplates([]);
        }
        setSelectedIndex(0);
        setCurrentPage(0);
      } catch {
        setSuggestions([]);
        setPptTemplates([]);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [projectKey, query, visible, currentParentId, isPptMode, normalizedQuery]);

  // Build display items: for documents with children, show two options
  // Order: directories (hasChildren) first, then documents; each group preserves document order.
  const displayItems = useMemo<DisplayItem[]>(() => {
    if (isPptMode) {
      return pptTemplates.map((item) => ({
        id: `ppt-template:${item.id}`,
        title: item.name,
        titlePath: `@ppt/${item.name}`,
        hasChildren: false,
        includeChildren: false,
        kind: "plugin_template",
        pluginId: "ppt-plugin",
        command: "/ppt-agent",
        templateId: item.id,
        description: item.description,
        templateSource: item.source,
      }));
    }

    const dirs: DocumentSuggestion[] = [];
    const files: DocumentSuggestion[] = [];
    for (const item of suggestions) {
      if (item.hasChildren) {
        dirs.push(item);
      } else {
        files.push(item);
      }
    }

    const items: DisplayItem[] = [];
    for (const item of dirs) {
      // Show two options for directories; directory option first.
      items.push({ ...item, includeChildren: true, kind: "doc" });  // Document + children
      items.push({ ...item, includeChildren: false, kind: "doc" }); // Document only
    }
    for (const item of files) {
      items.push({ ...item, includeChildren: false, kind: "doc" });
    }
    return items;
  }, [suggestions, isPptMode, pptTemplates]);

  // Calculate pagination
  const totalPages = Math.ceil(displayItems.length / PAGE_SIZE);
  const startIndex = currentPage * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, displayItems.length);
  const visibleItems = displayItems.slice(startIndex, endIndex);

  // Reset selected index when suggestions or page change
  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions, currentPage]);

  // Navigate into a document's children
  const navigateInto = useCallback((docId: string, docTitle: string) => {
    setNavPath((prev) => [...prev, { id: docId, title: docTitle }]);
    setSelectedIndex(0);
    setCurrentPage(0);
  }, []);

  // Navigate back one level
  const navigateBack = useCallback(() => {
    setNavPath((prev) => {
      if (prev.length === 0) return prev;
      return prev.slice(0, -1);
    });
    setSelectedIndex(0);
    setCurrentPage(0);
  }, []);

  // Navigate to root level (show only root documents)
  const navigateToRoot = useCallback(() => {
    setNavPath([]);
    setSelectedIndex(0);
    setCurrentPage(0);
  }, []);

  // Page navigation
  const goToNextPage = useCallback(() => {
    setCurrentPage((prev) => {
      const next = prev + 1;
      return next < totalPages ? next : prev;
    });
  }, [totalPages]);

  const goToPrevPage = useCallback(() => {
    setCurrentPage((prev) => {
      return prev > 0 ? prev - 1 : prev;
    });
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => {
            const next = prev + 1;
            if (next >= visibleItems.length) {
              // At bottom of current page, try to go to next page
              if (currentPage < totalPages - 1) {
                setCurrentPage(currentPage + 1);
                return 0;
              }
              return 0; // Wrap to top
            }
            return next;
          });
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => {
            if (prev <= 0) {
              // At top of current page, try to go to previous page
              if (currentPage > 0) {
                setCurrentPage(currentPage - 1);
                return PAGE_SIZE - 1;
              }
              return visibleItems.length - 1; // Wrap to bottom
            }
            return prev - 1;
          });
          break;
        case "PageDown":
          e.preventDefault();
          goToNextPage();
          break;
        case "PageUp":
          e.preventDefault();
          goToPrevPage();
          break;
        case "ArrowRight":
          e.preventDefault();
          // Navigate into the selected document only if "includeChildren" option is selected
          if (visibleItems[selectedIndex]) {
            const item = visibleItems[selectedIndex];
            // Only allow navigation when selecting "含子文档" option (includeChildren = true)
            if (!isPptMode && item.hasChildren && item.includeChildren) {
              navigateInto(item.id, item.title);
            }
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          // Navigate back one level
          if (!isPptMode) {
            navigateBack();
          }
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          if (visibleItems[selectedIndex]) {
            const item = visibleItems[selectedIndex];
            onSelect(item.kind === "plugin_template"
              ? {
                  kind: "plugin_template",
                  docId: item.id,
                  title: item.title,
                  titlePath: item.titlePath,
                  includeChildren: false,
                  pluginId: item.pluginId,
                  command: item.command,
                  templateId: item.templateId,
                }
              : {
                  kind: "doc",
                  docId: item.id,
                  title: item.title,
                  titlePath: item.titlePath,
                  includeChildren: item.includeChildren,
                });
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [visible, visibleItems, selectedIndex, currentPage, totalPages, onSelect, onClose, navigateInto, navigateBack, goToNextPage, goToPrevPage, isPptMode]
  );

  // Add keyboard event listener
  useEffect(() => {
    if (visible) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [visible, handleKeyDown]);

  // Click outside to close (but not when clicking the textarea)
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking the textarea
      if (target.tagName === "TEXTAREA") {
        return;
      }
      if (
        containerRef.current &&
        !containerRef.current.contains(target)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [visible, onClose]);

  if (!visible) return null;

  const handleItemClick = (item: DisplayItem) => {
    onSelect(item.kind === "plugin_template"
      ? {
          kind: "plugin_template",
          docId: item.id,
          title: item.title,
          titlePath: item.titlePath,
          includeChildren: false,
          pluginId: item.pluginId,
          command: item.command,
          templateId: item.templateId,
        }
      : {
          kind: "doc",
          docId: item.id,
          title: item.title,
          titlePath: item.titlePath,
          includeChildren: item.includeChildren,
        });
  };

  // Double-click to navigate into (only for "含子文档" option)
  const handleItemDoubleClick = (item: DisplayItem) => {
    if (!isPptMode && item.hasChildren && item.includeChildren) {
      navigateInto(item.id, item.title);
    }
  };

  // Adjust selected index for keyboard navigation
  const safeSelectedIndex = Math.min(selectedIndex, visibleItems.length - 1);

  return (
    <div
      ref={containerRef}
      className="mention-dropdown"
      style={position ? { top: position.top, left: position.left } : undefined}
    >
      {/* Breadcrumb Navigation */}
      {!isPptMode && navPath.length > 0 && (
        <div className="mention-dropdown-breadcrumb">
          <button
            className="mention-dropdown-breadcrumb-item mention-dropdown-breadcrumb-home"
            onClick={navigateToRoot}
            title="返回根目录"
          >
            <HomeOutlined />
          </button>
          {navPath.map((item, index) => (
            <span key={item.id} className="mention-dropdown-breadcrumb-segment">
              <span className="mention-dropdown-breadcrumb-sep">/</span>
              <button
                className={`mention-dropdown-breadcrumb-item ${
                  index === navPath.length - 1 ? "current" : ""
                }`}
                onClick={() => {
                  // Navigate to this level
                  setNavPath(navPath.slice(0, index + 1));
                  setSelectedIndex(0);
                  setCurrentPage(0);
                }}
              >
                {item.title}
              </button>
            </span>
          ))}
          <button
            className="mention-dropdown-breadcrumb-back"
            onClick={navigateBack}
            title="返回上一级 (←)"
          >
            <LeftOutlined />
          </button>
        </div>
      )}

      {loading && (
        <div className="mention-dropdown-loading">搜索中...</div>
      )}
      {!loading && displayItems.length === 0 && (
        <div className="mention-dropdown-empty">
          {isPptMode
            ? "无匹配 PPT 模版（可输入 @ppt:关键词）"
            : query
              ? "无匹配文档"
              : navPath.length > 0 ? "无子文档" : "暂无文档"}
        </div>
      )}
      {!loading && visibleItems.length > 0 && (
        <ul className="mention-dropdown-list">
          {visibleItems.map((item, index) => (
            <li
              key={`${item.id}-${item.includeChildren ? "dir" : "doc"}`}
              className={`mention-dropdown-item ${
                index === safeSelectedIndex ? "selected" : ""
              }`}
              onClick={() => handleItemClick(item)}
              onDoubleClick={() => handleItemDoubleClick(item)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="mention-dropdown-icon">
                {item.kind === "plugin_template"
                  ? <AppstoreOutlined />
                  : item.includeChildren ? <FolderOutlined /> : <FileTextOutlined />}
              </span>
              <span className="mention-dropdown-title">
                {item.title}
                {item.kind === "doc" && item.includeChildren && "/"}
              </span>
              {item.kind === "plugin_template" && (
                <span className="mention-dropdown-type">
                  {item.templateSource === "custom" ? "自定义模版" : "预设模版"}
                </span>
              )}
              {/* Show path only at root level (breadcrumb already shows context in sub-levels). */}
              {(isPptMode || navPath.length === 0) && item.titlePath !== item.title && (
                <span className="mention-dropdown-path">
                  {item.titlePath}
                  {item.kind === "doc" && item.includeChildren && "/"}
                </span>
              )}
              {item.kind === "doc" && item.hasChildren && (
                <span className="mention-dropdown-type">
                  {item.includeChildren ? "含子文档" : "仅文档"}
                </span>
              )}
              {item.kind === "doc" && item.hasChildren && item.includeChildren && (
                <span className="mention-dropdown-nav-hint" title="按 → 进入子文档">
                  →
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      
      {/* Pagination info */}
      {totalPages > 1 && (
        <div className="mention-dropdown-pagination">
          <button
            className="mention-dropdown-page-btn"
            onClick={goToPrevPage}
            disabled={currentPage === 0}
            title="上一页 (PageUp)"
          >
            ‹
          </button>
          <span className="mention-dropdown-page-info">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            className="mention-dropdown-page-btn"
            onClick={goToNextPage}
            disabled={currentPage >= totalPages - 1}
            title="下一页 (PageDown)"
          >
            ›
          </button>
        </div>
      )}
      
      <div className="mention-dropdown-hint">
        {!isPptMode && <span>输入 @ppt 选模版</span>}
        <span>↑↓ 选择</span>
        {totalPages > 1 && <span>PgUp/PgDn 翻页</span>}
        {!isPptMode && navPath.length > 0 && <span>← 返回</span>}
        {!isPptMode && <span>→ 进入</span>}
        <span>Enter 确认</span>
        <span>Esc 取消</span>
      </div>
    </div>
  );
}

export default MentionDropdown;
