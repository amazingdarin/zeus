import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import semver from "semver";

import { compareParsedMigrationIds, parseMigrationId } from "./migration-id.js";
import { resolveSchemaVersionForTrack, resolveTracksForTarget } from "./release-matrix.js";
import type { ReleaseMatrix } from "./types.js";

export type PlannedMigration = {
  track: string;
  migrationId: string;
  schemaVersion: string;
  migrationPath: string;
};

export type MigrationTrackPlan = {
  track: string;
  targetSchemaVersion: string;
  migrations: PlannedMigration[];
};

export type MigrationPlan = {
  mode: "up" | "down";
  target: string;
  appVersion: string;
  tracks: MigrationTrackPlan[];
};

export type PlanOptions = {
  matrix: ReleaseMatrix;
  migrationsRoot: string;
  target: string;
  appVersion: string;
  track?: string;
  appliedMigrationIdsByTrack?: Record<string, string[]>;
};

async function listTrackMigrations(
  migrationsRoot: string,
  track: string,
): Promise<Array<{ migrationId: string; schemaVersion: string; migrationPath: string }>> {
  const trackDir = path.join(migrationsRoot, track);
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(trackDir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const migrations = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const parsed = parseMigrationId(entry.name);
      return {
        migrationId: parsed.id,
        schemaVersion: parsed.schemaVersion,
        migrationPath: path.join(trackDir, entry.name),
        parsed,
      };
    })
    .sort((left, right) => compareParsedMigrationIds(left.parsed, right.parsed))
    .map(({ migrationId, schemaVersion, migrationPath }) => ({
      migrationId,
      schemaVersion,
      migrationPath,
    }));

  return migrations;
}

function resolveTracks(options: PlanOptions): string[] {
  const tracks = resolveTracksForTarget(options.matrix, options.target);
  if (!options.track) {
    return tracks;
  }
  if (!tracks.includes(options.track)) {
    throw new Error(`Track ${options.track} is not part of target ${options.target}`);
  }
  return [options.track];
}

function getAppliedSet(
  appliedMigrationIdsByTrack: Record<string, string[]> | undefined,
  track: string,
): Set<string> {
  return new Set(appliedMigrationIdsByTrack?.[track] ?? []);
}

export async function planUpgrade(options: PlanOptions): Promise<MigrationPlan> {
  const tracks = resolveTracks(options);
  const trackPlans: MigrationTrackPlan[] = [];

  for (const track of tracks) {
    const targetSchemaVersion = resolveSchemaVersionForTrack(options.matrix, options.appVersion, track);
    const applied = getAppliedSet(options.appliedMigrationIdsByTrack, track);
    const discovered = await listTrackMigrations(options.migrationsRoot, track);
    const migrations = discovered
      .filter((migration) => semver.lte(migration.schemaVersion, targetSchemaVersion))
      .filter((migration) => !applied.has(migration.migrationId))
      .map((migration) => ({
        track,
        migrationId: migration.migrationId,
        schemaVersion: migration.schemaVersion,
        migrationPath: migration.migrationPath,
      }));

    trackPlans.push({
      track,
      targetSchemaVersion,
      migrations,
    });
  }

  return {
    mode: "up",
    target: options.target,
    appVersion: options.appVersion,
    tracks: trackPlans,
  };
}

export async function planRollback(options: PlanOptions): Promise<MigrationPlan> {
  const tracks = resolveTracks(options);
  const trackPlans: MigrationTrackPlan[] = [];

  for (const track of tracks) {
    const targetSchemaVersion = resolveSchemaVersionForTrack(options.matrix, options.appVersion, track);
    const applied = getAppliedSet(options.appliedMigrationIdsByTrack, track);
    const discovered = await listTrackMigrations(options.migrationsRoot, track);
    const migrations = discovered
      .filter((migration) => semver.gt(migration.schemaVersion, targetSchemaVersion))
      .filter((migration) => applied.has(migration.migrationId))
      .reverse()
      .map((migration) => ({
        track,
        migrationId: migration.migrationId,
        schemaVersion: migration.schemaVersion,
        migrationPath: migration.migrationPath,
      }));

    trackPlans.push({
      track,
      targetSchemaVersion,
      migrations,
    });
  }

  return {
    mode: "down",
    target: options.target,
    appVersion: options.appVersion,
    tracks: trackPlans,
  };
}
