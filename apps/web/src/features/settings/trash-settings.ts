export function normalizeTrashAutoCleanupDays(value: unknown, fallback = 30): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  if (rounded < 1) {
    return 1;
  }
  if (rounded > 3650) {
    return 3650;
  }
  return rounded;
}
