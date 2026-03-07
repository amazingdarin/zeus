import type { Dirent } from "node:fs";
import { access, cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PluginActivationV2, PluginInstallationRecordV2 } from "@zeus/plugin-sdk-shared";

import { closePool, query } from "../db/postgres.js";
import {
  ZEUS_DATA_ROOT,
  getProjectRoot,
  getUserPluginCacheRoot,
  getUserPluginDataGlobalRoot,
  getUserPluginInstalledConfigPath,
  getUserPluginPackagesRoot,
  getUserPluginRegistrySnapshotPath,
  getUserPluginRoot,
  getUserPluginRuntimeRoot,
  getUserPluginSettingsDir,
  getUserPluginSettingsPath,
  getUserPluginTmpRoot,
} from "../storage/paths.js";

type Options = {
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
  legacyRepoRoot?: string;
  legacyPluginRoot?: string;
};

type Stats = {
  projectsScanned: number;
  projectCopies: number;
  projectSkips: number;
  pluginPackagesCopied: number;
  pluginPackagesMissing: number;
  pluginInstalledFilesWritten: number;
  pluginSettingsWritten: number;
  pluginSnapshotFilesWritten: number;
  warnings: string[];
};

type ProjectRow = {
  key: string;
  owner_type: string;
  owner_id: string;
  status: string;
};

type TeamOwnerRow = {
  owner_id: string;
};

type TeamMemberRow = {
  user_id: string;
};

type InstallationRow = {
  user_id: string;
  plugin_id: string;
  version: string;
  enabled: boolean;
  status: string;
  installed_at: Date;
  updated_at: Date;
  last_error: string | null;
  manifest_api_version: number | null;
  capabilities_json: unknown;
  activation_json: unknown;
};

type SettingsRow = {
  user_id: string;
  plugin_id: string;
  settings_json: unknown;
};

type SnapshotRow = {
  user_id: string;
  plugin_id: string;
  version: string;
  commands_json: unknown;
  hooks_json: unknown;
  routes_json: unknown;
  tools_json: unknown;
  updated_at: Date;
};

type InstalledConfigFile = {
  schemaVersion: 1;
  updatedAt: string;
  installations: Record<string, PluginInstallationRecordV2>;
};

type SnapshotRecord = {
  userId: string;
  pluginId: string;
  version: string;
  commands: Array<Record<string, unknown>>;
  hooks: Array<Record<string, unknown>>;
  routes: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  updatedAt: string;
};

type SnapshotConfigFile = {
  schemaVersion: 1;
  updatedAt: string;
  snapshots: Record<string, SnapshotRecord>;
};

type LegacyPluginPackage = {
  pluginId: string;
  version: string;
  sourcePath: string;
};

const TABLE_MISSING_CODE = "42P01";

function parseOptions(argv: string[]): Options {
  const options: Options = {
    dryRun: false,
    force: false,
    verbose: false,
  };

  for (const token of argv) {
    if (token === "--dry-run") options.dryRun = true;
    else if (token === "--force") options.force = true;
    else if (token === "--verbose" || token === "-v") options.verbose = true;
    else if (token.startsWith("--legacy-repo-root=")) {
      options.legacyRepoRoot = token.split("=", 2)[1];
    } else if (token.startsWith("--legacy-plugin-root=")) {
      options.legacyPluginRoot = token.split("=", 2)[1];
    }
  }

  return options;
}

function logInfo(message: string): void {
  console.log(`[migrate-user-data] ${message}`);
}

function logWarn(stats: Stats, message: string): void {
  stats.warnings.push(message);
  console.warn(`[migrate-user-data] WARN: ${message}`);
}

function logVerbose(options: Options, message: string): void {
  if (options.verbose) {
    console.log(`[migrate-user-data] ${message}`);
  }
}

function isTableMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code || "") : "";
  return code === TABLE_MISSING_CODE;
}

