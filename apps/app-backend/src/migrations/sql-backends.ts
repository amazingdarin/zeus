import { query } from "../db/postgres.js";
import type {
  MigrationBackend,
  MigrationHistoryStartInput,
  MigrationStateBackend,
} from "./apply.js";

type SqliteStatement = {
  run: (...args: unknown[]) => { lastInsertRowid?: number | bigint };
  all: (...args: unknown[]) => unknown[];
  get: (...args: unknown[]) => unknown;
};

type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
};

const POSTGRES_HISTORY_DDL = `
CREATE TABLE IF NOT EXISTS zeus_migration_history (
  id BIGSERIAL PRIMARY KEY,
  track TEXT NOT NULL,
  migration_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  app_version TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  checksum_up TEXT,
  checksum_down TEXT,
  operator TEXT NOT NULL DEFAULT 'system',
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zeus_migration_history_track_id_direction_success
ON zeus_migration_history (track, migration_id, direction)
WHERE status = 'success';

CREATE TABLE IF NOT EXISTS zeus_migration_lock (
  track TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const SQLITE_HISTORY_DDL = `
CREATE TABLE IF NOT EXISTS zeus_migration_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track TEXT NOT NULL,
  migration_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  app_version TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  checksum_up TEXT,
  checksum_down TEXT,
  operator TEXT NOT NULL DEFAULT 'system',
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zeus_migration_history_track_id_direction_success
ON zeus_migration_history (track, migration_id, direction)
WHERE status = 'success';

CREATE TABLE IF NOT EXISTS zeus_migration_lock (
  track TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
);
`;

function nowIso(): string {
  return new Date().toISOString();
}

export class PostgresMigrationBackend implements MigrationBackend {
  readonly kind = "postgres";

  async ensureStateTables(): Promise<void> {
    await query(POSTGRES_HISTORY_DDL);
  }

  async listAppliedMigrations(track: string): Promise<string[]> {
    const result = await query<{ migration_id: string; direction: "up" | "down" }>(
      `SELECT migration_id, direction
       FROM zeus_migration_history
       WHERE track = $1 AND status = 'success'
       ORDER BY id ASC`,
      [track],
    );
    const applied = new Set<string>();
    for (const row of result.rows) {
      if (row.direction === "up") {
        applied.add(row.migration_id);
      } else {
        applied.delete(row.migration_id);
      }
    }
    return [...applied];
  }

  async acquireLock(track: string, holder: string): Promise<void> {
    const result = await query<{ track: string }>(
      `INSERT INTO zeus_migration_lock (track, holder, acquired_at, heartbeat_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT DO NOTHING
       RETURNING track`,
      [track, holder],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Migration lock already held for track ${track}`);
    }
  }

  async releaseLock(track: string, _holder: string): Promise<void> {
    await query(`DELETE FROM zeus_migration_lock WHERE track = $1`, [track]);
  }

  async insertHistoryRunning(args: MigrationHistoryStartInput): Promise<number> {
    const result = await query<{ id: number }>(
      `INSERT INTO zeus_migration_history (
         track, migration_id, schema_version, app_version,
         direction, status, checksum_up, checksum_down, operator, started_at
       ) VALUES ($1, $2, $3, $4, $5, 'running', $6, $7, $8, NOW())
       RETURNING id`,
      [
        args.track,
        args.migrationId,
        args.schemaVersion,
        args.appVersion,
        args.direction,
        args.checksumUp ?? null,
        args.checksumDown ?? null,
        args.operator,
      ],
    );
    return result.rows[0]?.id ?? 0;
  }

  async updateHistoryResult(
    id: number | string,
    status: "success" | "failed",
    errorMessage?: string,
  ): Promise<void> {
    await query(
      `UPDATE zeus_migration_history
       SET status = $1, error_message = $2, finished_at = NOW()
       WHERE id = $3`,
      [status, errorMessage ?? null, id],
    );
  }

  async executeOperation(
    _track: string,
    _migrationId: string,
    _direction: "up" | "down",
    sql: string,
  ): Promise<void> {
    await query(sql);
  }
}

export class SqliteMigrationBackend implements MigrationBackend {
  readonly kind = "sqlite";

  private readonly db: SqliteDatabase;

  private constructor(db: SqliteDatabase) {
    this.db = db;
  }

  static async create(filePath: string): Promise<SqliteMigrationBackend> {
    const sqliteModule = (await import("node:sqlite")) as {
      DatabaseSync: new (file: string) => SqliteDatabase;
    };
    const db = new sqliteModule.DatabaseSync(filePath);
    return new SqliteMigrationBackend(db);
  }

  async ensureStateTables(): Promise<void> {
    this.db.exec(SQLITE_HISTORY_DDL);
  }

  async listAppliedMigrations(track: string): Promise<string[]> {
    const rows = this.db
      .prepare(
        `SELECT migration_id, direction
         FROM zeus_migration_history
         WHERE track = ? AND status = 'success'
         ORDER BY id ASC`,
      )
      .all(track) as Array<{ migration_id: string; direction: "up" | "down" }>;
    const applied = new Set<string>();
    for (const row of rows) {
      if (row.direction === "up") {
        applied.add(row.migration_id);
      } else {
        applied.delete(row.migration_id);
      }
    }
    return [...applied];
  }

