import { getConfig } from "../../config.js";
import { generalSettingsStore, type GeneralSettings } from "../general-settings-store.js";
import { parseScopedProjectKey } from "../../project-scope.js";
import { getProjectRoot as getProjectRootPath, resolveProjectLocation } from "../../storage/paths.js";
import { resolveSyncMode } from "../general-settings-auth.js";
import { messageCenterStore } from "../message-center-store.js";
import { buildDocumentCommitMessage } from "./commit-message.js";
import { createSimpleGitRepo, type DocumentGitRepo } from "./git-repo.js";
import type {
  DocumentVersionEvent,
  DocumentVersionPayload,
  DocumentVersionScope,
  RecordDocumentVersionInput,
  SyncMode,
  SyncOnOpenInput,
} from "./types.js";

const DEFAULT_BRANCH = "main";
const DOCUMENT_SYNC_TASK_TYPE = "document-sync";
const DOCUMENT_SYNC_TASK_TITLE = "文档同步";

type ResolveRemoteRepoUrlInput = {
  accessToken: string;
  scope: DocumentVersionScope;
};

type DocumentVersionServiceDeps = {
  gitRepo: DocumentGitRepo;
  getProjectRoot: (userId: string, projectKey: string) => string;
  getGeneralSettings: (userId: string) => Promise<GeneralSettings>;
  resolveRemoteRepoUrl: (input: ResolveRemoteRepoUrlInput) => Promise<string | null>;
  createMessageTask: typeof messageCenterStore.createTask;
  failMessageTask: typeof messageCenterStore.failTask;
  now: () => number;
};

export type RecordDocumentVersionResult = {
  status: "committed" | "skipped";
  syncMode: SyncMode;
  commit?: string;
  synced?: boolean;
};

export type SyncOnOpenResult = {
  status: "queued" | "skipped";
  syncMode: SyncMode;
  synced?: boolean;
};

export type DocumentVersionService = {
  recordVersion(input: RecordDocumentVersionInput): Promise<RecordDocumentVersionResult>;
  syncOnOpen(input: SyncOnOpenInput): Promise<SyncOnOpenResult>;
};

function defaultGetProjectRoot(userId: string, projectKey: string): string {
  const location = resolveProjectLocation(userId, projectKey);
  return getProjectRootPath(
    userId,
    location.ownerId,
    location.ownerType,
    location.ownerProjectKey,
  );
}

