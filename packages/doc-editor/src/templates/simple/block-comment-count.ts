export function resolveBlockCommentCount(
  blockId: string,
  commentCountByBlockId?: Record<string, number>
): number {
  const id = String(blockId ?? "").trim()
  if (!id) {
    return 0
  }
  const count = Number(commentCountByBlockId?.[id] ?? 0)
  if (!Number.isFinite(count) || count <= 0) {
    return 0
  }
  return Math.floor(count)
}
