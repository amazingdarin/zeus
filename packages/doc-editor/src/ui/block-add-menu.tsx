import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { BuiltinBlockType } from "../extensions/block-add-handle";

export type BuiltinBlockItem = {
  id: BuiltinBlockType;
  label: string;
  hint?: string;
  shortcut?: string;
};

const BUILTIN_BLOCK_ITEMS: BuiltinBlockItem[] = [
  { id: "paragraph", label: "段落" },
  { id: "heading-1", label: "标题 1" },
  { id: "heading-2", label: "标题 2" },
  { id: "heading-3", label: "标题 3" },
  { id: "toggle-block", label: "折叠块", hint: "标题前带展开/缩小按钮" },
  { id: "bullet-list", label: "无序列表" },
  { id: "ordered-list", label: "有序列表" },
  { id: "task-list", label: "任务列表" },
  { id: "blockquote", label: "引用" },
  { id: "horizontal-rule", label: "分割线" },
  { id: "code-block", label: "代码块" },
  { id: "image", label: "图片" },
  { id: "file", label: "文件" },
  { id: "table", label: "表格" },
];

const MEDIA_BLOCK_IDS = new Set<BuiltinBlockType>(["image", "file"]);

type BuiltinBlockMenuSectionId = "basic" | "media";

export type BuiltinBlockMenuSection = {
  id: BuiltinBlockMenuSectionId;
  label: string;
  items: Array<{ index: number; item: BuiltinBlockItem }>;
};

export function groupBuiltinBlockItems(
  items: BuiltinBlockItem[]
): BuiltinBlockMenuSection[] {
  const basicItems: Array<{ index: number; item: BuiltinBlockItem }> = [];
  const mediaItems: Array<{ index: number; item: BuiltinBlockItem }> = [];

  items.forEach((item, index) => {
    if (MEDIA_BLOCK_IDS.has(item.id)) {
      mediaItems.push({ index, item });
      return;
    }
    basicItems.push({ index, item });
  });

  const sections: BuiltinBlockMenuSection[] = [];
  if (basicItems.length > 0) {
    sections.push({
      id: "basic",
      label: "基础块",
      items: basicItems,
    });
  }
  if (mediaItems.length > 0) {
    sections.push({
      id: "media",
      label: "媒体",
      items: mediaItems,
    });
  }
  return sections;
}

export function getBuiltinBlockItems(
  shortcuts?: Partial<Record<BuiltinBlockType, string>>
): BuiltinBlockItem[] {
  if (!shortcuts) {
    return BUILTIN_BLOCK_ITEMS.slice();
  }
  return BUILTIN_BLOCK_ITEMS.map((item) => ({
    ...item,
    shortcut: shortcuts[item.id],
  }));
}

type BlockAddMenuProps = {
  open: boolean;
  onSelect: (type: BuiltinBlockType) => void;
  items?: BuiltinBlockItem[];
  className?: string;
  style?: CSSProperties;
  highlightedIndex?: number;
  onHighlightIndexChange?: (index: number) => void;
};

export function BlockAddMenu({
  open,
  onSelect,
  items,
  className,
  style,
  highlightedIndex,
  onHighlightIndexChange,
}: BlockAddMenuProps) {
  if (!open) {
    return null;
  }

  const menuClassName = className
    ? `doc-editor-block-add-menu ${className}`
    : "doc-editor-block-add-menu";
  const renderItems = items ?? BUILTIN_BLOCK_ITEMS;
  const sections = groupBuiltinBlockItems(renderItems);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (typeof highlightedIndex !== "number" || highlightedIndex < 0) {
      return;
    }
    const container = menuRef.current;
    const target = itemRefs.current[highlightedIndex];
    if (!container || !target) {
      return;
    }
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    const targetTop = target.offsetTop;
    const targetBottom = targetTop + target.offsetHeight;

    if (targetTop < viewTop) {
      container.scrollTop = targetTop;
      return;
    }
    if (targetBottom > viewBottom) {
      container.scrollTop = targetBottom - container.clientHeight;
    }
  }, [highlightedIndex, renderItems.length]);

  const renderMenuItem = (item: BuiltinBlockItem, index: number) => (
    <button
      key={`block-add-item-${item.id}`}
      ref={(node) => {
        itemRefs.current[index] = node;
      }}
      className={
        highlightedIndex === index
          ? "doc-editor-block-add-menu-item active"
          : "doc-editor-block-add-menu-item"
      }
      type="button"
      role="menuitem"
      aria-selected={highlightedIndex === index}
      onClick={() => onSelect(item.id)}
      onMouseEnter={() => onHighlightIndexChange?.(index)}
    >
      <span className="doc-editor-block-add-menu-item-main">
        <span className="doc-editor-block-add-menu-item-label">{item.label}</span>
        {item.shortcut ? (
          <span className="doc-editor-block-add-menu-item-shortcut">{item.shortcut}</span>
        ) : null}
      </span>
      {item.hint ? (
        <span className="doc-editor-block-add-menu-item-hint">{item.hint}</span>
      ) : null}
    </button>
  );

  return (
    <div
      ref={menuRef}
      className={menuClassName}
      style={style}
      role="menu"
      aria-label="插入块"
    >
      {sections.map((section) => (
        <div
          key={`block-add-section-${section.id}`}
          className="doc-editor-block-add-menu-section"
          role="group"
          aria-label={section.label}
        >
          <div className="doc-editor-block-add-menu-section-title">{section.label}</div>
          {section.items.map(({ item, index }) => renderMenuItem(item, index))}
        </div>
      ))}
    </div>
  );
}
