import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { MigrationPlan } from "./planner.js";

export type MigrationHistoryStartInput = {
  track: string;
  migrationId: string;
  schemaVersion: string;
  appVersion: string;
  direction: "up" | "down";
  operator: string;
  checksumUp?: string;
  checksumDown?: string;
};

export type MigrationStateBackend = {
  ensureStateTables(): Promise<void>;
  listAppliedMigrations(track: string): Promise<string[]>;
  acquireLock(track: string, holder: string): Promise<void>;
  releaseLock(track: string, holder: string): Promise<void>;
  insertHistoryRunning(args: MigrationHistoryStartInput): Promise<number | string>;
  updateHistoryResult(
    id: number | string,
    status: "success" | "failed",
    errorMessage?: string,
  ): Promise<void>;
  close?(): Promise<void>;
};

export type MigrationBackendKind = "postgres" | "sqlite" | "qdrant" | "meili";

export type MigrationBackend = MigrationStateBackend & {
  kind: MigrationBackendKind;
  executeOperation(
    track: string,
    migrationId: string,
    direction: "up" | "down",
    content: string,
  ): Promise<void>;
};

export type ApplyTrackResult = {
  track: string;
  status: "success" | "failed" | "skipped";
  appliedMigrationIds: string[];
  message?: string;
};

export type ApplyResult = {
  mode: "up" | "down";
  target: string;
  appVersion: string;
  tracks: ApplyTrackResult[];
};

export type ApplyMigrationPlanOptions = {
  plan: MigrationPlan;
  operator: string;
  holder?: string;
  dryRun?: boolean;
  backendResolver: (track: string) => MigrationBackend | undefined;
};

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function readRequiredMigrationOperation(filePath: string): Promise<string> {
  const content = await tryReadFile(filePath);
  if (content == null) {
    throw new Error(`Migration operation file not found: ${filePath}`);
  }
  return content;
}

async function buildChecksums(migrationPath: string): Promise<{ checksumUp?: string; checksumDown?: string }> {
  const upSql = await tryReadFile(path.join(migrationPath, "up.sql"));
  const downSql = await tryReadFile(path.join(migrationPath, "down.sql"));
  if (upSql != null || downSql != null) {
    return {
      checksumUp: upSql == null ? undefined : sha256Hex(upSql),
      checksumDown: downSql == null ? undefined : sha256Hex(downSql),
    };
  }
  const upHttp = await tryReadFile(path.join(migrationPath, "up.http.json"));
  const downHttp = await tryReadFile(path.join(migrationPath, "down.http.json"));
  return {
    checksumUp: upHttp == null ? undefined : sha256Hex(upHttp),
    checksumDown: downHttp == null ? undefined : sha256Hex(downHttp),
  };
}

function operationFileName(kind: MigrationBackendKind, direction: "up" | "down"): string {
  if (kind === "qdrant" || kind === "meili") {
    return `${direction}.http.json`;
  }
  return `${direction}.sql`;
}

export async function collectAppliedMigrationsByTrack(
  tracks: string[],
  backendResolver: (track: string) => MigrationBackend | undefined,
): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {};

  for (const track of tracks) {
    const backend = backendResolver(track);
    if (!backend) {
      continue;
    }
    await backend.ensureStateTables();
    map[track] = await backend.listAppliedMigrations(track);
  }

  return map;
}

export async function applyMigrationPlan(options: ApplyMigrationPlanOptions): Promise<ApplyResult> {
  const holder = options.holder ?? `pid:${process.pid}`;
  const direction = options.plan.mode;
  const results: ApplyTrackResult[] = [];

  for (const trackPlan of options.plan.tracks) {
    const backend = options.backendResolver(trackPlan.track);
    if (!backend) {
      results.push({
        track: trackPlan.track,
        status: "skipped",
        appliedMigrationIds: [],
        message: "No backend configured for track",
      });
      continue;
    }

    const appliedMigrationIds: string[] = [];
    let trackStatus: ApplyTrackResult["status"] = "success";
    let trackMessage: string | undefined;

    await backend.ensureStateTables();
    await backend.acquireLock(trackPlan.track, holder);
    try {
      for (const migration of trackPlan.migrations) {
        const opPath = path.join(
          migration.migrationPath,
          operationFileName(backend.kind, direction),
        );
        let operationContent: string;
        let checksums: { checksumUp?: string; checksumDown?: string } = {};
        try {
          operationContent = await readRequiredMigrationOperation(opPath);
          checksums = await buildChecksums(migration.migrationPath);
        } catch (err) {
          trackStatus = "failed";
          trackMessage = err instanceof Error ? err.message : String(err);
          break;
        }

        if (options.dryRun) {
          appliedMigrationIds.push(migration.migrationId);
          continue;
        }

        const historyId = await backend.insertHistoryRunning({
          track: trackPlan.track,
          migrationId: migration.migrationId,
          schemaVersion: migration.schemaVersion,
          appVersion: options.plan.appVersion,
          direction,
          operator: options.operator,
          checksumUp: checksums.checksumUp,
          checksumDown: checksums.checksumDown,
        });

        try {
          await backend.executeOperation(
            trackPlan.track,
            migration.migrationId,
            direction,
            operationContent,
          );
          await backend.updateHistoryResult(historyId, "success");
          appliedMigrationIds.push(migration.migrationId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await backend.updateHistoryResult(historyId, "failed", message);
          trackStatus = "failed";
          trackMessage = message;
          break;
        }
      }
    } finally {
      await backend.releaseLock(trackPlan.track, holder);
    }

    results.push({
      track: trackPlan.track,
      status: trackStatus,
      appliedMigrationIds,
      message: trackMessage,
    });
  }

  return {
    mode: options.plan.mode,
    target: options.plan.target,
    appVersion: options.plan.appVersion,
    tracks: results,
  };
}
