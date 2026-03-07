import { v4 as uuidv4 } from "uuid";

import { query } from "../db/postgres.js";
import { resolveProjectScope } from "../project-scope.js";

export type MessageTaskStatus = "pending" | "running" | "completed" | "failed" | string;

export type MessageProgress = {
  current: number;
  total: number;
  percent: number;
  message?: string;
  phase?: string;
};

export type MessageItem = {
  id: string;
  type: string;
  title: string;
  status: MessageTaskStatus;
  progress: MessageProgress;
  detail: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
};

export type MessageCenterListResult = {
  active: MessageItem[];
  history: MessageItem[];
  nextCursor?: string;
};

type MessageTaskRow = {
  id: string;
  user_id: string;
  owner_type: string;
  owner_id: string;
  project_key: string;
  type: string;
  title: string;
  status: string;
  progress_current: number | null;
  progress_total: number | null;
  progress_percent: number | null;
  detail_json: unknown;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
};

const ACTIVE_STATUSES = new Set(["pending", "running"]);
const CURSOR_SEPARATOR = "::";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_TIMEOUT_ERROR_MESSAGE = "任务超时（1小时）";
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_SWEEP_INTERVAL_MS = 60 * 1000;
const DEFAULT_TIMEOUT_SWEEP_BATCH_SIZE = 200;

export type MessageCenterListener = (item: MessageItem) => void;

class MessageCenterBus {
  private listeners = new Map<string, Set<MessageCenterListener>>();

  subscribe(scopeKey: string, listener: MessageCenterListener): () => void {
    const existing = this.listeners.get(scopeKey);
    if (existing) {
      existing.add(listener);
    } else {
      this.listeners.set(scopeKey, new Set([listener]));
    }

    return () => {
      const set = this.listeners.get(scopeKey);
      if (!set) {
        return;
      }
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(scopeKey);
      }
    };
  }

  publish(scopeKey: string, item: MessageItem): void {
    const set = this.listeners.get(scopeKey);
    if (!set || set.size === 0) {
      return;
    }
    for (const listener of set) {
      try {
        listener(item);
      } catch (err) {
        console.warn("[message-center] listener error", err);
      }
    }
  }
}

export const messageCenterBus = new MessageCenterBus();

type MessageScope = {
  scopeKey: string;
  ownerType: string;
  ownerId: string;
  projectKey: string;
};

function resolveMessageScope(userId: string, projectKey: string): MessageScope {
  const scope = resolveProjectScope(userId, projectKey);
  const scopeKey = buildScopeKey(userId, scope.ownerType, scope.ownerId, scope.projectKey);
  return {
    scopeKey,
    ownerType: scope.ownerType,
    ownerId: scope.ownerId,
    projectKey: scope.projectKey,
  };
}

