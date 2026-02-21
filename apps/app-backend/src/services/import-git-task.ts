import { traceManager, type TraceContext } from "../observability/index.js";
import { pluginManagerV2 } from "../plugins-v2/index.js";
import {
  importGit,
  importGitSubmodule,
  type ImportGitProgress,
  type ImportGitRequest,
  type ImportGitResult,
} from "./import-git.js";
import { messageCenterStore } from "./message-center-store.js";

const pluginManager = pluginManagerV2;

const PROGRESS_THROTTLE_MS = 500;
const TASK_TIMEOUT_MS = 60 * 60 * 1000;

const buildRepoName = (repoUrl: string): string => {
  let url = String(repoUrl ?? "").trim().replace(/\.git$/, "");
  url = url.replace(/\/$/, "");
  const segments = url.split("/");
  return segments[segments.length - 1] || "git-import";
};

const buildTaskTitle = (repoUrl: string): string => {
  const name = buildRepoName(repoUrl);
  return `Git 导入: ${name}`;
};

type ImportGitTaskOptions = {
  traceContext?: TraceContext;
  hook?: {
    requestId: string;
    payload: Record<string, unknown>;
  };
};

type ProgressHandler = (progress: ImportGitProgress) => void;

const createProgressThrottler = (
  handler: ProgressHandler,
): ProgressHandler => {
  let lastEmitted = 0;
  let pending: ImportGitProgress | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (!pending) {
      return;
    }
    const payload = pending;
    pending = null;
    lastEmitted = Date.now();
    handler(payload);
  };

  return (progress: ImportGitProgress) => {
    pending = progress;
    const now = Date.now();
    const elapsed = now - lastEmitted;
    if (elapsed >= PROGRESS_THROTTLE_MS) {
      flush();
      return;
    }

    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, PROGRESS_THROTTLE_MS - elapsed);
    }
  };
};

const computePercent = (progress: ImportGitProgress): number | undefined => {
  if (typeof progress.percent === "number") {
    return progress.percent;
  }
  if (typeof progress.total === "number" && progress.total > 0) {
    const processed = typeof progress.processed === "number" ? progress.processed : 0;
    return Math.min(100, Math.max(0, Math.round((processed / progress.total) * 100)));
  }
  return undefined;
};

const updateTaskProgress = async (
  userId: string,
  projectKey: string,
  taskId: string,
  progress: ImportGitProgress,
) => {
  const percent = computePercent(progress);
  await messageCenterStore.updateTaskProgress(userId, projectKey, taskId, {
    status: "running",
    current: progress.processed,
    total: progress.total,
    percent,
    message: progress.message,
    phase: progress.phase,
  });
};

