export const COMMENT_THREAD_STATUSES = new Set(["open", "resolved"] as const);

export type CommentThreadStatus = "open" | "resolved";

export type ProjectRole = "owner" | "admin" | "member" | "viewer" | string;

function normalizeString(input: unknown): string {
  return String(input ?? "").trim();
}

export function normalizeCommentThreadStatus(input: unknown): CommentThreadStatus | null {
  const value = normalizeString(input);
  if (value === "open" || value === "resolved") {
    return value;
  }
  return null;
}

export function canWriteComment(role: ProjectRole): boolean {
  const normalizedRole = normalizeString(role);
  return normalizedRole === "owner" || normalizedRole === "admin" || normalizedRole === "member";
}

export function canDeleteCommentMessage(input: {
  actorId: string;
  authorId: string;
  role: ProjectRole;
}): boolean {
  const actor = normalizeString(input.actorId);
  const author = normalizeString(input.authorId);
  if (!actor || !author) {
    return false;
  }
  if (actor === author) {
    return true;
  }
  const role = normalizeString(input.role);
  return role === "owner" || role === "admin";
}