function buildScopeKey(userId: string, ownerType: string, ownerId: string, projectKey: string): string {
  return `${userId}${CURSOR_SEPARATOR}${ownerType}${CURSOR_SEPARATOR}${ownerId}${CURSOR_SEPARATOR}${projectKey}`;
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function normalizeDetail(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function mapRowToItem(row: MessageTaskRow): MessageItem {
  const detail = normalizeDetail(row.detail_json);
  const progressDetail = detail.progress && typeof detail.progress === "object"
    ? (detail.progress as Record<string, unknown>)
    : {};
  const message = typeof progressDetail.message === "string" ? progressDetail.message : undefined;
  const phase = typeof progressDetail.phase === "string" ? progressDetail.phase : undefined;

  const progress: MessageProgress = {
    current: typeof row.progress_current === "number" ? row.progress_current : 0,
    total: typeof row.progress_total === "number" ? row.progress_total : 0,
    percent: typeof row.progress_percent === "number" ? row.progress_percent : 0,
    message,
    phase,
  };

  const detailWithError = row.error_message
    ? { ...detail, error: row.error_message }
    : detail;

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    status: row.status,
    progress,
    detail: detailWithError,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    finishedAt: row.finished_at ? toIso(row.finished_at) : undefined,
  };
}

function encodeCursor(row: MessageTaskRow): string {
  return `${toIso(row.updated_at)}${CURSOR_SEPARATOR}${row.id}`;
}

function parseCursor(cursor: string | undefined): { updatedAt: string; id: string } | null {
  if (!cursor) return null;
  const trimmed = cursor.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(CURSOR_SEPARATOR);
  if (parts.length < 2) return null;
  const id = parts.pop();
  if (!id) return null;
  const updatedAt = parts.join(CURSOR_SEPARATOR);
  if (!updatedAt) return null;
  return { updatedAt, id };
}

export type CreateMessageTaskInput = {
  userId: string;
  projectKey: string;
  type: string;
  title: string;
  status?: MessageTaskStatus;
  progress?: Partial<MessageProgress>;
  detail?: Record<string, unknown>;
};

export type UpdateMessageProgressInput = {
  current?: number;
  total?: number;
  percent?: number;
  message?: string;
  phase?: string;
  status?: MessageTaskStatus;
};

export type CompleteMessageTaskInput = {
  result?: Record<string, unknown>;
};

export type FailTimedOutTasksOptions = {
  timeoutMs?: number;
  batchSize?: number;
  errorMessage?: string;
};

function toPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

export const messageCenterStore = {
  async createTask(input: CreateMessageTaskInput): Promise<MessageItem> {
    const scope = resolveMessageScope(input.userId, input.projectKey);
    const id = uuidv4();
    const status = input.status ?? "pending";
    const progress = input.progress ?? {};
    const detail = input.detail ?? {};

    const result = await query<MessageTaskRow>(
      `INSERT INTO message_center_tasks
        (id, user_id, owner_type, owner_id, project_key, type, title, status, progress_current, progress_total, progress_percent, detail_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        id,
        input.userId,
        scope.ownerType,
        scope.ownerId,
        scope.projectKey,
        input.type,
        input.title,
        status,
        typeof progress.current === "number" ? progress.current : 0,
        typeof progress.total === "number" ? progress.total : 0,
        typeof progress.percent === "number" ? progress.percent : 0,
        detail,
      ],
    );

    const row = result.rows[0];
    const item = mapRowToItem(row);
    messageCenterBus.publish(scope.scopeKey, item);
    return item;
  },

  async updateTaskProgress(
    userId: string,
    projectKey: string,
    taskId: string,
    input: UpdateMessageProgressInput,
  ): Promise<MessageItem | null> {
    const scope = resolveMessageScope(userId, projectKey);

    const progressDetail: Record<string, unknown> = {};
    if (input.message) {
      progressDetail.message = input.message;
    }
    if (input.phase) {
      progressDetail.phase = input.phase;
    }

    const detailPatch = Object.keys(progressDetail).length > 0
      ? { progress: progressDetail }
      : {};

    const status = input.status ? input.status : undefined;
    const progressCurrent = typeof input.current === "number" ? input.current : null;
    const progressTotal = typeof input.total === "number" ? input.total : null;
    const progressPercent = typeof input.percent === "number" ? input.percent : null;

    const result = await query<MessageTaskRow>(
      `UPDATE message_center_tasks
          SET status = COALESCE($6, status),
              progress_current = COALESCE($1, progress_current),
              progress_total = COALESCE($2, progress_total),
              progress_percent = COALESCE($3, progress_percent),
              detail_json = COALESCE(detail_json, '{}'::jsonb) || $4::jsonb,
              updated_at = now()
        WHERE id = $5
          AND user_id = $7
          AND owner_type = $8
          AND owner_id = $9
          AND project_key = $10
          AND status IN ('pending', 'running')
        RETURNING *`,
      [
        progressCurrent,
        progressTotal,
        progressPercent,
        detailPatch,
        taskId,
        status ?? null,
        userId,
        scope.ownerType,
        scope.ownerId,
        scope.projectKey,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const item = mapRowToItem(row);
    messageCenterBus.publish(scope.scopeKey, item);
    return item;
  },

  async completeTask(
    userId: string,
    projectKey: string,
    taskId: string,
    input: CompleteMessageTaskInput,
  ): Promise<MessageItem | null> {
    const scope = resolveMessageScope(userId, projectKey);
    const detailPatch = input.result ? { result: input.result } : {};

    const result = await query<MessageTaskRow>(
      `UPDATE message_center_tasks
          SET status = 'completed',
              detail_json = COALESCE(detail_json, '{}'::jsonb) || $1::jsonb,
              finished_at = now(),
              updated_at = now()
        WHERE id = $2
          AND user_id = $3
          AND owner_type = $4
          AND owner_id = $5
          AND project_key = $6
          AND status IN ('pending', 'running')
        RETURNING *`,
      [
        detailPatch,
        taskId,
        userId,
        scope.ownerType,
        scope.ownerId,
        scope.projectKey,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const item = mapRowToItem(row);
    messageCenterBus.publish(scope.scopeKey, item);
    return item;
  },

  async failTask(
    userId: string,
    projectKey: string,
    taskId: string,
    errorMessage: string,
  ): Promise<MessageItem | null> {
    const scope = resolveMessageScope(userId, projectKey);
    const detailPatch = errorMessage ? { error: errorMessage } : {};

    const result = await query<MessageTaskRow>(
      `UPDATE message_center_tasks
          SET status = 'failed',
              error_message = $1,
              detail_json = COALESCE(detail_json, '{}'::jsonb) || $2::jsonb,
              finished_at = now(),
              updated_at = now()
        WHERE id = $3
          AND user_id = $4
          AND owner_type = $5
          AND owner_id = $6
          AND project_key = $7
          AND status IN ('pending', 'running')
        RETURNING *`,
      [
        errorMessage,
        detailPatch,
        taskId,
        userId,
        scope.ownerType,
        scope.ownerId,
        scope.projectKey,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const item = mapRowToItem(row);
    messageCenterBus.publish(scope.scopeKey, item);
    return item;
  },

  async listTasks(
    userId: string,
    projectKey: string,
    options: { limit?: number; cursor?: string; type?: string } = {},
  ): Promise<MessageCenterListResult> {
    const scope = resolveMessageScope(userId, projectKey);
    const limit = Math.min(
      Math.max(1, Number(options.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
      MAX_LIMIT,
    );
    const taskType = String(options.type ?? "").trim();

    const activeParams: Array<string | number> = [
      userId,
      scope.ownerType,
      scope.ownerId,
      scope.projectKey,
    ];
    let activeTypeClause = "";
    if (taskType) {
      activeParams.push(taskType);
      activeTypeClause = `AND type = $${activeParams.length}`;
    }

    const activeResult = await query<MessageTaskRow>(
      `SELECT *
         FROM message_center_tasks
        WHERE user_id = $1
          AND owner_type = $2
          AND owner_id = $3
          AND project_key = $4
          ${activeTypeClause}
          AND status IN ('pending', 'running')
        ORDER BY updated_at DESC, id DESC`,
      activeParams,
    );

    const cursor = parseCursor(options.cursor);
    const historyParams: Array<string | number> = [
      userId,
      scope.ownerType,
      scope.ownerId,
      scope.projectKey,
    ];
    let typeClause = "";
    if (taskType) {
      historyParams.push(taskType);
      typeClause = `AND type = $${historyParams.length}`;
    }
    let cursorClause = "";
    if (cursor) {
      const updatedAtIndex = historyParams.push(cursor.updatedAt);
      const idIndex = historyParams.push(cursor.id);
      cursorClause = `
          AND (updated_at < $${updatedAtIndex} OR (updated_at = $${updatedAtIndex} AND id < $${idIndex}))
      `;
    }
    historyParams.push(limit);

    const historyResult = await query<MessageTaskRow>(
      `SELECT *
         FROM message_center_tasks
        WHERE user_id = $1
          AND owner_type = $2
          AND owner_id = $3
          AND project_key = $4
          ${typeClause}
          AND status NOT IN ('pending', 'running')
          ${cursorClause}
        ORDER BY updated_at DESC, id DESC
        LIMIT $${historyParams.length}`,
      historyParams,
    );

    const active = activeResult.rows.map(mapRowToItem);
    const history = historyResult.rows.map(mapRowToItem);

    const nextCursor = historyResult.rows.length === limit
      ? encodeCursor(historyResult.rows[historyResult.rows.length - 1])
      : undefined;

    return {
      active,
      history,
      nextCursor,
    };
  },

  isActiveStatus(status: string): boolean {
    return ACTIVE_STATUSES.has(status);
  },

  async failTimedOutTasks(options: FailTimedOutTasksOptions = {}): Promise<{ failed: number; tasks: MessageItem[] }> {
    const timeoutMs = toPositiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    const batchSize = toPositiveNumber(options.batchSize, DEFAULT_TIMEOUT_SWEEP_BATCH_SIZE);
    const errorMessage = (options.errorMessage || "").trim() || DEFAULT_TIMEOUT_ERROR_MESSAGE;
    const detailPatch = {
      error: errorMessage,
      timeout: {
        thresholdMs: timeoutMs,
        triggeredBy: "message-center-monitor",
      },
    };

    const result = await query<MessageTaskRow>(
      `WITH expired AS (
          SELECT id
            FROM message_center_tasks
           WHERE status IN ('pending', 'running')
             AND updated_at <= now() - ($1 * interval '1 millisecond')
           ORDER BY updated_at ASC, id ASC
           LIMIT $2
        )
        UPDATE message_center_tasks AS t
           SET status = 'failed',
               error_message = $3,
               detail_json = COALESCE(t.detail_json, '{}'::jsonb) || $4::jsonb,
               finished_at = now(),
               updated_at = now()
          FROM expired
         WHERE t.id = expired.id
         RETURNING t.*`,
      [timeoutMs, batchSize, errorMessage, detailPatch],
    );

    if (result.rows.length === 0) {
      return { failed: 0, tasks: [] };
    }

    const items = result.rows.map(mapRowToItem);
    for (let i = 0; i < result.rows.length; i += 1) {
      const row = result.rows[i];
      const item = items[i];
      const scopeKey = buildScopeKey(row.user_id, row.owner_type, row.owner_id, row.project_key);
      messageCenterBus.publish(scopeKey, item);
    }

    return { failed: items.length, tasks: items };
  },
};

export type MessageCenterTimeoutMonitorOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  batchSize?: number;
  errorMessage?: string;
};

export const startMessageCenterTimeoutMonitor = (
  options: MessageCenterTimeoutMonitorOptions = {},
): (() => void) => {
  const timeoutMs = toPositiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const intervalMs = toPositiveNumber(options.intervalMs, DEFAULT_TIMEOUT_SWEEP_INTERVAL_MS);
  const batchSize = toPositiveNumber(options.batchSize, DEFAULT_TIMEOUT_SWEEP_BATCH_SIZE);
  const errorMessage = (options.errorMessage || "").trim() || DEFAULT_TIMEOUT_ERROR_MESSAGE;

  let stopped = false;
  let running = false;
  const sweep = async () => {
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      const result = await messageCenterStore.failTimedOutTasks({
        timeoutMs,
        batchSize,
        errorMessage,
      });
      if (result.failed > 0) {
        console.warn(
          `[message-center] marked ${result.failed} timed out task(s) as failed, timeoutMs=${timeoutMs}`,
        );
      }
    } catch (err) {
      console.warn("[message-center] timeout sweep failed", err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void sweep();
  }, intervalMs);
  timer.unref?.();
  void sweep();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
};
