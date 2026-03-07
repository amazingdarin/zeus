import { readdir } from "node:fs/promises";

import { USERS_ROOT } from "../../storage/paths.js";
import { generalSettingsStore } from "../general-settings-store.js";
import { documentTrashStore } from "./store.js";

export type TrashCleanupTarget = {
  userId: string;
  projectKey: string;
};

export type DocumentTrashCleanupSchedulerOptions = {
  intervalMs?: number;
  listTargets?: () => Promise<TrashCleanupTarget[]>;
  getSettings?: (userId: string) => Promise<{
    trashAutoCleanupEnabled: boolean;
    trashAutoCleanupDays: number;
  }>;
  sweepProject?: (input: {
    userId: string;
    projectKey: string;
    maxAgeDays: number;
  }) => Promise<{ count: number }>;
};

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export async function listDocumentTrashCleanupTargets(): Promise<TrashCleanupTarget[]> {
  const targets: TrashCleanupTarget[] = [];

  let userEntries: string[] = [];
  try {
    userEntries = await readdir(USERS_ROOT);
  } catch {
    return targets;
  }

  for (const encodedUserId of userEntries) {
    const userId = safeDecode(encodedUserId);
    let ownerTypes: string[] = [];
    try {
      ownerTypes = await readdir(`${USERS_ROOT}/${encodedUserId}/projects`);
    } catch {
      continue;
    }

    for (const encodedOwnerType of ownerTypes) {
      let ownerIds: string[] = [];
      try {
        ownerIds = await readdir(`${USERS_ROOT}/${encodedUserId}/projects/${encodedOwnerType}`);
      } catch {
        continue;
      }

      for (const encodedOwnerId of ownerIds) {
        let projectKeys: string[] = [];
        try {
          projectKeys = await readdir(`${USERS_ROOT}/${encodedUserId}/projects/${encodedOwnerType}/${encodedOwnerId}`);
        } catch {
          continue;
        }

        for (const encodedProjectKey of projectKeys) {
          const ownerType = safeDecode(encodedOwnerType);
          const ownerId = safeDecode(encodedOwnerId);
          const projectKey = safeDecode(encodedProjectKey);
          targets.push({
            userId,
            projectKey: `${ownerType}::${ownerId}::${projectKey}`,
          });
        }
      }
    }
  }

  return targets;
}

export function startDocumentTrashCleanupScheduler(
  options: DocumentTrashCleanupSchedulerOptions = {},
): () => void {
  const intervalMs = toPositiveInt(options.intervalMs, DEFAULT_INTERVAL_MS);
  const listTargets = options.listTargets ?? listDocumentTrashCleanupTargets;
  const getSettings = options.getSettings ?? ((userId: string) => generalSettingsStore.get(userId));
  const sweepProject = options.sweepProject
    ?? ((input: { userId: string; projectKey: string; maxAgeDays: number }) => {
      return documentTrashStore.sweepExpired(input);
    });

  let stopped = false;
  let running = false;

  const sweepOnce = async (): Promise<void> => {
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      const targets = await listTargets();
      const settingsCache = new Map<string, { trashAutoCleanupEnabled: boolean; trashAutoCleanupDays: number }>();

      for (const target of targets) {
        let settings = settingsCache.get(target.userId);
        if (!settings) {
          settings = await getSettings(target.userId);
          settingsCache.set(target.userId, settings);
        }
        if (!settings.trashAutoCleanupEnabled) {
          continue;
        }
        await sweepProject({
          userId: target.userId,
          projectKey: target.projectKey,
          maxAgeDays: toPositiveInt(settings.trashAutoCleanupDays, 30),
        });
      }
    } catch (err) {
      console.warn("[trash-cleanup] sweep failed", err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void sweepOnce();
  }, intervalMs);
  timer.unref?.();
  void sweepOnce();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
