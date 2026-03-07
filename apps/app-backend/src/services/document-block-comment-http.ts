import type { ResolvedProjectScope } from "../middleware/project-scope.js";
import { query } from "../db/postgres.js";
import {
  normalizeCommentThreadStatus,
  type CommentThreadStatus,
  type ProjectRole,
} from "./document-block-comment-model.js";

export type CommentListQuery = {
  blockId?: string;
  status?: CommentThreadStatus;
  cursor?: string;
  limit: number;
};

function normalizeString(input: unknown): string {
  return String(input ?? "").trim();
}

function parseLimit(input: unknown, fallback = 50): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

export function parseCommentListQuery(input: Record<string, unknown> | null | undefined): CommentListQuery {
  const source = input && typeof input === "object" ? input : {};
  const blockId = normalizeString(source.blockId);
  const cursor = normalizeString(source.cursor);
  const status = normalizeCommentThreadStatus(source.status);
  const limit = parseLimit(source.limit, 50);
  return {
    blockId: blockId || undefined,
    status: status ?? undefined,
    cursor: cursor || undefined,
    limit,
  };
}

export function parseCommentStatusInput(input: Record<string, unknown> | null | undefined): CommentThreadStatus | null {
  const source = input && typeof input === "object" ? input : {};
  return normalizeCommentThreadStatus(source.status);
}

export function parseCommentContentInput(input: unknown): string {
  return normalizeString(input);
}

type TeamRoleRow = { role: string | null };

export async function resolveCommentActorRole(
  scope: ResolvedProjectScope,
  userId: string,
): Promise<ProjectRole> {
  if (scope.ownerType !== "team") {
    return "owner";
  }
  const normalizedUserId = normalizeString(userId);
  if (!normalizedUserId) {
    return "viewer";
  }
  const result = await query<TeamRoleRow>(
    `SELECT role
       FROM team_member
      WHERE team_id = $1
        AND user_id = $2
      LIMIT 1`,
    [scope.ownerId, normalizedUserId],
  );
  const role = normalizeString(result.rows[0]?.role).toLowerCase();
  return role || "viewer";
}
