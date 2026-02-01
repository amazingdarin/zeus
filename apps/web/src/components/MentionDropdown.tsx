import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOutlined, FileTextOutlined } from "@ant-design/icons";
import type { DocumentSuggestion } from "../api/documents";
import { suggestDocuments } from "../api/documents";

export type MentionItem = {
  docId: string;
  title: string;
  titlePath: string;
  includeChildren: boolean;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch suggestions on query change
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
        const results = await suggestDocuments(projectKey, query, 10);
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
  }, [projectKey, query, visible]);

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          if (suggestions[selectedIndex]) {
            const item = suggestions[selectedIndex];
            // Check if query ends with /
            const includeChildren = query.endsWith("/") || item.hasChildren;
            onSelect({
              docId: item.id,
              title: item.title,
              titlePath: item.titlePath,
              includeChildren,
            });
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [visible, suggestions, selectedIndex, query, onSelect, onClose]
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

  const handleItemClick = (item: DocumentSuggestion) => {
    onSelect({
      docId: item.id,
      title: item.title,
      titlePath: item.titlePath,
      includeChildren: query.endsWith("/") || item.hasChildren,
    });
  };

  return (
    <div
      ref={containerRef}
      className="mention-dropdown"
      style={position ? { top: position.top, left: position.left } : undefined}
    >
      {loading && (
        <div className="mention-dropdown-loading">搜索中...</div>
      )}
      {!loading && suggestions.length === 0 && (
        <div className="mention-dropdown-empty">
          {query ? "无匹配文档" : "输入文档名称搜索"}
        </div>
      )}
      {!loading && suggestions.length > 0 && (
        <ul className="mention-dropdown-list">
          {suggestions.map((item, index) => (
            <li
              key={item.id}
              className={`mention-dropdown-item ${
                index === selectedIndex ? "selected" : ""
              }`}
              onClick={() => handleItemClick(item)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="mention-dropdown-icon">
                {item.hasChildren ? <FolderOutlined /> : <FileTextOutlined />}
              </span>
              <span className="mention-dropdown-title">{item.title}</span>
              {item.titlePath !== item.title && (
                <span className="mention-dropdown-path">{item.titlePath}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mention-dropdown-hint">
        <span>↑↓ 选择</span>
        <span>Tab/Enter 确认</span>
        <span>Esc 取消</span>
      </div>
    </div>
  );
}

export default MentionDropdown;
