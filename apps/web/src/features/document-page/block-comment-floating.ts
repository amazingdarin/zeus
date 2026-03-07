export type BlockCommentAnchorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type BlockCommentThreadLike = {
  id?: string;
  blockId?: string;
};

type ResolvePopoverPositionInput = {
  anchor: BlockCommentAnchorRect | null;
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  margin?: number;
  topInset?: number;
  anchorYOffset?: number;
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function normalizePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function buildBlockCommentCountByBlockId(
  threads: BlockCommentThreadLike[],
): Record<string, number> {
  const mapByBlock = new Map<string, Set<string>>();

  for (const item of threads ?? []) {
    const blockId = String(item?.blockId ?? "").trim();
    const threadId = String(item?.id ?? "").trim();
    if (!blockId || !threadId) {
      continue;
    }
    const current = mapByBlock.get(blockId) ?? new Set<string>();
    current.add(threadId);
    mapByBlock.set(blockId, current);
  }

  const result: Record<string, number> = {};
  for (const [blockId, threadIds] of mapByBlock.entries()) {
    const count = threadIds.size;
    if (count > 0) {
      result[blockId] = count;
    }
  }
  return result;
}

export function resolveBlockCommentPopoverPosition(
  input: ResolvePopoverPositionInput,
): { left: number; top: number } {
  const margin = normalizePositive(input.margin ?? 12, 12);
  const topInset = Math.max(0, input.topInset ?? 64);
  const anchorYOffset = input.anchorYOffset ?? 18;

  const viewportWidth = Math.max(0, input.viewport.width);
  const viewportHeight = Math.max(0, input.viewport.height);
  const panelWidth = normalizePositive(input.panel.width, 360);
  const panelHeight = normalizePositive(input.panel.height, 320);

  const maxLeft = Math.max(margin, viewportWidth - panelWidth - margin);
  const maxTop = Math.max(Math.max(margin, topInset), viewportHeight - panelHeight - margin);

  const targetX = input.anchor
    ? input.anchor.left + input.anchor.width / 2
    : viewportWidth / 2;
  const targetY = input.anchor
    ? input.anchor.top + input.anchor.height / 2 + anchorYOffset
    : viewportHeight / 2;

  const left = clamp(targetX - panelWidth / 2, margin, maxLeft);
  const top = clamp(targetY - panelHeight / 2, Math.max(margin, topInset), maxTop);

  return {
    left: Math.round(left),
    top: Math.round(top),
  };
}

