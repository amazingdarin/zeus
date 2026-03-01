export type BuiltinBlockType =
  | "paragraph"
  | "heading-1"
  | "collapsible-heading-1"
  | "heading-2"
  | "collapsible-heading-2"
  | "heading-3"
  | "collapsible-heading-3"
  | "toggle-block"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "blockquote"
  | "horizontal-rule"
  | "code-block"
  | "math"
  | "chart"
  | "mindmap"
  | "toc"
  | "link-preview"
  | "image"
  | "file"
  | "table"
  | "columns-2"
  | "columns-3"
  | "columns-4"
  | "columns-5";

export const BUILTIN_BLOCK_TYPES: BuiltinBlockType[] = [
  "paragraph",
  "heading-1",
  "collapsible-heading-1",
  "heading-2",
  "collapsible-heading-2",
  "heading-3",
  "collapsible-heading-3",
  "toggle-block",
  "bullet-list",
  "ordered-list",
  "task-list",
  "blockquote",
  "horizontal-rule",
  "code-block",
  "math",
  "chart",
  "mindmap",
  "toc",
  "link-preview",
  "image",
  "file",
  "table",
  "columns-2",
  "columns-3",
  "columns-4",
  "columns-5",
];

export type HoveredBlockRange = {
  id: string;
  top: number;
  bottom: number;
};

export type BlockDropPlacement = "before" | "after";

export type DropTargetRange = {
  id: string;
  top: number;
  bottom: number;
};

export type NormalizedDropTarget = {
  blockId: string;
  placement: BlockDropPlacement;
  indicatorTop: number;
};

export type FloatingMenuPlacement = {
  left: number;
  top: number;
  horizontal: "right" | "left";
  vertical: "down" | "up";
};

export function resolveFloatingMenuPlacement(input: {
  anchorX: number;
  anchorY: number;
  menuWidth: number;
  menuHeight: number;
  viewportLeft: number;
  viewportTop: number;
  viewportWidth: number;
  viewportHeight: number;
  offsetX?: number;
  offsetY?: number;
  margin?: number;
}): FloatingMenuPlacement {
  const margin = input.margin ?? 8;
  const offsetX = input.offsetX ?? 0;
  const offsetY = input.offsetY ?? 0;
  const viewportRight = input.viewportLeft + Math.max(0, input.viewportWidth);
  const viewportBottom = input.viewportTop + Math.max(0, input.viewportHeight);

  const fitsRight = input.anchorX + offsetX + input.menuWidth <= viewportRight - margin;
  const fitsLeft = input.anchorX - offsetX - input.menuWidth >= input.viewportLeft + margin;
  const horizontal: "right" | "left" = fitsRight || !fitsLeft ? "right" : "left";

  const fitsDown = input.anchorY + offsetY + input.menuHeight <= viewportBottom - margin;
  const fitsUp = input.anchorY - offsetY - input.menuHeight >= input.viewportTop + margin;
  const vertical: "down" | "up" = fitsDown || !fitsUp ? "down" : "up";

  const rawLeft =
    horizontal === "right"
      ? input.anchorX + offsetX
      : input.anchorX - input.menuWidth - offsetX;
  const rawTop =
    vertical === "down"
      ? input.anchorY + offsetY
      : input.anchorY - input.menuHeight - offsetY;

  const minLeft = input.viewportLeft + margin;
  const maxLeft = viewportRight - input.menuWidth - margin;
  const minTop = input.viewportTop + margin;
  const maxTop = viewportBottom - input.menuHeight - margin;

  const left = Math.min(
    Math.max(rawLeft, Math.min(minLeft, maxLeft)),
    Math.max(minLeft, maxLeft)
  );
  const top = Math.min(
    Math.max(rawTop, Math.min(minTop, maxTop)),
    Math.max(minTop, maxTop)
  );

  return {
    left,
    top,
    horizontal,
    vertical,
  };
}

export function isPointerInLeftRail(input: {
  relativeX: number;
  railLeft: number;
  railButtonSize: number;
  railGap: number;
  railButtonCount?: number;
  railPadding?: number;
}): boolean {
  const buttonCount = input.railButtonCount ?? 2;
  const padding = input.railPadding ?? 6;
  const railWidth =
    input.railButtonSize * buttonCount + input.railGap * Math.max(0, buttonCount - 1);
  const minX = Math.max(0, input.railLeft - padding);
  const maxX = input.railLeft + railWidth + padding;
  return input.relativeX >= minX && input.relativeX <= maxX;
}

export function shouldHideControlsOnPointerExit(input: {
  dragging: boolean;
  menuOpen: boolean;
  movingIntoControls: boolean;
}): boolean {
  if (input.dragging || input.menuOpen || input.movingIntoControls) {
    return false;
  }
  return true;
}

export function resolveHandleAnchorBlockId(input: {
  draggingBlockId: string | null;
  hoveredBlockId: string | null;
  selectionBlockId: string | null;
  controlsVisible: boolean;
}): string | null {
  if (input.draggingBlockId) {
    return input.draggingBlockId;
  }
  if (input.controlsVisible && input.hoveredBlockId) {
    return input.hoveredBlockId;
  }
  return input.selectionBlockId;
}

export function resolveNormalizedDropTarget(
  ranges: DropTargetRange[],
  clientY: number
): NormalizedDropTarget | null {
  const validRanges = ranges.filter((range) => range.bottom > range.top);
  if (validRanges.length === 0) {
    return null;
  }

  for (let i = 0; i < validRanges.length; i += 1) {
    const current = validRanges[i];
    const middle = (current.top + current.bottom) / 2;
    if (clientY <= middle) {
      return {
        blockId: current.id,
        placement: "before",
        indicatorTop: current.top,
      };
    }
    if (clientY < current.bottom) {
      const next = validRanges[i + 1];
      if (next) {
        return {
          blockId: next.id,
          placement: "before",
          indicatorTop: next.top,
        };
      }
      return {
        blockId: current.id,
        placement: "after",
        indicatorTop: current.bottom,
      };
    }
  }

  const last = validRanges[validRanges.length - 1];
  return {
    blockId: last.id,
    placement: "after",
    indicatorTop: last.bottom,
  };
}

export function moveMenuHighlightIndex(input: {
  current: number;
  total: number;
  direction: "up" | "down";
}): number {
  if (input.total <= 0) {
    return 0;
  }
  const safeCurrent = ((input.current % input.total) + input.total) % input.total;
  if (input.direction === "down") {
    return (safeCurrent + 1) % input.total;
  }
  return (safeCurrent - 1 + input.total) % input.total;
}

export function resolveHoveredBlockId(
  ranges: HoveredBlockRange[],
  clientY: number
): string | null {
  if (ranges.length === 0) {
    return null;
  }

  for (const range of ranges) {
    if (range.bottom <= range.top) {
      continue;
    }
    const middle = (range.top + range.bottom) / 2;
    if (clientY <= middle || clientY < range.bottom) {
      return range.id;
    }
  }

  return ranges[ranges.length - 1]?.id ?? null;
}

export function isDesktopHandleEnabled(input: {
  isMobile: boolean;
  mode: "edit" | "view";
}): boolean {
  return !input.isMobile && input.mode === "edit";
}

export function isBlockActionMenuShortcut(input: {
  key: string;
  code?: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}): boolean {
  if (input.ctrlKey) {
    return false;
  }
  const isSlashKey = input.code === "Slash" || input.key === "/";
  if (!isSlashKey) {
    return false;
  }
  return input.metaKey || input.altKey;
}