function resolveLegacyRepoRoot(options: Options): string {
  const fromArg = String(options.legacyRepoRoot || "").trim();
  if (fromArg) return path.resolve(process.cwd(), fromArg);

  const fromEnv = String(process.env.LEGACY_REPO_ROOT || "").trim();
  if (fromEnv) return path.resolve(process.cwd(), fromEnv);

  const oldRepoRoot = String(process.env.REPO_ROOT || "").trim();
  if (oldRepoRoot) {
    return path.resolve(process.cwd(), oldRepoRoot);
  }

  return path.join(ZEUS_DATA_ROOT, "repos");
}

function resolveLegacyPluginRoots(options: Options): string[] {
  const candidates = new Set<string>();
  const add = (value: string | undefined) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    candidates.add(path.resolve(process.cwd(), raw));
  };

  add(options.legacyPluginRoot);
  add(process.env.LEGACY_PLUGIN_ROOT);
  add(process.env.PLUGIN_ROOT);
  add(path.join(ZEUS_DATA_ROOT, "plugins"));
  add(path.join(ZEUS_DATA_ROOT, "plugins", "packages"));

  return Array.from(candidates);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(targetDir: string, options: Options): Promise<void> {
  if (options.dryRun) return;
  await mkdir(targetDir, { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(
  filePath: string,
  value: unknown,
  options: Options,
): Promise<void> {
  if (options.dryRun) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function copyTree(
  src: string,
  dest: string,
  options: Options,
): Promise<"copied" | "skipped"> {
  const srcExists = await pathExists(src);
  if (!srcExists) {
    return "skipped";
  }

  const srcReal = path.resolve(src);
  const destReal = path.resolve(dest);
  if (srcReal === destReal) {
    return "skipped";
  }

  const destExists = await pathExists(dest);
  if (destExists && !options.force) {
    return "skipped";
  }

  if (options.dryRun) {
    return "copied";
  }

  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, {
    recursive: true,
    force: options.force,
    errorOnExist: false,
  });
  return "copied";
}

function normalizeOwnerType(ownerType: string): "personal" | "team" {
  return String(ownerType || "").trim().toLowerCase() === "team"
    ? "team"
    : "personal";
}

function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeActivation(value: unknown): PluginActivationV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as PluginActivationV2;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
}

async function listTargetUsersForProject(project: ProjectRow): Promise<string[]> {
  if (normalizeOwnerType(project.owner_type) === "personal") {
    return [String(project.owner_id || "").trim()].filter(Boolean);
  }

  const teamId = String(project.owner_id || "").trim();
  if (!teamId) return [];

  const users = new Set<string>();

  try {
    const teamOwner = await query<TeamOwnerRow>(
      `SELECT owner_id
         FROM team
        WHERE id = $1
        LIMIT 1`,
      [teamId],
    );
    const ownerId = String(teamOwner.rows[0]?.owner_id || "").trim();
    if (ownerId) users.add(ownerId);
  } catch {
    // ignore
  }

  const members = await query<TeamMemberRow>(
    `SELECT user_id
       FROM team_member
      WHERE team_id = $1`,
    [teamId],
  );
  for (const row of members.rows) {
    const userId = String(row.user_id || "").trim();
    if (userId) users.add(userId);
  }

  return Array.from(users);
}

async function listLegacyPersonalProjectsFromFs(legacyRepoRoot: string): Promise<ProjectRow[]> {
  const result: ProjectRow[] = [];
  const repoRootExists = await pathExists(legacyRepoRoot);
  if (!repoRootExists) return result;

  const ownerDirs = await readdir(legacyRepoRoot, { withFileTypes: true });
  for (const ownerDir of ownerDirs) {
    if (!ownerDir.isDirectory()) continue;
    if (ownerDir.name === "team") continue;

    const ownerId = ownerDir.name;
    const personalDir = path.join(legacyRepoRoot, ownerId, "personal");
    if (!(await pathExists(personalDir))) continue;

    const projectDirs = await readdir(personalDir, { withFileTypes: true });
    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue;
      result.push({
        key: projectDir.name,
        owner_type: "user",
        owner_id: ownerId,
        status: "unknown",
      });
    }
  }

  return result;
}

async function migrateProjects(
  legacyRepoRoot: string,
  options: Options,
  stats: Stats,
): Promise<Set<string>> {
  const touchedUsers = new Set<string>();
  let projects: ProjectRow[] = [];
  let fromDb = true;

  try {
    const result = await query<ProjectRow>(
      `SELECT key, owner_type, owner_id, status
         FROM project`,
    );
    projects = result.rows;
  } catch (err) {
    fromDb = false;
    logWarn(stats, `Unable to query project table, fallback to filesystem scan: ${String((err as Error).message || err)}`);
    projects = await listLegacyPersonalProjectsFromFs(legacyRepoRoot);
  }

  for (const project of projects) {
    const ownerType = normalizeOwnerType(project.owner_type);
    const ownerId = String(project.owner_id || "").trim();
    const projectKey = String(project.key || "").trim();
    if (!ownerId || !projectKey) continue;

    stats.projectsScanned += 1;

    const legacyProjectRoot = ownerType === "team"
      ? path.join(legacyRepoRoot, "team", ownerId, projectKey)
      : path.join(legacyRepoRoot, ownerId, "personal", projectKey);

    if (!(await pathExists(legacyProjectRoot))) {
      stats.projectSkips += 1;
      continue;
    }

    let targetUsers: string[] = [];
    if (ownerType === "team") {
      if (fromDb) {
        try {
          targetUsers = await listTargetUsersForProject(project);
        } catch (err) {
          logWarn(stats, `Failed to resolve team members for team=${ownerId}, project=${projectKey}: ${String((err as Error).message || err)}`);
        }
      }
      if (targetUsers.length === 0) {
        logWarn(stats, `Skip team project migration without target users: team=${ownerId}, project=${projectKey}`);
        stats.projectSkips += 1;
        continue;
      }
    } else {
      targetUsers = [ownerId];
    }

    for (const userId of targetUsers) {
      touchedUsers.add(userId);
      const destination = getProjectRoot(userId, ownerId, ownerType, projectKey);
      const action = await copyTree(legacyProjectRoot, destination, options);
      if (action === "copied") {
        stats.projectCopies += 1;
        logVerbose(
          options,
          `${options.dryRun ? "plan" : "copied"} project ${ownerType}:${ownerId}:${projectKey} -> ${userId}`,
        );
      } else {
        stats.projectSkips += 1;
      }
    }
  }

  return touchedUsers;
}

async function migratePluginPackagesAndInstalledConfig(
  legacyPluginRoots: string[],
  options: Options,
  stats: Stats,
): Promise<{ users: Set<string>; migratedFromDb: boolean }> {
  const touchedUsers = new Set<string>();
  let rows: InstallationRow[] = [];

  try {
    const result = await query<InstallationRow>(
      `SELECT user_id, plugin_id, version, enabled, status, installed_at, updated_at, last_error,
              manifest_api_version, capabilities_json, activation_json
         FROM plugin_user_installation`,
    );
    rows = result.rows;
  } catch (err) {
    if (!isTableMissing(err)) {
      logWarn(stats, `Unable to query plugin_user_installation: ${String((err as Error).message || err)}`);
    }
    return { users: touchedUsers, migratedFromDb: false };
  }

  const installsByUser = new Map<string, InstallationRow[]>();
  for (const row of rows) {
    const userId = String(row.user_id || "").trim();
    if (!userId) continue;
    const list = installsByUser.get(userId) || [];
    list.push(row);
    installsByUser.set(userId, list);
  }

  for (const [userId, installs] of installsByUser) {
    touchedUsers.add(userId);
    await ensureDir(getUserPluginRoot(userId), options);
    await ensureDir(getUserPluginPackagesRoot(userId), options);
    await ensureDir(getUserPluginSettingsDir(userId), options);
    await ensureDir(getUserPluginDataGlobalRoot(userId), options);
    await ensureDir(getUserPluginCacheRoot(userId), options);
    await ensureDir(getUserPluginRuntimeRoot(userId), options);
    await ensureDir(getUserPluginTmpRoot(userId), options);

    const installedConfig: InstalledConfigFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      installations: {},
    };

    for (const install of installs) {
      const pluginId = String(install.plugin_id || "").trim();
      const version = String(install.version || "").trim();
      if (!pluginId || !version) continue;

      const record: PluginInstallationRecordV2 = {
        userId,
        pluginId,
        version,
        enabled: install.enabled === true,
        status: install.status as PluginInstallationRecordV2["status"],
        installedAt: install.installed_at?.toISOString?.() || new Date().toISOString(),
        updatedAt: install.updated_at?.toISOString?.() || new Date().toISOString(),
        lastError: install.last_error,
        manifestApiVersion: Number(install.manifest_api_version || 0) || undefined,
        capabilities: normalizeCapabilities(install.capabilities_json),
        activation: normalizeActivation(install.activation_json),
      };
      installedConfig.installations[pluginId] = record;

      let sourcePackagePath: string | null = null;
      for (const root of legacyPluginRoots) {
        const candidate = path.join(root, pluginId, version);
        if (await pathExists(candidate)) {
          sourcePackagePath = candidate;
          break;
        }
      }

      const destPackagePath = path.join(getUserPluginPackagesRoot(userId), pluginId, version);
      if (!sourcePackagePath) {
        stats.pluginPackagesMissing += 1;
        logWarn(stats, `Plugin package source missing for ${pluginId}@${version} (user=${userId})`);
        continue;
      }

      const action = await copyTree(sourcePackagePath, destPackagePath, options);
      if (action === "copied") {
        stats.pluginPackagesCopied += 1;
        logVerbose(
          options,
          `${options.dryRun ? "plan" : "copied"} plugin package ${pluginId}@${version} -> ${userId}`,
        );
      }
    }

    const installedPath = getUserPluginInstalledConfigPath(userId);
    const existing = await readJsonFile<InstalledConfigFile>(installedPath);
    const merged: InstalledConfigFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      installations: {
        ...(existing?.installations || {}),
        ...installedConfig.installations,
      },
    };
    await writeJsonFile(installedPath, merged, options);
    stats.pluginInstalledFilesWritten += 1;
  }

  return { users: touchedUsers, migratedFromDb: true };
}

