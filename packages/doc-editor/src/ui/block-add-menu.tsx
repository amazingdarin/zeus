import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { BuiltinBlockType } from "../extensions/block-add-handle";
import { HeadingOneIcon } from "../icons/heading-one-icon";
import { HeadingTwoIcon } from "../icons/heading-two-icon";
import { HeadingThreeIcon } from "../icons/heading-three-icon";
import { ChevronDownIcon } from "../icons/chevron-down-icon";
import { ListIcon } from "../icons/list-icon";
import { ListOrderedIcon } from "../icons/list-ordered-icon";
import { ListTodoIcon } from "../icons/list-todo-icon";
import { BlockquoteIcon } from "../icons/blockquote-icon";
import { HorizontalRuleIcon } from "../icons/horizontal-rule-icon";
import { CodeBlockIcon } from "../icons/code-block-icon";
import { MathIcon } from "../icons/math-icon";
import { TocIcon } from "../icons/toc-icon";
import { LinkIcon } from "../icons/link-icon";
import { ImagePlusIcon } from "../icons/image-plus-icon";
import { FileIcon } from "../icons/file-icon";
import { TableIcon } from "../icons/table-icon";

export type BuiltinBlockItem = {
  kind: "builtin";
  id: BuiltinBlockType;
  label: string;
  icon: ReactNode;
  hint?: string;
  shortcut?: string;
};

export type PluginBlockItem = {
  kind: "plugin";
  id: string;
  pluginId: string;
  pluginTitle: string;
  blockId: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  shortcut?: string;
};

export type BlockMenuItem = BuiltinBlockItem | PluginBlockItem;

export type PluginBlockMenuGroup = {
  pluginId: string;
  pluginTitle: string;
  blocks: Array<{
    id: string;
    title: string;
    icon?: ReactNode;
    hint?: string;
  }>;
};

function ChartBlockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path
        d="M4 20V11m8 9V7m8 13V4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MindmapBlockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="5" cy="7" r="1.5" fill="currentColor" />
      <circle cx="19" cy="7" r="1.5" fill="currentColor" />
      <circle cx="5" cy="17" r="1.5" fill="currentColor" />
      <circle cx="19" cy="17" r="1.5" fill="currentColor" />
      <path
        d="M9.8 10.5 6.5 8.2m7.7 2.3 3.3-2.3m-7.7 5 3.3 2.3m1.1-2.3 3.3 2.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ColumnsBlockIcon({ count }: { count: number }) {
  const safeCount = Math.max(2, Math.min(5, count));
  const width = 16;
  const height = 16;
  const gutter = 1;
  const cellWidth = (width - gutter * (safeCount - 1)) / safeCount;
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden>
      {Array.from({ length: safeCount }, (_, index) => {
        const x = index * (cellWidth + gutter);
        return (
          <rect
            key={`columns-icon-${safeCount}-${index}`}
            x={x}
            y={2}
            width={cellWidth}
            height={12}
            rx={1}
            stroke="currentColor"
            strokeWidth="1.2"
          />
        );
      })}
    </svg>
  );
}