async function defaultResolveRemoteRepoUrl(input: ResolveRemoteRepoUrlInput): Promise<string | null> {
  const accessToken = String(input.accessToken ?? "").trim();
  if (!accessToken) {
    return null;
  }

  const config = getConfig();
  const serverUrl = String(config.auth.serverUrl ?? "").trim().replace(/\/+$/, "");
  if (!serverUrl) {
    return null;
  }

  try {
    const response = await fetch(`${serverUrl}/api/projects`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json().catch(() => null) as
      | { data?: { projects?: Array<Record<string, unknown>> } }
      | null;

    const projects = Array.isArray(payload?.data?.projects) ? payload?.data?.projects : [];
    const ownerType = input.scope.ownerType === "team" ? "team" : "personal";
    const matched = projects.find((item) => {
      const key = String(item?.key ?? "").trim();
      const itemOwnerType = String(item?.owner_type ?? item?.ownerType ?? "").trim().toLowerCase();
      const ownerId = String(item?.owner_id ?? item?.ownerId ?? "").trim();
      return key === input.scope.projectKey && itemOwnerType === ownerType && ownerId === input.scope.ownerId;
    });
    const repoUrl = String(matched?.repo_url ?? matched?.repoUrl ?? "").trim();
    return repoUrl || null;
  } catch {
    return null;
  }
}

function normalizeScope(input: { scope?: DocumentVersionScope; projectKey: string }): DocumentVersionScope | null {
  if (input.scope) {
    return input.scope;
  }
  const parsed = parseScopedProjectKey(input.projectKey);
  if (!parsed) {
    return null;
  }
  return {
    ownerType: parsed.ownerType,
    ownerId: parsed.ownerId,
    projectKey: parsed.projectKey,
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  const raw = String(error ?? "").trim();
  return raw || "文档同步失败";
}

function extractDocumentId(payload: DocumentVersionPayload | undefined): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidateKeys = [
    "docId",
    "documentId",
    "id",
  ];
  for (const key of candidateKeys) {
    const value = String((payload as Record<string, unknown>)[key] ?? "").trim();
    if (value) {
      return value;
    }
  }
  const request = payload.request;
  if (request && typeof request === "object") {
    for (const key of candidateKeys) {
      const value = String((request as Record<string, unknown>)[key] ?? "").trim();
      if (value) {
        return value;
      }
    }
  }
  return null;
}

export function createDocumentVersionService(
  deps?: Partial<DocumentVersionServiceDeps>,
): DocumentVersionService {
  const gitRepo = deps?.gitRepo ?? createSimpleGitRepo();
  const getProjectRoot = deps?.getProjectRoot ?? defaultGetProjectRoot;
  const getGeneralSettings = deps?.getGeneralSettings ?? ((userId: string) => generalSettingsStore.get(userId));
  const resolveRemoteRepoUrl = deps?.resolveRemoteRepoUrl ?? defaultResolveRemoteRepoUrl;
  const createMessageTask = deps?.createMessageTask ?? ((input) => messageCenterStore.createTask(input));
  const failMessageTask = deps?.failMessageTask
    ?? ((userId, projectKey, taskId, errorMessage) =>
      messageCenterStore.failTask(userId, projectKey, taskId, errorMessage));
  const now = deps?.now ?? Date.now;

  const queue = new Map<string, Promise<void>>();

  const enqueue = async <T>(queueKey: string, task: () => Promise<T>): Promise<T> => {
    const previous = queue.get(queueKey) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const marker = run.then(() => undefined, () => undefined);
    queue.set(queueKey, marker);
    marker.finally(() => {
      if (queue.get(queueKey) === marker) {
        queue.delete(queueKey);
      }
    });
    return run;
  };

  const resolveMode = async (input: { userId: string; isAuthenticated: boolean }): Promise<SyncMode> => {
    if (!input.isAuthenticated) {
      return "local_only";
    }
    const userId = String(input.userId ?? "").trim();
    if (!userId) {
      return "local_only";
    }
    const settings = await getGeneralSettings(userId);
    return resolveSyncMode({
      isAuthenticated: true,
      documentAutoSync: settings.documentAutoSync,
    });
  };

  const reportSyncFailure = async (input: {
    userId: string;
    projectKey: string;
    syncMode: SyncMode;
    trigger: "sync-on-open" | "record-version";
    error: unknown;
    event?: DocumentVersionEvent;
    payload?: DocumentVersionPayload;
    scope?: DocumentVersionScope;
  }): Promise<void> => {
    const errorMessage = normalizeErrorMessage(input.error);
    const detail: Record<string, unknown> = {
      source: "document-version-service",
      syncMode: input.syncMode,
      trigger: input.trigger,
      occurredAt: new Date(now()).toISOString(),
    };
    if (input.event) {
      detail.event = input.event;
    }
    const docId = extractDocumentId(input.payload);
    if (docId) {
      detail.docId = docId;
    }
    if (input.scope) {
      detail.scope = {
        ownerType: input.scope.ownerType,
        ownerId: input.scope.ownerId,
        projectKey: input.scope.projectKey,
      };
    }

    try {
      const task = await createMessageTask({
        userId: input.userId,
        projectKey: input.projectKey,
        type: DOCUMENT_SYNC_TASK_TYPE,
        title: DOCUMENT_SYNC_TASK_TITLE,
        status: "running",
        progress: {
          current: 1,
          total: 1,
          percent: 100,
          message: "同步失败",
          phase: input.trigger,
        },
        detail,
      });
      await failMessageTask(input.userId, input.projectKey, task.id, errorMessage);
    } catch (reportError) {
      console.warn("[doc-version] failed to report sync failure:", reportError);
    }
  };

  const syncRemoteIfNeeded = async (input: {
    projectRoot: string;
    projectKey: string;
    accessToken?: string;
    scope?: DocumentVersionScope;
    syncMode: SyncMode;
  }): Promise<boolean> => {
    if (input.syncMode !== "remote_enabled") {
      return false;
    }

    const accessToken = String(input.accessToken ?? "").trim();
    if (!accessToken) {
      return false;
    }

    const scope = normalizeScope({
      scope: input.scope,
      projectKey: input.projectKey,
    });
    if (!scope) {
      return false;
    }

    if (!(await gitRepo.hasCommits(input.projectRoot))) {
      return false;
    }

    const remoteUrl = await resolveRemoteRepoUrl({
      accessToken,
      scope,
    });
    if (!remoteUrl) {
      return false;
    }

    await gitRepo.ensureRemote(input.projectRoot, remoteUrl);

    const tagName = `backup/pre-force-${now()}`;
    try {
      await gitRepo.createTag(input.projectRoot, tagName);
    } catch {
      // Ignore backup tag failures; do not block sync.
    }
    await gitRepo.pushForceWithLease(input.projectRoot, DEFAULT_BRANCH);
    return true;
  };

  return {
    async recordVersion(input: RecordDocumentVersionInput): Promise<RecordDocumentVersionResult> {
      const queueKey = String(input.projectKey ?? "").trim();
      return enqueue(queueKey, async () => {
        const projectRoot = getProjectRoot(input.userId, input.projectKey);
        await gitRepo.ensureRepository(projectRoot);
        await gitRepo.add(projectRoot, ["docs"]);

        const hasChanges = await gitRepo.hasChanges(projectRoot);
        const syncMode = await resolveMode({
          userId: input.userId,
          isAuthenticated: input.isAuthenticated,
        });

        if (!hasChanges) {
          return {
            status: "skipped",
            syncMode,
          };
        }

        const message = buildDocumentCommitMessage(input.event, input.payload);
        const commit = await gitRepo.commit(projectRoot, message);
        let synced = false;
        try {
          synced = await syncRemoteIfNeeded({
            projectRoot,
            projectKey: input.projectKey,
            accessToken: input.accessToken,
            scope: input.scope,
            syncMode,
          });
        } catch (error) {
          await reportSyncFailure({
            userId: input.userId,
            projectKey: input.projectKey,
            syncMode,
            trigger: "record-version",
            error,
            event: input.event,
            payload: input.payload,
            scope: input.scope,
          });
          throw error;
        }

        return {
          status: "committed",
          syncMode,
          commit,
          synced,
        };
      });
    },

    async syncOnOpen(input: SyncOnOpenInput): Promise<SyncOnOpenResult> {
      const queueKey = String(input.projectKey ?? "").trim();
      return enqueue(queueKey, async () => {
        const projectRoot = getProjectRoot(input.userId, input.projectKey);
        await gitRepo.ensureRepository(projectRoot);

        const syncMode = await resolveMode({
          userId: input.userId,
          isAuthenticated: input.isAuthenticated,
        });
        let synced = false;
        try {
          synced = await syncRemoteIfNeeded({
            projectRoot,
            projectKey: input.projectKey,
            accessToken: input.accessToken,
            scope: input.scope,
            syncMode,
          });
        } catch (error) {
          await reportSyncFailure({
            userId: input.userId,
            projectKey: input.projectKey,
            syncMode,
            trigger: "sync-on-open",
            error,
            scope: input.scope,
          });
          throw error;
        }

        return {
          status: synced ? "queued" : "skipped",
          syncMode,
          synced,
        };
      });
    },
  };
}

export const documentVersionService = createDocumentVersionService();
