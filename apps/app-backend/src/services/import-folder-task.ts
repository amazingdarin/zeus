import path from "node:path";
import { v4 as uuidv4 } from "uuid";

import { traceManager, type TraceContext } from "../observability/index.js";
import { documentStore } from "../storage/document-store.js";
import type { Document } from "../storage/types.js";
import { knowledgeSearch } from "../knowledge/search.js";
import { pluginManagerV2 } from "../plugins-v2/index.js";
import { importFileAsDocument, type SmartImportType } from "./smart-import.js";
import { messageCenterStore } from "./message-center-store.js";

type ImportFolderFile = {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size?: number;
};

export type ImportFolderRequest = {
  parent_id?: string;
  smart_import?: boolean;
  smart_import_types?: SmartImportType[];
  enable_format_optimize?: boolean;
};

export type ImportFolderResult = {
  directories: number;
  files: number;
  skipped: number;
  converted: number;
  fallback: number;
};

type ImportFolderTaskOptions = {
  traceContext?: TraceContext;
  hook?: {
    requestId: string;
    payload: Record<string, unknown>;
  };
};

type DirectoryEntry = {
  path: string;
  name: string;
  parentPath: string | null;
  depth: number;
};

type FileEntry = {
  file: ImportFolderFile;
  path: string;
  name: string;
  parentPath: string | null;
};

type ImportFolderProgress = {
  phase: "scan" | "folders" | "import";
  processed?: number;
  total?: number;
  message?: string;
};

const PROGRESS_THROTTLE_MS = 500;

const pluginManager = pluginManagerV2;

const normalizeRelativePath = (value: string): string => {
  let normalized = String(value ?? "").replace(/\\/g, "/").trim();
  normalized = normalized.replace(/^[a-zA-Z]:/, "");
  normalized = normalized.replace(/^\/+/, "");
  const parts = normalized
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
  return parts.join("/");
};

const buildFolderEntries = (
  files: ImportFolderFile[],
): { directories: DirectoryEntry[]; files: FileEntry[] } => {
  const directoryMap = new Map<string, DirectoryEntry>();
  const fileEntries: FileEntry[] = [];

  for (const file of files) {
    const relativePath = normalizeRelativePath(file.originalname || "");
    const safePath = relativePath || normalizeRelativePath(path.basename(file.originalname || ""));
    if (!safePath) {
      continue;
    }
    const segments = safePath.split("/").filter(Boolean);
    if (segments.length === 0) {
      continue;
    }
    const fileName = segments[segments.length - 1];
    let parentPath: string | null = null;

    if (segments.length > 1) {
      const dirSegments = segments.slice(0, -1);
      for (let i = 0; i < dirSegments.length; i += 1) {
        const dirPath = dirSegments.slice(0, i + 1).join("/");
        if (!directoryMap.has(dirPath)) {
          directoryMap.set(dirPath, {
            path: dirPath,
            name: dirSegments[i],
            parentPath: i > 0 ? dirSegments.slice(0, i).join("/") : null,
            depth: i,
          });
        }
      }
      parentPath = dirSegments.join("/");
    }

    fileEntries.push({
      file,
      path: safePath,
      name: fileName,
      parentPath,
    });
  }

  const directories = Array.from(directoryMap.values()).sort((a, b) => {
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    return a.path.localeCompare(b.path);
  });
  const sortedFiles = fileEntries.sort((a, b) => a.path.localeCompare(b.path));
  return { directories, files: sortedFiles };
};

const createFolder = async (
  userId: string,
  projectKey: string,
  title: string,
  parentId: string,
): Promise<string> => {
  const doc: Document = {
    meta: {
      id: uuidv4(),
      schema_version: "v1",
      title,
      slug: "",
      path: "",
      parent_id: parentId,
      created_at: "",
      updated_at: "",
      extra: {
        status: "draft",
        tags: [],
        doc_type: "folder",
      },
    },
    body: {
      type: "tiptap",
      content: { type: "doc", content: [] },
    },
  };

  const saved = await documentStore.save(userId, projectKey, doc);
  knowledgeSearch.indexDocument(userId, projectKey, saved).catch((err) => {
    console.error("Index error:", err);
  });
  return saved.meta.id;
};