async function migratePluginSettings(
  options: Options,
  stats: Stats,
): Promise<Set<string>> {
  const touchedUsers = new Set<string>();
  let rows: SettingsRow[] = [];

  try {
    const result = await query<SettingsRow>(
      `SELECT user_id, plugin_id, settings_json
         FROM plugin_user_settings`,
    );
    rows = result.rows;
  } catch (err) {
    if (!isTableMissing(err)) {
      logWarn(stats, `Unable to query plugin_user_settings: ${String((err as Error).message || err)}`);
    }
    return touchedUsers;
  }

  for (const row of rows) {
    const userId = String(row.user_id || "").trim();
    const pluginId = String(row.plugin_id || "").trim();
    if (!userId || !pluginId) continue;

    touchedUsers.add(userId);
    const settingsPath = getUserPluginSettingsPath(userId, pluginId);
    const exists = await pathExists(settingsPath);
    if (exists && !options.force) {
      logVerbose(options, `skip existing plugin settings: ${settingsPath}`);
      continue;
    }

    await writeJsonFile(settingsPath, normalizeObject(row.settings_json), options);
    stats.pluginSettingsWritten += 1;
  }

  return touchedUsers;
}

async function migratePluginSnapshots(
  options: Options,
  stats: Stats,
): Promise<Set<string>> {
  const touchedUsers = new Set<string>();
  let rows: SnapshotRow[] = [];

  try {
    const result = await query<SnapshotRow>(
      `SELECT user_id, plugin_id, version, commands_json, hooks_json, routes_json, tools_json, updated_at
         FROM plugin_user_registry_snapshot`,
    );
    rows = result.rows;
  } catch (err) {
    if (!isTableMissing(err)) {
      logWarn(stats, `Unable to query plugin_user_registry_snapshot: ${String((err as Error).message || err)}`);
    }
    return touchedUsers;
  }

  const byUser = new Map<string, SnapshotRecord[]>();
  for (const row of rows) {
    const userId = String(row.user_id || "").trim();
    const pluginId = String(row.plugin_id || "").trim();
    if (!userId || !pluginId) continue;

    const record: SnapshotRecord = {
      userId,
      pluginId,
      version: String(row.version || "").trim(),
      commands: normalizeArray(row.commands_json),
      hooks: normalizeArray(row.hooks_json),
      routes: normalizeArray(row.routes_json),
      tools: normalizeArray(row.tools_json),
      updatedAt: row.updated_at?.toISOString?.() || new Date().toISOString(),
    };

    const list = byUser.get(userId) || [];
    list.push(record);
    byUser.set(userId, list);
  }

  for (const [userId, list] of byUser) {
    touchedUsers.add(userId);
    const snapshotPath = getUserPluginRegistrySnapshotPath(userId);
    const existing = await readJsonFile<SnapshotConfigFile>(snapshotPath);
    const nextSnapshots = { ...(existing?.snapshots || {}) };
    for (const record of list) {
      nextSnapshots[record.pluginId] = record;
    }
    const payload: SnapshotConfigFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      snapshots: nextSnapshots,
    };
    await writeJsonFile(snapshotPath, payload, options);
    stats.pluginSnapshotFilesWritten += 1;
  }

  return touchedUsers;
}

