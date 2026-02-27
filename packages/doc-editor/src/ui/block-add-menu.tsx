import type { CSSProperties } from "react";
import type { BuiltinBlockType } from "../extensions/block-add-handle";

export type BuiltinBlockItem = {
  id: BuiltinBlockType;
  label: string;
  hint?: string;
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
  { id: "image", label: "图片上传" },
  { id: "file", label: "文件块" },
  { id: "table", label: "表格" },
];

export function getBuiltinBlockItems(): BuiltinBlockItem[] {
  return BUILTIN_BLOCK_ITEMS.slice();
}

type BlockAddMenuProps = {
  open: boolean;
  onSelect: (type: BuiltinBlockType) => void;
  className?: string;
  style?: CSSProperties;
  highlightedIndex?: number;
  onHighlightIndexChange?: (index: number) => void;
};

export function BlockAddMenu({
  open,
  onSelect,
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

  return (
    <div className={menuClassName} style={style} role="menu" aria-label="插入块">
      {BUILTIN_BLOCK_ITEMS.map((item, index) => (
        <button
          key={`block-add-item-${item.id}`}
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
          <span className="doc-editor-block-add-menu-item-label">{item.label}</span>
          {item.hint ? (
            <span className="doc-editor-block-add-menu-item-hint">{item.hint}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