  async acquireLock(track: string, holder: string): Promise<void> {
    try {
      this.db
        .prepare(
          `INSERT INTO zeus_migration_lock (track, holder, acquired_at, heartbeat_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(track, holder, nowIso(), nowIso());
    } catch {
      throw new Error(`Migration lock already held for track ${track}`);
    }
  }

  async releaseLock(track: string, _holder: string): Promise<void> {
    this.db.prepare(`DELETE FROM zeus_migration_lock WHERE track = ?`).run(track);
  }

  async insertHistoryRunning(args: MigrationHistoryStartInput): Promise<number> {
    const result = this.db
      .prepare(
        `INSERT INTO zeus_migration_history (
           track, migration_id, schema_version, app_version,
           direction, status, checksum_up, checksum_down, operator, started_at
         ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
      )
      .run(
        args.track,
        args.migrationId,
        args.schemaVersion,
        args.appVersion,
        args.direction,
        args.checksumUp ?? null,
        args.checksumDown ?? null,
        args.operator,
        nowIso(),
      );
    return Number(result.lastInsertRowid ?? 0);
  }

  async updateHistoryResult(
    id: number | string,
    status: "success" | "failed",
    errorMessage?: string,
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE zeus_migration_history
         SET status = ?, error_message = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(status, errorMessage ?? null, nowIso(), id);
  }

  async executeOperation(
    _track: string,
    _migrationId: string,
    _direction: "up" | "down",
    sql: string,
  ): Promise<void> {
    this.db.exec(sql);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

type HttpOperationRequest = {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  body?: unknown;
  expectStatus?: number | number[];
};

type HttpMigrationOperation = {
  requests: HttpOperationRequest[];
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function buildUrl(baseUrl: string, requestPath: string, query?: Record<string, string | number | boolean>): string {
  const prefixed = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${prefixed}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function parseHttpMigrationOperation(content: string): HttpMigrationOperation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Invalid HTTP migration payload: not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid HTTP migration payload: root must be object");
  }
  const requests = (parsed as { requests?: unknown }).requests;
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error("Invalid HTTP migration payload: requests must be a non-empty array");
  }
  for (const request of requests) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new Error("Invalid HTTP migration payload: request must be object");
    }
    const method = (request as { method?: unknown }).method;
    const requestPath = (request as { path?: unknown }).path;
    if (typeof method !== "string" || method.length === 0) {
      throw new Error("Invalid HTTP migration payload: request.method must be a non-empty string");
    }
    if (typeof requestPath !== "string" || requestPath.length === 0) {
      throw new Error("Invalid HTTP migration payload: request.path must be a non-empty string");
    }
  }
  return parsed as HttpMigrationOperation;
}

type HttpMigrationBackendConfig = {
  kind: "qdrant" | "meili";
  baseUrl: string;
  apiKey?: string;
  stateBackend: MigrationStateBackend;
};

class HttpMigrationBackend implements MigrationBackend {
  readonly kind: "qdrant" | "meili";
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly stateBackend: MigrationStateBackend;

  constructor(config: HttpMigrationBackendConfig) {
    this.kind = config.kind;
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    this.stateBackend = config.stateBackend;
  }

  async ensureStateTables(): Promise<void> {
    await this.stateBackend.ensureStateTables();
  }

  async listAppliedMigrations(track: string): Promise<string[]> {
    return this.stateBackend.listAppliedMigrations(track);
  }

  async acquireLock(track: string, holder: string): Promise<void> {
    await this.stateBackend.acquireLock(track, holder);
  }

  async releaseLock(track: string, holder: string): Promise<void> {
    await this.stateBackend.releaseLock(track, holder);
  }

  async insertHistoryRunning(args: MigrationHistoryStartInput): Promise<string | number> {
    return this.stateBackend.insertHistoryRunning(args);
  }

  async updateHistoryResult(
    id: string | number,
    status: "success" | "failed",
    errorMessage?: string,
  ): Promise<void> {
    await this.stateBackend.updateHistoryResult(id, status, errorMessage);
  }

  async executeOperation(
    _track: string,
    _migrationId: string,
    _direction: "up" | "down",
    content: string,
  ): Promise<void> {
    const operation = parseHttpMigrationOperation(content);
    for (const req of operation.requests) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(req.headers ?? {}),
      };
      if (this.apiKey) {
        if (this.kind === "qdrant") {
          headers["api-key"] = this.apiKey;
        } else if (this.kind === "meili") {
          headers.Authorization = `Bearer ${this.apiKey}`;
        }
      }

      const response = await fetch(buildUrl(this.baseUrl, req.path, req.query), {
        method: req.method.toUpperCase(),
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      });

      const expected = req.expectStatus;
      const ok = Array.isArray(expected)
        ? expected.includes(response.status)
        : typeof expected === "number"
          ? response.status === expected
          : response.ok;
      if (!ok) {
        const body = await response.text();
        throw new Error(
          `${this.kind} migration request failed: ${req.method.toUpperCase()} ${req.path} -> ${response.status}; ${body.slice(0, 500)}`,
        );
      }
    }
  }

  async close(): Promise<void> {
    // state backend lifecycle is managed by CLI backend context
  }
}

export function createQdrantMigrationBackend(config: {
  baseUrl: string;
  apiKey?: string;
  stateBackend: MigrationStateBackend;
}): MigrationBackend {
  return new HttpMigrationBackend({
    kind: "qdrant",
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    stateBackend: config.stateBackend,
  });
}

export function createMeiliMigrationBackend(config: {
  baseUrl: string;
  apiKey?: string;
  stateBackend: MigrationStateBackend;
}): MigrationBackend {
  return new HttpMigrationBackend({
    kind: "meili",
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    stateBackend: config.stateBackend,
  });
}
