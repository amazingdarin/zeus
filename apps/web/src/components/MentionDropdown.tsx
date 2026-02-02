import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOutlined, FileTextOutlined, LeftOutlined, HomeOutlined } from "@ant-design/icons";
import type { DocumentSuggestion } from "../api/documents";
import { suggestDocuments } from "../api/documents";

export type MentionItem = {
  docId: string;
  title: string;
  titlePath: string;
  includeChildren: boolean;
};

type DisplayItem = {
  id: string;
  title: string;
  titlePath: string;
  hasChildren: boolean;
  includeChildren: boolean;  // true = include children, false = doc only
};

/** Navigation path item for breadcrumb */
type NavPathItem = {
  id: string;
  title: string;
};

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
  const [loading, setLoading] = useState(false);
  // Navigation path: empty = search all, ["root"] = root level, [parentId] = children of parent
  const [navPath, setNavPath] = useState<NavPathItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get current parentId from navigation path
  const currentParentId = useMemo(() => {
    if (navPath.length === 0) return undefined; // Search all documents
    const lastItem = navPath[navPath.length - 1];
    return lastItem.id; // "root" for root level, or doc id
  }, [navPath]);

  // Reset navigation path when visibility changes
  useEffect(() => {
    if (!visible) {
      setNavPath([]);
      setSuggestions([]);
    }
  }, [visible]);

  // Fetch suggestions on query or navigation change
  useEffect(() => {
    if (!visible || !projectKey) {
      setSuggestions([]);
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
        const results = await suggestDocuments(projectKey, query, 15, currentParentId);
        setSuggestions(results);
        setSelectedIndex(0);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [projectKey, query, visible, currentParentId]);

  // Build display items: for documents with children, show two options
  const displayItems = useMemo<DisplayItem[]>(() => {
    const items: DisplayItem[] = [];
    for (const item of suggestions) {
      if (item.hasChildren) {
        // Show two options for folders
        items.push({
          ...item,
          includeChildren: false,  // Document only
        });
        items.push({
          ...item,
          includeChildren: true,   // Document + children
        });
      } else {
        // Single option for files
        items.push({
          ...item,
          includeChildren: false,
        });
      }
    }
    return items;
  }, [suggestions]);

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions]);

  // Navigate into a document's children
  const navigateInto = useCallback((docId: string, docTitle: string) => {
    setNavPath((prev) => [...prev, { id: docId, title: docTitle }]);
    setSelectedIndex(0);
  }, []);

  // Navigate back one level
  const navigateBack = useCallback(() => {
    setNavPath((prev) => {
      if (prev.length === 0) return prev;
      return prev.slice(0, -1);
    });
    setSelectedIndex(0);
  }, []);

  // Navigate to root level (show only root documents)
  const navigateToRoot = useCallback(() => {
    if (navPath.length === 0) {
      // Currently at "search all", go to root level
      setNavPath([{ id: "root", title: "根目录" }]);
    } else {
      setNavPath([]);
    }
    setSelectedIndex(0);
  }, [navPath.length]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < displayItems.length - 1 ? prev + 1 : 0
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : displayItems.length - 1
          );
          break;
        case "ArrowRight":
          e.preventDefault();
          // Navigate into the selected document if it has children
          if (displayItems[selectedIndex]) {
            const item = displayItems[selectedIndex];
            if (item.hasChildren) {
              navigateInto(item.id, item.title);
            }
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          // Navigate back one level
          navigateBack();
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          if (displayItems[selectedIndex]) {
            const item = displayItems[selectedIndex];
            onSelect({
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
    [visible, displayItems, selectedIndex, onSelect, onClose, navigateInto, navigateBack]
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
    onSelect({
      docId: item.id,
      title: item.title,
      titlePath: item.titlePath,
      includeChildren: item.includeChildren,
    });
  };

  // Double-click to navigate into
  const handleItemDoubleClick = (item: DisplayItem) => {
    if (item.hasChildren) {
      navigateInto(item.id, item.title);
    }
  };

  // Adjust selected index for keyboard navigation
  const safeSelectedIndex = Math.min(selectedIndex, displayItems.length - 1);

  return (
    <div
      ref={containerRef}
      className="mention-dropdown"
      style={position ? { top: position.top, left: position.left } : undefined}
    >
      {/* Breadcrumb Navigation */}
      {navPath.length > 0 && (
        <div className="mention-dropdown-breadcrumb">
          <button
            className="mention-dropdown-breadcrumb-item mention-dropdown-breadcrumb-home"
            onClick={navigateToRoot}
            title="返回全局搜索"
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
                }}
              >
                {item.id === "root" ? "根目录" : item.title}
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
      {!loading && suggestions.length === 0 && (
        <div className="mention-dropdown-empty">
          {query ? "无匹配文档" : navPath.length > 0 ? "无子文档" : "输入文档名称搜索"}
        </div>
      )}
      {!loading && displayItems.length > 0 && (
        <ul className="mention-dropdown-list">
          {displayItems.map((item, index) => (
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
                {item.includeChildren ? <FolderOutlined /> : <FileTextOutlined />}
              </span>
              <span className="mention-dropdown-title">
                {item.title}
                {item.includeChildren && "/"}
              </span>
              {/* Show path only when in global search mode */}
              {navPath.length === 0 && item.titlePath !== item.title && (
                <span className="mention-dropdown-path">
                  {item.titlePath}
                  {item.includeChildren && "/"}
                </span>
              )}
              {item.hasChildren && (
                <span className="mention-dropdown-type">
                  {item.includeChildren ? "含子文档" : "仅文档"}
                </span>
              )}
              {item.hasChildren && !item.includeChildren && (
                <span className="mention-dropdown-nav-hint" title="按 → 进入子文档">
                  →
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mention-dropdown-hint">
        <span>↑↓ 选择</span>
        {navPath.length > 0 && <span>← 返回</span>}
        <span>→ 进入</span>
        <span>Tab/Enter 确认</span>
        <span>Esc 取消</span>
      </div>
    </div>
  );
}

export default MentionDropdown;
