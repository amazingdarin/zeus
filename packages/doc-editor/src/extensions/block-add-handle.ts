export type BuiltinBlockType =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "toggle-block"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "blockquote"
  | "horizontal-rule"
  | "code-block"
  | "image"
  | "file"
  | "table";

export const BUILTIN_BLOCK_TYPES: BuiltinBlockType[] = [
  "paragraph",
  "heading-1",
  "heading-2",
  "heading-3",
  "toggle-block",
  "bullet-list",
  "ordered-list",
  "task-list",
  "blockquote",
  "horizontal-rule",
  "code-block",
  "image",
  "file",
  "table",
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