const createProgressThrottler = (
  handler: (progress: ImportFolderProgress) => void,
): ((progress: ImportFolderProgress) => void) => {
  let lastEmitted = 0;
  let pending: ImportFolderProgress | null = null;
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

  return (progress: ImportFolderProgress) => {
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

const stripExtension = (filename: string): string => {
  const base = filename.trim();
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return base;
  return base.slice(0, idx);
};

const runImportFolderTask = async (
  userId: string,
  projectKey: string,
  taskId: string,
  req: ImportFolderRequest,
  files: ImportFolderFile[],
  options?: ImportFolderTaskOptions,
) => {
  let finished = false;

  await messageCenterStore.updateTaskProgress(userId, projectKey, taskId, {
    status: "running",
    message: "任务已开始",
    phase: "start",
    percent: 0,
  });

  const throttledProgress = createProgressThrottler((progress) => {
    if (finished) {
      return;
    }
    void messageCenterStore.updateTaskProgress(userId, projectKey, taskId, {
      status: "running",
      current: progress.processed,
      total: progress.total,
      percent:
        typeof progress.total === "number" && progress.total > 0 && typeof progress.processed === "number"
          ? Math.min(100, Math.max(0, Math.round((progress.processed / progress.total) * 100)))
          : undefined,
      message: progress.message,
      phase: progress.phase,
    });
  });

  const result: ImportFolderResult = {
    directories: 0,
    files: 0,
    skipped: 0,
    converted: 0,
    fallback: 0,
  };

  try {
    const { directories, files: fileEntries } = buildFolderEntries(files);
    const totalItems = directories.length + fileEntries.length;

    throttledProgress({
      phase: "scan",
      message: `扫描到 ${directories.length} 个目录，${fileEntries.length} 个文件`,
      total: totalItems,
      processed: 0,
    });

    const directoryIds = new Map<string, string>();
    const baseParentId = String(req.parent_id ?? "root");
    let processed = 0;

    for (const directory of directories) {
      const parentId = directory.parentPath
        ? directoryIds.get(directory.parentPath) ?? baseParentId
        : baseParentId;
      const createdId = await createFolder(userId, projectKey, directory.name, parentId);
      directoryIds.set(directory.path, createdId);
      processed += 1;
      result.directories += 1;
      throttledProgress({
        phase: "folders",
        message: `创建目录 ${directory.name}`,
        total: totalItems,
        processed,
      });
    }

    const selectedSmartImportTypes = (req.smart_import_types ?? []).filter(
      (t): t is SmartImportType => t === "markdown" || t === "word" || t === "pdf" || t === "image",
    );

    for (const entry of fileEntries) {
      const parentId = entry.parentPath
        ? directoryIds.get(entry.parentPath) ?? baseParentId
        : baseParentId;
      try {
        const imported = await importFileAsDocument(userId, projectKey, {
          parentId,
          title: stripExtension(entry.name) || entry.name,
          file: {
            buffer: entry.file.buffer,
            originalname: entry.name,
            mimetype: entry.file.mimetype,
            size: entry.file.size,
          },
          smartImport: req.smart_import === true,
          smartImportTypes: selectedSmartImportTypes,
          enableFormatOptimize: req.smart_import === true && req.enable_format_optimize === true,
          traceContext: options?.traceContext,
          traceMetadata: {
            relativePath: entry.path,
          },
        });
        if (imported.mode === "smart") {
          result.converted += 1;
        } else {
          result.fallback += 1;
        }
      } catch (err) {
        console.error("Import failed:", err);
        result.fallback += 1;
      }
      processed += 1;
      result.files += 1;
      throttledProgress({
        phase: "import",
        message: `导入文件 ${entry.name}`,
        total: totalItems,
        processed,
      });
    }

    finished = true;

    await messageCenterStore.updateTaskProgress(userId, projectKey, taskId, {
      message: "导入完成",
      phase: "completed",
      percent: 100,
      current: totalItems,
      total: totalItems,
    });

    await messageCenterStore.completeTask(userId, projectKey, taskId, {
      result,
    });

    if (options?.hook) {
      pluginManager.dispatchAfterHooks({
        userId,
        projectKey,
        event: "document.import",
        payload: {
          request: options.hook.payload,
          result,
          source: "folder",
        },
        requestId: options.hook.requestId,
      });
    }

    if (options?.traceContext) {
      traceManager.updateTrace(options.traceContext, { output: result });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    finished = true;
    await messageCenterStore.failTask(userId, projectKey, taskId, message);
    if (options?.traceContext) {
      traceManager.updateTrace(options.traceContext, { output: { error: message } });
    }
  } finally {
    if (options?.traceContext) {
      traceManager.endTrace(options.traceContext.traceId);
    }
  }
};

export const createImportFolderTask = async (
  userId: string,
  projectKey: string,
  req: ImportFolderRequest,
  files: ImportFolderFile[],
  options?: ImportFolderTaskOptions,
): Promise<{ taskId: string }> => {
  const task = await messageCenterStore.createTask({
    userId,
    projectKey,
    type: "import-folder",
    title: "文件夹导入",
    status: "pending",
    progress: { percent: 0 },
    detail: {
      request: {
        parent_id: req.parent_id,
        smart_import: req.smart_import,
        smart_import_types: req.smart_import_types,
        enable_format_optimize: req.enable_format_optimize,
        file_count: files.length,
      },
      progress: {
        message: "等待执行",
        phase: "pending",
      },
    },
  });

  void runImportFolderTask(userId, projectKey, task.id, req, files, options).catch((err) => {
    console.error("[import-folder-task] failed to run task", err);
  });

  return { taskId: task.id };
};
