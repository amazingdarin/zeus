import type { DocumentLockInfo } from "../storage/types.js";

type LockableMeta = {
  extra?: Record<string, unknown>;
};

function parseDocumentLockInfo(raw: unknown): DocumentLockInfo | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const maybe = raw as Record<string, unknown>;
  if (maybe.locked !== true) {
    return null;
  }
  const lockedBy = typeof maybe.lockedBy === "string" ? maybe.lockedBy.trim() : "";
  const lockedAt = typeof maybe.lockedAt === "string" ? maybe.lockedAt.trim() : "";
  if (!lockedBy || !lockedAt) {
    return null;
  }
  return {
    locked: true,
    lockedBy,
    lockedAt,
  };
}

export class DocumentLockedError extends Error {
  readonly status = 423;
  readonly code = "DOCUMENT_LOCKED";
  readonly lock: DocumentLockInfo;

  constructor(lock: DocumentLockInfo) {
    super("Document is locked");
    this.name = "DocumentLockedError";
    this.lock = lock;
  }
}

export function getDocumentLockInfo(meta: LockableMeta): DocumentLockInfo | null {
  const extra = meta.extra && typeof meta.extra === "object" ? meta.extra : undefined;
  const raw = extra?.lock;
  return parseDocumentLockInfo(raw);
}

export function applyDocumentLock(
  meta: LockableMeta,
  userId: string,
  nowIso = new Date().toISOString(),
): DocumentLockInfo {
  const lock: DocumentLockInfo = {
    locked: true,
    lockedBy: String(userId || "").trim(),
    lockedAt: String(nowIso || "").trim() || new Date().toISOString(),
  };
  const nextExtra = meta.extra && typeof meta.extra === "object"
    ? { ...meta.extra }
    : {};
  nextExtra.lock = lock;
  meta.extra = nextExtra;
  return lock;
}

export function clearDocumentLock(meta: LockableMeta): void {
  const extra = meta.extra && typeof meta.extra === "object" ? { ...meta.extra } : null;
  if (!extra || !("lock" in extra)) {
    return;
  }
  delete extra.lock;
  meta.extra = extra;
}

export function assertDocumentUnlocked(meta: LockableMeta): void {
  const lock = getDocumentLockInfo(meta);
  if (lock?.locked) {
    throw new DocumentLockedError(lock);
  }
}