const runImportGitTask = async (
  userId: string,
  projectKey: string,
  taskId: string,
  req: ImportGitRequest,
  options?: ImportGitTaskOptions,
) => {
  let finished = false;
  let timedOut = false;
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutMessage = "任务超时（1小时）";

  const triggerTimeout = async () => {
    if (finished || timedOut) {
      return;
    }
    timedOut = true;
    finished = true;
    await messageCenterStore.failTask(userId, projectKey, taskId, timeoutMessage);
    if (options?.traceContext) {
      traceManager.updateTrace(options.traceContext, { output: { error: timeoutMessage } });
    }
  };

  await messageCenterStore.updateTaskProgress(userId, projectKey, taskId, {
    status: "running",
    message: "任务已开始",
    phase: "start",
    percent: 0,
  });

  timeoutHandle = setTimeout(() => {
    void triggerTimeout();
  }, TASK_TIMEOUT_MS);

  const throttledProgress = createProgressThrottler((progress) => {
    if (finished || timedOut) {
      return;
    }
    void updateTaskProgress(userId, projectKey, taskId, progress);
  });

  let result: ImportGitResult | null = null;

  try {
    const isSubmoduleImport = Boolean(req.submodule_parent_repo && req.submodule_path);
    if (isSubmoduleImport) {
      result = await importGitSubmodule(userId, projectKey, req, options?.traceContext, {
        onProgress: throttledProgress,
      });
    } else {
      result = await importGit(userId, projectKey, req, options?.traceContext, {
        onProgress: throttledProgress,
      });
    }

    if (timedOut) {
      return;
    }

    await messageCenterStore.updateTaskProgress(userId, projectKey, taskId, {
      message: "导入完成",
      phase: "completed",
      percent: 100,
      current: result.files,
      total: result.files,
    });

    finished = true;

  await messageCenterStore.completeTask(userId, projectKey, taskId, {
    result: {
      directories: result.directories,
      files: result.files,
      skipped: result.skipped,
      converted: result.converted,
      fallback: result.fallback,
      root_folder_id: result.root_folder_id,
      submodules: result.submodules,
      resolved_branch: result.resolved_branch,
    },
  });

    if (req.auto_import_submodules && result.submodules && result.submodules.length > 0) {
      const parentRepo = String(req.repo_url ?? "").trim();
      const parentId = result.root_folder_id ?? req.parent_id ?? "root";
      const parentBranch = result.resolved_branch || req.branch;
      const seen = new Set<string>();
      for (const submodule of result.submodules) {
        const path = typeof submodule.path === "string" ? submodule.path.trim() : "";
        const url = typeof submodule.url === "string" ? submodule.url.trim() : "";
        if (!path || !url) {
          continue;
        }
        const dedupeKey = `${path}::${url}`;
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);
        try {
          await createImportGitTask(userId, projectKey, {
            repo_url: url,
            parent_id: parentId,
            submodule_parent_repo: parentRepo,
            submodule_parent_branch: parentBranch,
            submodule_path: path,
            smart_import: req.smart_import,
            smart_import_types: req.smart_import_types,
            file_types: req.file_types,
            enable_format_optimize: req.enable_format_optimize,
            auto_import_submodules: false,
          });
        } catch (err) {
          console.warn("[import-git-task] auto submodule task failed", err);
        }
      }
    }

    if (options?.hook) {
      pluginManager.dispatchAfterHooks({
        userId,
        projectKey,
        event: "document.import",
        payload: {
          request: options.hook.payload,
          result: {
            directories: result.directories,
            files: result.files,
            skipped: result.skipped,
            converted: result.converted,
            fallback: result.fallback,
          },
          source: "git",
        },
        requestId: options.hook.requestId,
      });
    }

    if (options?.traceContext) {
      traceManager.updateTrace(options.traceContext, { output: result });
    }
  } catch (err) {
    if (timedOut) {
      return;
    }
    const message = err instanceof Error ? err.message : "Import failed";
    finished = true;
    await messageCenterStore.failTask(userId, projectKey, taskId, message);
    if (options?.traceContext) {
      traceManager.updateTrace(options.traceContext, { output: { error: message } });
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    if (options?.traceContext) {
      traceManager.endTrace(options.traceContext.traceId);
    }
  }
};

export const createImportGitTask = async (
  userId: string,
  projectKey: string,
  req: ImportGitRequest,
  options?: ImportGitTaskOptions,
): Promise<{ taskId: string }> => {
  const task = await messageCenterStore.createTask({
    userId,
    projectKey,
    type: "import-git",
    title: buildTaskTitle(req.repo_url || ""),
    status: "pending",
    progress: { percent: 0 },
    detail: {
      request: {
        repo_url: req.repo_url,
        branch: req.branch,
        subdir: req.subdir,
        parent_id: req.parent_id,
        submodule_parent_repo: req.submodule_parent_repo,
        submodule_parent_branch: req.submodule_parent_branch,
        submodule_path: req.submodule_path,
        auto_import_submodules: req.auto_import_submodules,
        smart_import: req.smart_import,
        smart_import_types: req.smart_import_types,
        file_types: req.file_types,
        enable_format_optimize: req.enable_format_optimize,
      },
      progress: {
        message: "等待执行",
        phase: "pending",
      },
    },
  });

  void runImportGitTask(userId, projectKey, task.id, req, options).catch((err) => {
    console.error("[import-git-task] failed to run task", err);
  });

  return { taskId: task.id };
};