async function ensureUserPluginScaffold(userId: string, options: Options, stats: Stats): Promise<void> {
  await ensureDir(getUserPluginRoot(userId), options);
  await ensureDir(getUserPluginPackagesRoot(userId), options);
  await ensureDir(getUserPluginSettingsDir(userId), options);
  await ensureDir(getUserPluginDataGlobalRoot(userId), options);
  await ensureDir(getUserPluginCacheRoot(userId), options);
  await ensureDir(getUserPluginRuntimeRoot(userId), options);
  await ensureDir(getUserPluginTmpRoot(userId), options);

  const installedPath = getUserPluginInstalledConfigPath(userId);
  const existingInstalled = await readJsonFile<InstalledConfigFile>(installedPath);
  if (!existingInstalled) {
    const emptyInstalled: InstalledConfigFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      installations: {},
    };
    await writeJsonFile(installedPath, emptyInstalled, options);
    stats.pluginInstalledFilesWritten += 1;
  }

  const snapshotPath = getUserPluginRegistrySnapshotPath(userId);
  const existingSnapshot = await readJsonFile<SnapshotConfigFile>(snapshotPath);
  if (!existingSnapshot) {
    const emptySnapshot: SnapshotConfigFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      snapshots: {},
    };
    await writeJsonFile(snapshotPath, emptySnapshot, options);
    stats.pluginSnapshotFilesWritten += 1;
  }
}