const BUILTIN_BLOCK_ITEMS: BuiltinBlockItem[] = [
  {
    kind: "builtin",
    id: "paragraph",
    label: "段落",
    icon: <span className="doc-editor-block-add-menu-item-icon-text">P</span>,
    hint: "普通正文文本块，可用于自由输入内容",
  },
  {
    kind: "builtin",
    id: "heading-1",
    label: "标题 1",
    icon: <HeadingOneIcon />,
    hint: "一级标题，用于章节主层级",
  },
  {
    kind: "builtin",
    id: "collapsible-heading-1",
    label: "可折叠标题 1",
    icon: <HeadingOneIcon />,
    hint: "折叠到下一个一级标题",
  },
  {
    kind: "builtin",
    id: "heading-2",
    label: "标题 2",
    icon: <HeadingTwoIcon />,
    hint: "二级标题，用于子章节层级",
  },
  {
    kind: "builtin",
    id: "collapsible-heading-2",
    label: "可折叠标题 2",
    icon: <HeadingTwoIcon />,
    hint: "折叠到下一个二级标题",
  },
  {
    kind: "builtin",
    id: "heading-3",
    label: "标题 3",
    icon: <HeadingThreeIcon />,
    hint: "三级标题，用于更细粒度分组",
  },
  {
    kind: "builtin",
    id: "collapsible-heading-3",
    label: "可折叠标题 3",
    icon: <HeadingThreeIcon />,
    hint: "折叠到下一个三级标题",
  },
  {
    kind: "builtin",
    id: "toggle-block",
    label: "折叠块",
    icon: <ChevronDownIcon />,
    hint: "标题前带展开/缩小按钮",
  },
  {
    kind: "builtin",
    id: "bullet-list",
    label: "无序列表",
    icon: <ListIcon />,
    hint: "适合并列要点，不区分先后顺序",
  },
  {
    kind: "builtin",
    id: "ordered-list",
    label: "有序列表",
    icon: <ListOrderedIcon />,
    hint: "自动编号列表，适合步骤说明",
  },
  {
    kind: "builtin",
    id: "task-list",
    label: "任务列表",
    icon: <ListTodoIcon />,
    hint: "可勾选的任务项，适合待办追踪",
  },
  {
    kind: "builtin",
    id: "blockquote",
    label: "引用",
    icon: <BlockquoteIcon />,
    hint: "突出引用内容或说明文字",
  },
  {
    kind: "builtin",
    id: "horizontal-rule",
    label: "分割线",
    icon: <HorizontalRuleIcon />,
    hint: "在上下内容之间插入分隔线",
  },
  {
    kind: "builtin",
    id: "code-block",
    label: "代码块",
    icon: <CodeBlockIcon />,
    hint: "插入多行代码，保留代码格式",
  },
  {
    kind: "builtin",
    id: "math",
    label: "数学公式",
    icon: <MathIcon />,
    hint: "使用 LaTeX 输入数学表达式",
  },
  {
    kind: "builtin",
    id: "chart",
    label: "图表",
    icon: <ChartBlockIcon />,
    hint: "插入可视化图表展示数据",
  },
  {
    kind: "builtin",
    id: "mindmap",
    label: "脑图",
    icon: <MindmapBlockIcon />,
    hint: "用节点关系快速梳理思路",
  },
  {
    kind: "builtin",
    id: "toc",
    label: "目录",
    icon: <TocIcon />,
    hint: "根据标题自动生成文档目录",
  },
  {
    kind: "builtin",
    id: "link-preview",
    label: "链接预览",
    icon: <LinkIcon />,
    hint: "粘贴链接并显示可视化预览卡片",
  },
  {
    kind: "builtin",
    id: "image",
    label: "图片",
    icon: <ImagePlusIcon />,
    hint: "上传或粘贴图片到文档",
  },
  {
    kind: "builtin",
    id: "file",
    label: "文件",
    icon: <FileIcon />,
    hint: "上传附件并在文档中引用",
  },
  {
    kind: "builtin",
    id: "table",
    label: "表格",
    icon: <TableIcon />,
    hint: "插入行列表格展示结构化数据",
  },
  {
    kind: "builtin",
    id: "columns-2",
    label: "2列",
    icon: <ColumnsBlockIcon count={2} />,
    hint: "双列布局，适合并排展示内容",
  },
  {
    kind: "builtin",
    id: "columns-3",
    label: "3列",
    icon: <ColumnsBlockIcon count={3} />,
    hint: "三列布局，适合信息对照展示",
  },
  {
    kind: "builtin",
    id: "columns-4",
    label: "4列",
    icon: <ColumnsBlockIcon count={4} />,
    hint: "四列布局，适合卡片型排版",
  },
  {
    kind: "builtin",
    id: "columns-5",
    label: "5列",
    icon: <ColumnsBlockIcon count={5} />,
    hint: "五列布局，适合高密度信息展示",
  },
];

const MEDIA_BLOCK_IDS = new Set<BuiltinBlockType>(["image", "file"]);

type BuiltinBlockMenuSectionId = "basic" | "media";

export type BuiltinBlockMenuSection = {
  id: BuiltinBlockMenuSectionId;
  label: string;
  items: Array<{ index: number; item: BuiltinBlockItem }>;
};

