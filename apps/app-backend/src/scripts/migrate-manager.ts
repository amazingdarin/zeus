import fs from "node:fs";
import fsPromises from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import semver from "semver";

import {
  applyMigrationPlan,
  collectAppliedMigrationsByTrack,
  type MigrationBackend,
} from "../migrations/apply.js";
import { compareParsedMigrationIds, parseMigrationId } from "../migrations/migration-id.js";
import { planRollback, planUpgrade } from "../migrations/planner.js";
import { loadReleaseMatrixFromFile, resolveTracksForTarget } from "../migrations/release-matrix.js";
import type { ReleaseMatrix } from "../migrations/types.js";
import {
  createMeiliMigrationBackend,
  createQdrantMigrationBackend,
  PostgresMigrationBackend,
  SqliteMigrationBackend,
} from "../migrations/sql-backends.js";

type ParsedArgs = {
  positionals: string[];
  options: Record<string, string>;
};

type ArchiveTrackResult = {
  track: string;
  status: "success" | "failed";
  archivedMigrationIds: string[];
  message?: string;
};

type VerifyFinding = {
  code: string;
  track?: string;
  migrationId?: string;
  message: string;
};

type BaselineTrackResult = {
  track: string;
  status: "success" | "failed" | "skipped";
  markedMigrationIds: string[];
  message?: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for option --${key}`);
    }
    options[key] = next;
    i++;
  }

  return { positionals, options };
}

function requireOption(options: Record<string, string>, name: string): string {
  const value = options[name];
  if (!value) {
    throw new Error(`Missing required option --${name}`);
  }
  return value;
}

function findRepoRoot(start: string): string {
  let current = start;
  while (true) {
    const candidate = path.join(current, "ddl", "release-matrix.yaml");
    if (fs.existsSync(candidate)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Cannot locate repository root (ddl/release-matrix.yaml not found)");
    }
    current = parent;
  }
}

function parseApplied(raw: string | undefined): Record<string, string[]> | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid --applied value: must be an object");
  }
  const result: Record<string, string[]> = {};
  for (const [track, ids] of Object.entries(parsed)) {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      throw new Error(`Invalid applied migration list for track ${track}`);
    }
    result[track] = ids;
  }
  return result;
}

function parseTrackToPathMap(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid --sqlite-file-map value: must be an object");
  }
  const result: Record<string, string> = {};
  for (const [track, filePath] of Object.entries(parsed)) {
    if (typeof filePath !== "string" || filePath.length === 0) {
      throw new Error(`Invalid sqlite file mapping for track ${track}`);
    }
    result[track] = filePath;
  }
  return result;
}

type BackendContext = {
  resolver: (track: string) => MigrationBackend | undefined;
  closeAll: () => Promise<void>;
};

async function createBackendContext(
  tracks: string[],
  options: Record<string, string>,
): Promise<BackendContext> {
  const sqliteFileMap = parseTrackToPathMap(options["sqlite-file-map"]);
  const defaultSqliteFile = options["sqlite-file"];
  const stateSqliteFile = options["state-sqlite-file"];
  const qdrantUrl = options["qdrant-url"];
  const qdrantApiKey = options["qdrant-api-key"];
  const meiliUrl = options["meili-url"];
  const meiliApiKey = options["meili-api-key"];

  let postgresBackend: PostgresMigrationBackend | undefined;
  const sqliteBackendsByFile = new Map<string, SqliteMigrationBackend>();
  const backendByTrack = new Map<string, MigrationBackend | undefined>();
  const managedBackends = new Set<MigrationBackend>();

  async function getSqliteBackend(filePath: string): Promise<SqliteMigrationBackend> {
    let backend = sqliteBackendsByFile.get(filePath);
    if (!backend) {
      backend = await SqliteMigrationBackend.create(filePath);
      sqliteBackendsByFile.set(filePath, backend);
      managedBackends.add(backend);
    }
    return backend;
  }

  async function resolveStateBackend(): Promise<MigrationBackend | undefined> {
    if (postgresBackend) {
      return postgresBackend;
    }
    const fallbackSqliteFile = stateSqliteFile ?? defaultSqliteFile ?? Object.values(sqliteFileMap)[0];
    if (fallbackSqliteFile) {
      return getSqliteBackend(fallbackSqliteFile);
    }
    return undefined;
  }

  for (const track of tracks) {
    if (track.endsWith(".postgres")) {
      postgresBackend = postgresBackend ?? new PostgresMigrationBackend();
      managedBackends.add(postgresBackend);
      backendByTrack.set(track, postgresBackend);
      continue;
    }
    if (track.endsWith(".sqlite")) {
      const sqliteFile = sqliteFileMap[track] ?? defaultSqliteFile;
      if (!sqliteFile) {
        backendByTrack.set(track, undefined);
        continue;
      }
      const backend = await getSqliteBackend(sqliteFile);
      backendByTrack.set(track, backend);
      continue;
    }
    if (track.endsWith(".qdrant")) {
      const stateBackend = await resolveStateBackend();
      if (!qdrantUrl || !stateBackend) {
        backendByTrack.set(track, undefined);
        continue;
      }
      backendByTrack.set(
        track,
        createQdrantMigrationBackend({
          baseUrl: qdrantUrl,
          apiKey: qdrantApiKey,
          stateBackend,
        }),
      );
      managedBackends.add(backendByTrack.get(track) as MigrationBackend);
      continue;
    }
    if (track.endsWith(".meili")) {
      const stateBackend = await resolveStateBackend();
      if (!meiliUrl || !stateBackend) {
        backendByTrack.set(track, undefined);
        continue;
      }
      backendByTrack.set(
        track,
        createMeiliMigrationBackend({
          baseUrl: meiliUrl,
          apiKey: meiliApiKey,
          stateBackend,
        }),
      );
      managedBackends.add(backendByTrack.get(track) as MigrationBackend);
      continue;
    }
    backendByTrack.set(track, undefined);
  }

  return {
    resolver: (track) => backendByTrack.get(track),
    closeAll: async () => {
      for (const backend of managedBackends) {
        if (backend.close) {
          await backend.close();
        }
      }
    },
  };
}

async function runPlan(parsed: ParsedArgs): Promise<void> {
  const direction = parsed.positionals[1];
  if (direction !== "up" && direction !== "down") {
    throw new Error("Usage: plan <up|down> --target <name> --to-app-version <version> [options]");
  }

  const target = requireOption(parsed.options, "target");
  const appVersion = requireOption(parsed.options, "to-app-version");

  const matrixPath = parsed.options.matrix
    ?? path.join(findRepoRoot(process.cwd()), "ddl", "release-matrix.yaml");
  const migrationsRoot = parsed.options["migrations-root"]
    ?? path.join(findRepoRoot(process.cwd()), "ddl", "migrations");
  const applied = parseApplied(parsed.options.applied);

  const matrix = await loadReleaseMatrixFromFile(matrixPath);
  const track = parsed.options.track;
  const plan = direction === "up"
    ? await planUpgrade({
      matrix,
      migrationsRoot,
      target,
      track,
      appVersion,
      appliedMigrationIdsByTrack: applied,
    })
    : await planRollback({
      matrix,
      migrationsRoot,
      target,
      track,
      appVersion,
      appliedMigrationIdsByTrack: applied,
    });

  console.log(JSON.stringify(plan, null, 2));
}

async function runApply(parsed: ParsedArgs): Promise<void> {
  const direction = parsed.positionals[1];
  if (direction !== "up" && direction !== "down") {
    throw new Error("Usage: apply <up|down> --target <name> --to-app-version <version> [options]");
  }

  const target = requireOption(parsed.options, "target");
  const appVersion = requireOption(parsed.options, "to-app-version");

  const matrixPath = parsed.options.matrix
    ?? path.join(findRepoRoot(process.cwd()), "ddl", "release-matrix.yaml");
  const migrationsRoot = parsed.options["migrations-root"]
    ?? path.join(findRepoRoot(process.cwd()), "ddl", "migrations");

  const matrix = await loadReleaseMatrixFromFile(matrixPath);
  const tracks = resolveTracksForTarget(matrix, target);
  const track = parsed.options.track;
  const selectedTracks = track ? [track] : tracks;
  if (track && !tracks.includes(track)) {
    throw new Error(`Track ${track} is not part of target ${target}`);
  }

  const backendContext = await createBackendContext(selectedTracks, parsed.options);
  const strictUnsupported = parsed.options["strict-unsupported"] === "true";
  try {
    const unsupportedTracks = selectedTracks.filter((item) => !backendContext.resolver(item));
    if (strictUnsupported && unsupportedTracks.length > 0) {
      throw new Error(`No backend configured for tracks: ${unsupportedTracks.join(", ")}`);
    }

    const appliedByTrack = await collectAppliedMigrationsByTrack(
      selectedTracks,
      backendContext.resolver,
    );

    const plan = direction === "up"
      ? await planUpgrade({
        matrix,
        migrationsRoot,
        target,
        track,
        appVersion,
        appliedMigrationIdsByTrack: appliedByTrack,
      })
      : await planRollback({
        matrix,
        migrationsRoot,
        target,
        track,
        appVersion,
        appliedMigrationIdsByTrack: appliedByTrack,
      });

    const result = await applyMigrationPlan({
      plan,
      operator: parsed.options.operator ?? "cli",
      dryRun: parsed.options["dry-run"] === "true",
      backendResolver: backendContext.resolver,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await backendContext.closeAll();
  }
}

async function runBaseline(parsed: ParsedArgs): Promise<void> {
  const target = requireOption(parsed.options, "target");
  const appVersion = requireOption(parsed.options, "to-app-version");
  const direction = parsed.options.direction ?? "up";
  if (direction !== "up" && direction !== "down") {
    throw new Error("Usage: baseline --target <name> --to-app-version <version> [--direction <up|down>] [options]");
  }
  const matrixPath = parsed.options.matrix
    ?? path.join(findRepoRoot(process.cwd()), "ddl", "release-matrix.yaml");
  const migrationsRoot = parsed.options["migrations-root"]
    ?? path.join(findRepoRoot(process.cwd()), "ddl", "migrations");
  const track = parsed.options.track;
  const dryRun = parsed.options["dry-run"] === "true";
  const operator = parsed.options.operator ?? "cli";

  const matrix = await loadReleaseMatrixFromFile(matrixPath);
  const tracks = resolveTracksForTarget(matrix, target);
  const selectedTracks = track ? [track] : tracks;
  if (track && !tracks.includes(track)) {
    throw new Error(`Track ${track} is not part of target ${target}`);
  }

  const backendContext = await createBackendContext(selectedTracks, parsed.options);
  const strictUnsupported = parsed.options["strict-unsupported"] === "true";
  try {
    const unsupportedTracks = selectedTracks.filter((item) => !backendContext.resolver(item));
    if (strictUnsupported && unsupportedTracks.length > 0) {
      throw new Error(`No backend configured for tracks: ${unsupportedTracks.join(", ")}`);
    }

    const appliedByTrack = await collectAppliedMigrationsByTrack(
      selectedTracks,
      backendContext.resolver,
    );
    const plan = direction === "up"
      ? await planUpgrade({
        matrix,
        migrationsRoot,
        target,
        track,
        appVersion,
        appliedMigrationIdsByTrack: appliedByTrack,
      })
      : await planRollback({
        matrix,
        migrationsRoot,
        target,
        track,
        appVersion,
        appliedMigrationIdsByTrack: appliedByTrack,
      });

    const results: BaselineTrackResult[] = [];
    const holder = `pid:${process.pid}`;
    for (const trackPlan of plan.tracks) {
      const backend = backendContext.resolver(trackPlan.track);
      if (!backend) {
        results.push({
          track: trackPlan.track,
          status: "skipped",
          markedMigrationIds: [],
          message: "No backend configured for track",
        });
        continue;
      }

      const markedMigrationIds: string[] = [];
      let status: BaselineTrackResult["status"] = "success";
      let message: string | undefined;

      await backend.ensureStateTables();
      await backend.acquireLock(trackPlan.track, holder);
      try {
        for (const migration of trackPlan.migrations) {
          if (dryRun) {
            markedMigrationIds.push(migration.migrationId);
            continue;
          }
          try {
            const historyId = await backend.insertHistoryRunning({
              track: trackPlan.track,
              migrationId: migration.migrationId,
              schemaVersion: migration.schemaVersion,
              appVersion,
              direction,
              operator,
            });
            await backend.updateHistoryResult(historyId, "success");
            markedMigrationIds.push(migration.migrationId);
          } catch (err) {
            status = "failed";
            message = err instanceof Error ? err.message : String(err);
            break;
          }
        }
      } finally {
        await backend.releaseLock(trackPlan.track, holder);
      }

      results.push({
        track: trackPlan.track,
        status,
        markedMigrationIds,
        message,
      });
    }

    console.log(
      JSON.stringify(
        {
          mode: "baseline",
          target,
          appVersion,
          direction,
          dryRun,
          tracks: results,
        },
        null,
        2,
      ),
    );
  } finally {
    await backendContext.closeAll();
  }
}

async function runStatus(parsed: ParsedArgs): Promise<void> {
  const target = requireOption(parsed.options, "target");
  const appVersion = requireOption(parsed.options, "to-app-version");
  const detailsEnabled = parsed.options.details === "true";
  const track = parsed.options.track;
  const migrationsRoot = parsed.options["migrations-root"]
    ?? path.join(findRepoRoot(process.cwd()), "ddl", "migrations");

  const matrixPath = parsed.options.matrix
    ?? path.join(findRepoRoot(process.cwd()), "ddl", "release-matrix.yaml");
  const matrix = await loadReleaseMatrixFromFile(matrixPath);
  const tracks = resolveTracksForTarget(matrix, target);
  const selectedTracks = track ? [track] : tracks;
  if (track && !tracks.includes(track)) {
    throw new Error(`Track ${track} is not part of target ${target}`);
  }

  if (!detailsEnabled) {
    console.log(
      JSON.stringify(
        {
          target,
          appVersion,
          tracks: selectedTracks,
        },
        null,
        2,
      ),
    );
    return;
  }

  const backendContext = await createBackendContext(selectedTracks, parsed.options);
  try {
    const appliedByTrack = await collectAppliedMigrationsByTrack(
      selectedTracks,
      backendContext.resolver,
    );
    const upgradePlan = await planUpgrade({
      matrix,
      migrationsRoot,
      target,
      track,
      appVersion,
      appliedMigrationIdsByTrack: appliedByTrack,
    });
    const rollbackPlan = await planRollback({
      matrix,
      migrationsRoot,
      target,
      track,
      appVersion,
      appliedMigrationIdsByTrack: appliedByTrack,
    });

    const upgradeByTrack = new Map(
      upgradePlan.tracks.map((item) => [item.track, item.migrations.map((migration) => migration.migrationId)]),
    );
    const rollbackByTrack = new Map(
      rollbackPlan.tracks.map((item) => [item.track, item.migrations.map((migration) => migration.migrationId)]),
    );
    const schemaByTrack = new Map(
      upgradePlan.tracks.map((item) => [item.track, item.targetSchemaVersion]),
    );

    const details = selectedTracks.map((item) => ({
      track: item,
      backendConfigured: Boolean(backendContext.resolver(item)),
      targetSchemaVersion: schemaByTrack.get(item),
      appliedMigrationIds: appliedByTrack[item] ?? [],
      pendingUpgradeMigrationIds: upgradeByTrack.get(item) ?? [],
      pendingRollbackMigrationIds: rollbackByTrack.get(item) ?? [],
    }));

    console.log(
      JSON.stringify(
        {
          target,
          appVersion,
          tracks: selectedTracks,
          details,
        },
        null,
        2,
      ),
    );
  } finally {
    await backendContext.closeAll();
  }
}

async function resolveArchiveTracks(
  migrationsRoot: string,
  explicitTrack: string | undefined,
): Promise<string[]> {
  if (explicitTrack) {
    return [explicitTrack];
  }
  const entries = await fsPromises.readdir(migrationsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function runArchive(parsed: ParsedArgs): Promise<void> {
  const beforeSchemaVersion = requireOption(parsed.options, "before-schema-version");
  const outputRoot = requireOption(parsed.options, "output");
  const migrationsRoot = parsed.options["migrations-root"]
    ?? path.join(findRepoRoot(process.cwd()), "ddl", "migrations");
  const explicitTrack = parsed.options.track;
  const dryRun = parsed.options["dry-run"] === "true";
  const strict = parsed.options.strict === "true";

  const tracks = await resolveArchiveTracks(migrationsRoot, explicitTrack);
  const results: ArchiveTrackResult[] = [];

  for (const track of tracks) {
    const trackDir = path.join(migrationsRoot, track);
    try {
      const entries = await fsPromises.readdir(trackDir, { withFileTypes: true });
      const candidates = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => parseMigrationId(entry.name))
        .sort((left, right) => compareParsedMigrationIds(left, right))
        .filter((parsedId) => semver.lte(parsedId.schemaVersion, beforeSchemaVersion));

      const archivedIds = candidates.map((item) => item.id);
      if (!dryRun) {
        for (const migrationId of archivedIds) {
          const source = path.join(trackDir, migrationId);
          const destination = path.join(outputRoot, track, migrationId);
          await fsPromises.mkdir(path.dirname(destination), { recursive: true });
          await fsPromises.rename(source, destination);
        }
      }

      results.push({
        track,
        status: "success",
        archivedMigrationIds: archivedIds,
      });
    } catch (err) {
      results.push({
        track,
        status: "failed",
        archivedMigrationIds: [],
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        beforeSchemaVersion,
        migrationsRoot,
        output: outputRoot,
        dryRun,
        tracks: results,
      },
      null,
      2,
    ),
  );
  if (strict) {
    const failedTracks = results.filter((item) => item.status === "failed").map((item) => item.track);
    if (failedTracks.length > 0) {
      throw new Error(`Archive failed for tracks: ${failedTracks.join(", ")}`);
    }
  }
}

function expectedOperationFiles(track: string): string[] {
  if (track.endsWith(".qdrant") || track.endsWith(".meili")) {
    return ["up.http.json", "down.http.json"];
  }
  return ["up.sql", "down.sql"];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

function resolveVerifyTracks(
  matrix: ReleaseMatrix,
  target: string | undefined,
  track: string | undefined,
): string[] {
  if (track) {
    if (target) {
      const targetTracks = resolveTracksForTarget(matrix, target);
      if (!targetTracks.includes(track)) {
        throw new Error(`Track ${track} is not part of target ${target}`);
      }
    }
    return [track];
  }
  if (target) {
    return resolveTracksForTarget(matrix, target);
  }
  const unique = new Set<string>();
  for (const tracks of Object.values(matrix.targets)) {
    for (const item of tracks) {
      unique.add(item);
    }
  }
  return [...unique].sort((left, right) => left.localeCompare(right));
}

async function runVerify(parsed: ParsedArgs): Promise<void> {
  const matrixPath = parsed.options.matrix
    ?? path.join(findRepoRoot(process.cwd()), "ddl", "release-matrix.yaml");
  const migrationsRoot = parsed.options["migrations-root"]
    ?? path.join(findRepoRoot(process.cwd()), "ddl", "migrations");
  const target = parsed.options.target;
  const track = parsed.options.track;
  const appVersion = parsed.options["to-app-version"];
  const strict = parsed.options.strict === "true";

  const matrix = await loadReleaseMatrixFromFile(matrixPath);
  const tracks = resolveVerifyTracks(matrix, target, track);
  const findings: VerifyFinding[] = [];

  const selectedRelease = appVersion
    ? matrix.releases.find((release) => release.app_version === appVersion)
    : undefined;
  if (appVersion && !selectedRelease) {
    findings.push({
      code: "app_version_not_found",
      message: `App version not found in matrix: ${appVersion}`,
    });
  }

  for (const release of matrix.releases) {
    for (const selectedTrack of tracks) {
      if (!release.tracks[selectedTrack]) {
        findings.push({
          code: "missing_track_schema_version",
          track: selectedTrack,
          message: `Release ${release.app_version} is missing schema version for track ${selectedTrack}`,
        });
      }
    }
  }

  if (selectedRelease) {
    for (const selectedTrack of tracks) {
      if (!selectedRelease.tracks[selectedTrack]) {
        findings.push({
          code: "missing_track_schema_version",
          track: selectedTrack,
          message: `Target app version ${appVersion} is missing schema version for track ${selectedTrack}`,
        });
      }
    }
  }

  for (const selectedTrack of tracks) {
    const trackDir = path.join(migrationsRoot, selectedTrack);
    let entries: Dirent[] = [];
    try {
      entries = await fsPromises.readdir(trackDir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        findings.push({
          code: "missing_track_directory",
          track: selectedTrack,
          message: `Migration track directory not found: ${trackDir}`,
        });
        continue;
      }
      throw err;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      let parsedId: ReturnType<typeof parseMigrationId>;
      try {
        parsedId = parseMigrationId(entry.name);
      } catch {
        findings.push({
          code: "invalid_migration_id",
          track: selectedTrack,
          migrationId: entry.name,
          message: `Invalid migration id directory: ${entry.name}`,
        });
        continue;
      }

      const migrationRoot = path.join(trackDir, parsedId.id);
      for (const requiredFile of expectedOperationFiles(selectedTrack)) {
        const filePath = path.join(migrationRoot, requiredFile);
        if (!(await fileExists(filePath))) {
          findings.push({
            code: "missing_operation_file",
            track: selectedTrack,
            migrationId: parsedId.id,
            message: `Missing required file ${requiredFile} for ${selectedTrack}/${parsedId.id}`,
          });
        }
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        status: findings.length === 0 ? "passed" : "failed",
        matrixPath,
        migrationsRoot,
        target,
        appVersion,
        checkedTracks: tracks,
        findings,
      },
      null,
      2,
    ),
  );
  if (strict && findings.length > 0) {
    throw new Error(`Verification failed with ${findings.length} finding(s)`);
  }
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const command = parsed.positionals[0];
  if (!command) {
    throw new Error("Usage: <plan|apply|baseline|status|archive|verify> ...");
  }
  if (command === "plan") {
    await runPlan(parsed);
    return;
  }
  if (command === "apply") {
    await runApply(parsed);
    return;
  }
  if (command === "baseline") {
    await runBaseline(parsed);
    return;
  }
  if (command === "status") {
    await runStatus(parsed);
    return;
  }
  if (command === "archive") {
    await runArchive(parsed);
    return;
  }
  if (command === "verify") {
    await runVerify(parsed);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