async function listLegacyPluginPackages(
  legacyPluginRoots: string[],
): Promise<LegacyPluginPackage[]> {
  const packages: LegacyPluginPackage[] = [];

  for (const root of legacyPluginRoots) {
    if (!(await pathExists(root))) continue;
    let pluginDirs: Dirent<string>[];
    try {
      pluginDirs = await readdir(root, { withFileTypes: true, encoding: "utf8" });
    } catch {
      continue;
    }
    for (const pluginDir of pluginDirs) {
      if (!pluginDir.isDirectory()) continue;
      const pluginId = pluginDir.name;
      const pluginRoot = path.join(root, pluginId);
      let versionDirs: Dirent<string>[];
      try {
        versionDirs = await readdir(pluginRoot, { withFileTypes: true, encoding: "utf8" });
      } catch {
        continue;
      }
      for (const versionDir of versionDirs) {
        if (!versionDir.isDirectory()) continue;
        const version = versionDir.name;
        const sourcePath = path.join(pluginRoot, version);
        packages.push({ pluginId, version, sourcePath });
      }
    }
  }

  // dedupe by pluginId@version, prefer first discovered
  const deduped = new Map<string, LegacyPluginPackage>();
  for (const item of packages) {
    const key = `${item.pluginId}@${item.version}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }
  return Array.from(deduped.values());
}

async function fallbackMigratePluginPackagesWithoutDb(
  users: Set<string>,
  legacyPluginRoots: string[],
  options: Options,
  stats: Stats,
): Promise<void> {
  if (users.size === 0) return;

  const packages = await listLegacyPluginPackages(legacyPluginRoots);
  if (packages.length === 0) return;

  for (const userId of users) {
    await ensureUserPluginScaffold(userId, options, stats);

    for (const pkg of packages) {
      const destination = path.join(getUserPluginPackagesRoot(userId), pkg.pluginId, pkg.version);
      const action = await copyTree(pkg.sourcePath, destination, options);
      if (action === "copied") {
        stats.pluginPackagesCopied += 1;
      }
    }
  }
}

function printSummary(stats: Stats, options: Options, legacyRepoRoot: string, legacyPluginRoots: string[]): void {
  const mode = options.dryRun ? "DRY-RUN" : "APPLY";
  logInfo(`Mode=${mode}`);
  logInfo(`ZEUS_DATA_ROOT=${ZEUS_DATA_ROOT}`);
  logInfo(`LEGACY_REPO_ROOT=${legacyRepoRoot}`);
  logInfo(`LEGACY_PLUGIN_ROOTS=${legacyPluginRoots.join(", ") || "(none)"}`);
  logInfo(`projects.scanned=${stats.projectsScanned}`);
  logInfo(`projects.copied=${stats.projectCopies}`);
  logInfo(`projects.skipped=${stats.projectSkips}`);
  logInfo(`plugins.packagesCopied=${stats.pluginPackagesCopied}`);
  logInfo(`plugins.packagesMissing=${stats.pluginPackagesMissing}`);
  logInfo(`plugins.installedFilesWritten=${stats.pluginInstalledFilesWritten}`);
  logInfo(`plugins.settingsWritten=${stats.pluginSettingsWritten}`);
  logInfo(`plugins.snapshotFilesWritten=${stats.pluginSnapshotFilesWritten}`);
  logInfo(`warnings=${stats.warnings.length}`);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const stats: Stats = {
    projectsScanned: 0,
    projectCopies: 0,
    projectSkips: 0,
    pluginPackagesCopied: 0,
    pluginPackagesMissing: 0,
    pluginInstalledFilesWritten: 0,
    pluginSettingsWritten: 0,
    pluginSnapshotFilesWritten: 0,
    warnings: [],
  };

  const legacyRepoRoot = resolveLegacyRepoRoot(options);
  const legacyPluginRoots = resolveLegacyPluginRoots(options).filter((item, index, arr) => arr.indexOf(item) === index);

  logInfo(`Starting user data migration (${options.dryRun ? "dry-run" : "apply"})`);

  const usersFromProjects = await migrateProjects(legacyRepoRoot, options, stats);
  const pluginMigration = await migratePluginPackagesAndInstalledConfig(legacyPluginRoots, options, stats);
  const usersFromPlugins = pluginMigration.users;
  const usersFromSettings = await migratePluginSettings(options, stats);
  const usersFromSnapshots = await migratePluginSnapshots(options, stats);

  const allUsers = new Set<string>([
    ...Array.from(usersFromProjects),
    ...Array.from(usersFromPlugins),
    ...Array.from(usersFromSettings),
    ...Array.from(usersFromSnapshots),
  ]);

  if (!pluginMigration.migratedFromDb) {
    await fallbackMigratePluginPackagesWithoutDb(allUsers, legacyPluginRoots, options, stats);
  }

  for (const userId of allUsers) {
    await ensureUserPluginScaffold(userId, options, stats);
  }

  printSummary(stats, options, legacyRepoRoot, legacyPluginRoots);
}

main()
  .catch((err) => {
    console.error(`[migrate-user-data] Failed: ${err instanceof Error ? err.stack || err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch {
      // ignore
    }
  });