export type BlockMenuSection = {
  id: string;
  label: string;
  items: Array<{ index: number; item: BlockMenuItem }>;
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

export function groupBlockMenuItems(items: BlockMenuItem[]): BlockMenuSection[] {
  const basicItems: Array<{ index: number; item: BuiltinBlockItem }> = [];
  const mediaItems: Array<{ index: number; item: BuiltinBlockItem }> = [];

  const pluginSectionMap = new Map<
    string,
    { id: string; label: string; items: Array<{ index: number; item: PluginBlockItem }> }
  >();

  items.forEach((item, index) => {
    if (item.kind === "builtin") {
      if (MEDIA_BLOCK_IDS.has(item.id)) {
        mediaItems.push({ index, item });
      } else {
        basicItems.push({ index, item });
      }
      return;
    }
    if (item.kind !== "plugin") {
      return;
    }
    const sectionId = `plugin:${item.pluginId}`;
    const sectionLabel = item.pluginTitle || item.pluginId;
    const section = pluginSectionMap.get(sectionId) ?? {
      id: sectionId,
      label: sectionLabel,
      items: [],
    };
    section.items.push({ index, item });
    pluginSectionMap.set(sectionId, section);
  });

  const sections: BlockMenuSection[] = [];
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
  sections.push(...Array.from(pluginSectionMap.values()));
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

const DEFAULT_PLUGIN_BLOCK_ICON = (
  <span className="doc-editor-block-add-menu-item-icon-text">P</span>
);

const DEFAULT_PLUGIN_BLOCK_HINT = (pluginTitle: string) =>
  `来自插件「${pluginTitle}」的功能块`;

export function resolveBlockMenuItemHint(item: BlockMenuItem): string {
  const normalized = String(item.hint ?? "").trim();
  if (normalized) {
    return normalized;
  }
  if (item.kind === "plugin") {
    return DEFAULT_PLUGIN_BLOCK_HINT(item.pluginTitle || item.pluginId);
  }
  return "";
}

export function getPluginBlockItems(groups: PluginBlockMenuGroup[]): PluginBlockItem[] {
  return groups.flatMap((group) => {
    const pluginId = String(group.pluginId || "").trim();
    const pluginTitle = String(group.pluginTitle || pluginId).trim() || pluginId;
    if (!pluginId) {
      return [];
    }
    return group.blocks.map((block) => {
      const blockId = String(block.id || "").trim();
      const label = String(block.title || blockId).trim() || "插件块";
      const uniqueId = `${pluginId}:${blockId || label}`;
      return {
        kind: "plugin",
        id: uniqueId,
        pluginId,
        pluginTitle,
        blockId: blockId || uniqueId,
        label,
        icon: block.icon ?? DEFAULT_PLUGIN_BLOCK_ICON,
        hint: String(block.hint ?? "").trim() || DEFAULT_PLUGIN_BLOCK_HINT(pluginTitle),
      } satisfies PluginBlockItem;
    });
  });
}

type BlockAddMenuProps = {
  open: boolean;
  onSelect: (item: BlockMenuItem) => void;
  items?: BlockMenuItem[];
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
  const sections = groupBlockMenuItems(renderItems);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [hintBubble, setHintBubble] = useState<{
    text: string;
    top: number;
    left: number;
    placement: "left" | "right";
  } | null>(null);

  const updateHintBubble = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (
      typeof highlightedIndex !== "number"
      || highlightedIndex < 0
      || highlightedIndex >= renderItems.length
    ) {
      setHintBubble(null);
      return;
    }
    const target = itemRefs.current[highlightedIndex];
    const item = renderItems[highlightedIndex];
    if (!target || !item) {
      setHintBubble(null);
      return;
    }

    const hintText = resolveBlockMenuItemHint(item);
    if (!hintText) {
      setHintBubble(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    const bubbleWidth = 220;
    const gap = 10;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const canPlaceRight = rect.right + gap + bubbleWidth <= viewportWidth - 8;
    const canPlaceLeft = rect.left - gap - bubbleWidth >= 8;
    const placement: "left" | "right" = canPlaceRight || !canPlaceLeft ? "right" : "left";

    let left = placement === "right"
      ? rect.right + gap
      : rect.left - bubbleWidth - gap;
    left = Math.max(8, Math.min(left, viewportWidth - bubbleWidth - 8));

    let top = rect.top + rect.height / 2;
    top = Math.max(20, Math.min(top, viewportHeight - 20));

    setHintBubble({
      text: hintText,
      top,
      left,
      placement,
    });
  }, [highlightedIndex, renderItems]);

  useEffect(() => {
    if (typeof highlightedIndex !== "number" || highlightedIndex < 0) {
      setHintBubble(null);
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
    const rafId = window.requestAnimationFrame(() => {
      updateHintBubble();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [highlightedIndex, renderItems.length, updateHintBubble]);

  useEffect(() => {
    updateHintBubble();
    const container = menuRef.current;
    const handleLayout = () => updateHintBubble();
    window.addEventListener("resize", handleLayout);
    window.addEventListener("scroll", handleLayout, true);
    container?.addEventListener("scroll", handleLayout, { passive: true });
    return () => {
      window.removeEventListener("resize", handleLayout);
      window.removeEventListener("scroll", handleLayout, true);
      container?.removeEventListener("scroll", handleLayout);
    };
  }, [updateHintBubble]);

  const renderMenuItem = (item: BlockMenuItem, index: number) => (
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
      onClick={() => onSelect(item)}
      onMouseEnter={() => onHighlightIndexChange?.(index)}
    >
      <span className="doc-editor-block-add-menu-item-main">
        <span className="doc-editor-block-add-menu-item-title">
          <span className="doc-editor-block-add-menu-item-icon" aria-hidden>
            {item.icon}
          </span>
          <span className="doc-editor-block-add-menu-item-label">{item.label}</span>
        </span>
        {item.shortcut ? (
          <span className="doc-editor-block-add-menu-item-shortcut">{item.shortcut}</span>
        ) : null}
      </span>
    </button>
  );

  return (
    <>
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
      {hintBubble ? (
        <div
          className={`doc-editor-block-add-menu-hint-bubble ${hintBubble.placement}`}
          role="note"
          style={{
            top: `${Math.round(hintBubble.top)}px`,
            left: `${Math.round(hintBubble.left)}px`,
          }}
        >
          {hintBubble.text}
        </div>
      ) : null}
    </>
  );
}
