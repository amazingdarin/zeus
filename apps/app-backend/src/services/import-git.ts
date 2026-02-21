import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { simpleGit } from "simple-git";
import { v4 as uuidv4 } from "uuid";

import { traceManager, type TraceContext } from "../observability/index.js";
import { documentStore } from "../storage/document-store.js";
import { knowledgeSearch } from "../knowledge/search.js";
import type { Document } from "../storage/types.js";
import { importFileAsDocument } from "./smart-import.js";

export type SmartImportType = "markdown" | "word" | "pdf" | "image";
export type FileTypeFilter = "all" | "images" | "office" | "text" | "markdown";

export type ImportGitRequest = {
  repo_url?: string;
  branch?: string;
  subdir?: string;
  parent_id?: string;
  submodule_parent_repo?: string;
  submodule_parent_branch?: string;
  submodule_path?: string;
  auto_import_submodules?: boolean;
  // Options for Smart Import
  smart_import?: boolean;
  smart_import_types?: SmartImportType[];
  file_types?: FileTypeFilter[];
  // Enable format optimization using LLM (optional, fail-safe)
  enable_format_optimize?: boolean;
};

export type GitSubmoduleInfo = {
  name?: string;
  path?: string;
  url?: string;
  branch?: string;
};

export type ImportGitResult = {
  directories: number;
  files: number;
  skipped: number;
  converted: number;
  fallback: number;
  root_folder_id?: string;
  submodules?: GitSubmoduleInfo[];
  resolved_branch?: string;
};

export type ImportGitProgress = {
  phase: "clone" | "scan" | "folders" | "import";
  processed?: number;
  total?: number;
  percent?: number;
  message?: string;
};

export type ImportGitOptions = {
  onProgress?: (progress: ImportGitProgress) => void | Promise<void>;
};

type DirectoryEntry = {
  path: string;
  parent: string | null;
  name: string;
  depth: number;
};

type FileEntry = {
  fullPath: string;
  relativePath: string;
  parent: string | null;
  name: string;
  ext: string;
};

const MAX_FILES = 2000;
const MAX_BYTES = 2 * 1024 * 1024;

// File extension categories
const FILE_TYPE_EXTENSIONS: Record<FileTypeFilter, string[]> = {
  all: [],
  images: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
  office: ["docx", "pptx", "xlsx", "pdf"],
  text: ["txt", "csv", "json", "yaml", "yml", "log"],
  markdown: ["md", "markdown"],
};

// MIME type mapping
const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  yaml: "application/x-yaml",
  yml: "application/x-yaml",
  log: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};

const parseGitmodules = (content: string, defaultBranch?: string): GitSubmoduleInfo[] => {
  const lines = content.split(/\r?\n/);
  const results: GitSubmoduleInfo[] = [];
  let current: GitSubmoduleInfo | null = null;

  const pushCurrent = () => {
    if (!current) return;
    if (current.url || current.path) {
      results.push(current);
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      pushCurrent();
      const match = line.match(/submodule\s+\"([^\"]+)\"/i);
      current = match ? { name: match[1] } : {};
      continue;
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1 || !current) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim().toLowerCase();
    const value = line.slice(eqIndex + 1).trim();
    if (!value) {
      continue;
    }
    if (key === "path") current.path = value;
    if (key === "url") current.url = value;
    if (key === "branch") current.branch = value;
  }

  pushCurrent();
  return results
    .filter((item) => item.url)
    .map((item) => ({
      ...item,
      branch: item.branch || defaultBranch,
    }));
};

const readGitmodules = async (
  repoDir: string,
  defaultBranch?: string,
): Promise<GitSubmoduleInfo[]> => {
  try {
    const raw = await readFile(path.join(repoDir, ".gitmodules"), "utf8");
    return parseGitmodules(raw, defaultBranch);
  } catch {
    return [];
  }
};

const resolveRemoteDefaultBranch = async (
  git: ReturnType<typeof simpleGit>,
  repoUrl: string,
): Promise<string | null> => {
  try {
    const output = await git.listRemote([repoUrl, "--symref", "HEAD"]);
    const match = output.match(/ref:\s+refs\/heads\/([^\t\n]+)\s+HEAD/);
    if (match && match[1]) {
      return match[1];
    }
  } catch {
    // ignore
  }
  return null;
};

const updateSubmoduleInRepo = async (
  repoDir: string,
  submodulePath: string,
): Promise<void> => {
  const repoGit = simpleGit(repoDir);
  await repoGit.raw(["submodule", "update", "--init", "--recursive", submodulePath]);
};

/**
 * Build the set of allowed extensions from file type filters
 */
const buildAllowedExtensions = (fileTypes: FileTypeFilter[]): Set<string> | null => {
  if (!fileTypes || fileTypes.length === 0 || fileTypes.includes("all")) {
    return null; // null means all extensions allowed
  }
  const extensions = new Set<string>();
  for (const type of fileTypes) {
    const exts = FILE_TYPE_EXTENSIONS[type];
    if (exts) {
      for (const ext of exts) {
        extensions.add(ext);
      }
    }
  }
  return extensions;
};

/**
 * Check if a file extension is allowed
 */
const isExtensionAllowed = (ext: string, allowedExtensions: Set<string> | null): boolean => {
  if (!allowedExtensions) return true;
  return allowedExtensions.has(ext.toLowerCase());
};

/**
 * Collect all parent directory paths for a file
 */
const collectParentPaths = (filePath: string | null): string[] => {
  const paths: string[] = [];
  let current = filePath;
  while (current) {
    paths.push(current);
    const parentPath = path.dirname(current);
    current = parentPath === "." || parentPath === current ? null : parentPath;
  }
  return paths;
};

/**
 * Extract repository name from Git URL
 */
const extractRepoName = (repoUrl: string): string => {
  // Remove trailing .git if present
  let url = repoUrl.trim().replace(/\.git$/, "");
  // Remove trailing slash
  url = url.replace(/\/$/, "");
  // Extract the last path segment
  const segments = url.split("/");
  const name = segments[segments.length - 1] || "git-import";
  return name;
};

const sanitizeRepoUrlForTrace = (repoUrl: string): string => {
  const trimmed = repoUrl.trim();
  try {
    const u = new URL(trimmed);
    // Avoid logging credentials to observability backends.
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
    }
    return u.toString();
  } catch {
    // Best-effort: remove anything like https://user:pass@host/...
    return trimmed.replace(/\/\/[^@]*@/, "//");
  }
};

type ImportDirectoryOptions = {
  userId: string;
  projectKey: string;
  baseDir: string;
  parentId: string;
  repoName: string;
  allowedExtensions: Set<string> | null;
  smartImport: boolean;
  smartImportTypes: Set<SmartImportType>;
  enableFormatOptimize: boolean;
  traceContext?: TraceContext;
  emitProgress?: (progress: ImportGitProgress) => Promise<void>;
  traceMetadataBase?: Record<string, unknown>;
  skipRootFolder?: boolean;
};

const ensureFolderPath = async (
  userId: string,
  projectKey: string,
  parentId: string,
  relativePath: string,
): Promise<string> => {
  const segments = relativePath
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  let currentId = parentId;
  for (const segment of segments) {
    const children = await documentStore.getChildren(userId, projectKey, currentId);
    const existing = children.find((child) => child.kind === "dir" && child.title === segment);
    if (existing) {
      currentId = existing.id;
      continue;
    }
    currentId = await createFolder(userId, projectKey, segment, currentId);
  }
  return currentId;
};

const importFromDirectory = async (options: ImportDirectoryOptions): Promise<ImportGitResult> => {
  const emitProgress = options.emitProgress ?? (async () => undefined);
  const result: ImportGitResult = {
    directories: 0,
    files: 0,
    skipped: 0,
    converted: 0,
    fallback: 0,
  };

  await emitProgress({ phase: "scan", message: "Scanning repository" });
  const scanSpan = options.traceContext
    ? traceManager.startSpan(options.traceContext, "scan-entries", {
        subdir: ".",
      })
    : null;
  const scanStart = Date.now();
  const { directories, files } = await scanEntries(options.baseDir);
  if (scanSpan) {
    traceManager.endSpan(scanSpan, {
      durationMs: Date.now() - scanStart,
      directoryCount: directories.length,
      fileCount: files.length,
    });
  }
  await emitProgress({
    phase: "scan",
    message: `Found ${files.length} files`,
    total: files.length,
  });

  // Step 1: Filter files by allowed extensions
  const filteredFiles: FileEntry[] = [];
  for (const file of files) {
    if (!isExtensionAllowed(file.ext, options.allowedExtensions)) {
      result.skipped += 1;
      continue;
    }
    filteredFiles.push(file);
  }

  // Step 2: Collect all directories that contain filtered files
  const requiredDirs = new Set<string>();
  for (const file of filteredFiles) {
    const parentPaths = collectParentPaths(file.parent);
    for (const p of parentPaths) {
      requiredDirs.add(p);
    }
  }

  // Step 3: Filter directories to only include those with matching files
  const filteredDirs = directories.filter((dir) => requiredDirs.has(dir.path));

  // Step 4: Create directories
  const directoryMap = new Map<string, string>();
  let rootParentId = options.parentId;
  let repoFolderId: string | null = null;
  const includeRootFolder = !options.skipRootFolder && filteredFiles.length > 0;

  const foldersSpan = options.traceContext
    ? traceManager.startSpan(options.traceContext, "create-folders", {
        repoName: options.repoName,
        filteredDirCount: filteredDirs.length,
        hasFiles: filteredFiles.length > 0,
      })
    : null;
  const foldersStart = Date.now();
  try {
    if (includeRootFolder) {
      repoFolderId = await createFolder(options.userId, options.projectKey, options.repoName, options.parentId);
      directoryMap.set(".", repoFolderId);
      rootParentId = repoFolderId;
      result.directories += 1;
    } else {
      directoryMap.set(".", rootParentId);
    }

    await emitProgress({
      phase: "folders",
      message: "Creating folders",
      total: filteredDirs.length + (includeRootFolder ? 1 : 0),
      processed: 0,
    });

    for (const dir of filteredDirs) {
      const parentKey = dir.parent ?? ".";
      const resolvedParent =
        parentKey === "." ? rootParentId : (directoryMap.get(parentKey) ?? rootParentId);
      const folderId = await createFolder(options.userId, options.projectKey, dir.name, resolvedParent);
      directoryMap.set(dir.path, folderId);
      result.directories += 1;
      await emitProgress({
        phase: "folders",
        message: `Creating ${dir.name}`,
        total: filteredDirs.length + (includeRootFolder ? 1 : 0),
        processed: result.directories,
      });
    }

    if (foldersSpan) {
      traceManager.endSpan(foldersSpan, {
        durationMs: Date.now() - foldersStart,
        created: result.directories,
      });
    }
    await emitProgress({
      phase: "folders",
      message: "Folders created",
      total: filteredDirs.length + (includeRootFolder ? 1 : 0),
      processed: result.directories,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (foldersSpan) {
      traceManager.endSpan(
        foldersSpan,
        {
          durationMs: Date.now() - foldersStart,
          created: result.directories,
          error: msg,
        },
        "ERROR",
      );
    }
    throw err;
  }

  // Step 5: Import files
  const importSpan = options.traceContext
    ? traceManager.startSpan(options.traceContext, "import-files", {
        fileCount: filteredFiles.length,
        smartImport: options.smartImport,
        smartImportTypes: Array.from(options.smartImportTypes),
        enableFormatOptimize: options.enableFormatOptimize,
        limits: { maxFiles: MAX_FILES, maxBytes: MAX_BYTES },
      })
    : null;
  const importStart = Date.now();
  try {
    let processed = 0;
    const total = filteredFiles.length;
    await emitProgress({
      phase: "import",
      message: total > 0 ? "Importing files" : "No files to import",
      processed,
      total,
      percent: total > 0 ? 0 : 100,
    });

    for (const file of filteredFiles) {
      if (result.files >= MAX_FILES) {
        result.skipped += 1;
        processed += 1;
        await emitProgress({
          phase: "import",
          message: `Skipped ${file.relativePath} (limit reached)`,
          processed,
          total,
          percent: total > 0 ? Math.round((processed / total) * 100) : 100,
        });
        continue;
      }

      const info = await stat(file.fullPath);
      if (info.size > MAX_BYTES) {
        result.skipped += 1;
        processed += 1;
        await emitProgress({
          phase: "import",
          message: `Skipped ${file.relativePath} (too large)`,
          processed,
          total,
          percent: total > 0 ? Math.round((processed / total) * 100) : 100,
        });
        continue;
      }

      const content = await readFile(file.fullPath);
      const resolvedParent = file.parent
        ? (directoryMap.get(file.parent) ?? rootParentId)
        : rootParentId;

      const mime = EXT_TO_MIME[file.ext.toLowerCase()] ?? "application/octet-stream";
      const originalname = file.ext ? `${file.name}.${file.ext}` : file.name;
      const imported = await importFileAsDocument(options.userId, options.projectKey, {
        parentId: resolvedParent,
        title: file.name,
        file: {
          buffer: content,
          originalname,
          mimetype: mime,
          size: info.size,
        },
        smartImport: options.smartImport,
        smartImportTypes: Array.from(options.smartImportTypes),
        enableFormatOptimize: options.enableFormatOptimize,
        traceContext: options.traceContext,
        traceMetadata: {
          source: "git",
          ...(options.traceMetadataBase ?? {}),
          relativePath: file.relativePath,
        },
      });

      if (imported.mode === "smart") {
        result.converted += 1;
      } else {
        result.fallback += 1;
      }
      result.files += 1;
      processed += 1;
      await emitProgress({
        phase: "import",
        message: `Imported ${file.relativePath}`,
        processed,
        total,
        percent: total > 0 ? Math.round((processed / total) * 100) : 100,
      });
    }

    if (importSpan) {
      traceManager.endSpan(importSpan, {
        durationMs: Date.now() - importStart,
        files: result.files,
        skipped: result.skipped,
        converted: result.converted,
        fallback: result.fallback,
      });
    }
    await emitProgress({
      phase: "import",
      message: "Import completed",
      processed: filteredFiles.length,
      total: filteredFiles.length,
      percent: filteredFiles.length > 0 ? 100 : 100,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (importSpan) {
      traceManager.endSpan(
        importSpan,
        {
          durationMs: Date.now() - importStart,
          files: result.files,
          skipped: result.skipped,
          converted: result.converted,
          fallback: result.fallback,
          error: msg,
        },
        "ERROR",
      );
    }
    throw err;
  }

  if (repoFolderId) {
    result.root_folder_id = repoFolderId;
  }

  return result;
};

export const importGit = async (
  userId: string,
  projectKey: string,
  req: ImportGitRequest,
  traceContext?: TraceContext,
  options?: ImportGitOptions,
): Promise<ImportGitResult> => {
  const repoUrl = String(req.repo_url ?? "").trim();
  if (!repoUrl.startsWith("http://") && !repoUrl.startsWith("https://")) {
    throw new Error("repo_url must be http or https");
  }

  const requestedBranch = String(req.branch ?? "main").trim() || "main";
  const explicitBranch = typeof req.branch === "string" && req.branch.trim().length > 0;
  let resolvedBranch = requestedBranch;
  const subdir = String(req.subdir ?? "").trim();
  const parentId = String(req.parent_id ?? "root");
  const smartImport = req.smart_import ?? false;
  const smartImportTypes = new Set<SmartImportType>(req.smart_import_types ?? []);
  const allowedExtensions = buildAllowedExtensions(req.file_types ?? []);
  const enableFormatOptimize = req.enable_format_optimize ?? false;
  const repoUrlForTrace = sanitizeRepoUrlForTrace(repoUrl);

  const tempDir = path.join(process.cwd(), ".tmp", `git-import-${uuidv4()}`);
  await mkdir(tempDir, { recursive: true });

  const emitProgress = async (progress: ImportGitProgress) => {
    if (!options?.onProgress) {
      return;
    }
    try {
      await options.onProgress(progress);
    } catch (err) {
      console.warn("[import-git] progress callback error:", err);
    }
  };

  try {
    const git = simpleGit();
    let submodules: GitSubmoduleInfo[] = [];

    if (!explicitBranch) {
      const defaultBranch = await resolveRemoteDefaultBranch(git, repoUrl);
      if (defaultBranch) {
        resolvedBranch = defaultBranch;
      }
    }

    await emitProgress({ phase: "clone", message: "Cloning repository" });
    const cloneSpan = traceContext
      ? traceManager.startSpan(traceContext, "git-clone", {
          repo_url: repoUrlForTrace,
          branch: resolvedBranch,
          depth: 1,
        })
      : null;
    const cloneStart = Date.now();
    try {
      await git.clone(repoUrl, tempDir, ["--depth=1", "--branch", resolvedBranch]);
      if (cloneSpan) {
        traceManager.endSpan(cloneSpan, { durationMs: Date.now() - cloneStart });
      }
      await emitProgress({ phase: "clone", message: "Clone completed" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cloneSpan) {
        traceManager.endSpan(
          cloneSpan,
          { durationMs: Date.now() - cloneStart, error: msg },
          "ERROR",
        );
      }
      if (!explicitBranch && requestedBranch === "main") {
        // Retry with master branch for legacy repos.
        resolvedBranch = "master";
        await emitProgress({ phase: "clone", message: "Retrying with master branch" });
        await git.clone(repoUrl, tempDir, ["--depth=1", "--branch", resolvedBranch]);
      } else {
        throw err;
      }
    }

    submodules = await readGitmodules(tempDir, resolvedBranch);

    const baseDir = subdir ? path.join(tempDir, subdir) : tempDir;
    const repoName = extractRepoName(repoUrl);
    const result = await importFromDirectory({
      userId,
      projectKey,
      baseDir,
      parentId,
      repoName,
      allowedExtensions,
      smartImport,
      smartImportTypes,
      enableFormatOptimize,
      traceContext,
      emitProgress,
      traceMetadataBase: { repoUrl: repoUrlForTrace },
    });

    if (submodules.length > 0) {
      result.submodules = submodules;
    }
    if (resolvedBranch) {
      result.resolved_branch = resolvedBranch;
    }
    return result;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

export const importGitSubmodule = async (
  userId: string,
  projectKey: string,
  req: ImportGitRequest,
  traceContext?: TraceContext,
  options?: ImportGitOptions,
): Promise<ImportGitResult> => {
  const parentRepoUrl = String(req.submodule_parent_repo ?? "").trim();
  if (!parentRepoUrl.startsWith("http://") && !parentRepoUrl.startsWith("https://")) {
    throw new Error("submodule_parent_repo must be http or https");
  }

  const submodulePath = String(req.submodule_path ?? "").trim();
  if (!submodulePath) {
    throw new Error("submodule_path is required");
  }

  const requestedBranch = String(req.submodule_parent_branch ?? req.branch ?? "main").trim() || "main";
  const explicitBranch = typeof req.submodule_parent_branch === "string" && req.submodule_parent_branch.trim().length > 0;
  let resolvedBranch = requestedBranch;

  const parentId = String(req.parent_id ?? "root");
  const smartImport = req.smart_import ?? false;
  const smartImportTypes = new Set<SmartImportType>(req.smart_import_types ?? []);
  const allowedExtensions = buildAllowedExtensions(req.file_types ?? []);
  const enableFormatOptimize = req.enable_format_optimize ?? false;
  const repoUrlForTrace = sanitizeRepoUrlForTrace(req.repo_url ?? parentRepoUrl);

  const tempDir = path.join(process.cwd(), ".tmp", `git-submodule-${uuidv4()}`);
  await mkdir(tempDir, { recursive: true });

  const emitProgress = async (progress: ImportGitProgress) => {
    if (!options?.onProgress) {
      return;
    }
    try {
      await options.onProgress(progress);
    } catch (err) {
      console.warn("[import-git-submodule] progress callback error:", err);
    }
  };

  try {
    const git = simpleGit();

    if (!explicitBranch) {
      const defaultBranch = await resolveRemoteDefaultBranch(git, parentRepoUrl);
      if (defaultBranch) {
        resolvedBranch = defaultBranch;
      }
    }

    await emitProgress({ phase: "clone", message: "Cloning parent repository" });
    const cloneSpan = traceContext
      ? traceManager.startSpan(traceContext, "git-clone", {
          repo_url: sanitizeRepoUrlForTrace(parentRepoUrl),
          branch: resolvedBranch,
          depth: 1,
        })
      : null;
    const cloneStart = Date.now();
    try {
      await git.clone(parentRepoUrl, tempDir, ["--depth=1", "--branch", resolvedBranch]);
      if (cloneSpan) {
        traceManager.endSpan(cloneSpan, { durationMs: Date.now() - cloneStart });
      }
      await emitProgress({ phase: "clone", message: "Clone completed" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cloneSpan) {
        traceManager.endSpan(
          cloneSpan,
          { durationMs: Date.now() - cloneStart, error: msg },
          "ERROR",
        );
      }
      if (!explicitBranch && requestedBranch === "main") {
        resolvedBranch = "master";
        await emitProgress({ phase: "clone", message: "Retrying with master branch" });
        await git.clone(parentRepoUrl, tempDir, ["--depth=1", "--branch", resolvedBranch]);
      } else {
        throw err;
      }
    }

    await emitProgress({ phase: "clone", message: "Updating submodule" });
    await updateSubmoduleInRepo(tempDir, submodulePath);

    const baseDir = path.join(tempDir, submodulePath);
    const submoduleFolderId = await ensureFolderPath(userId, projectKey, parentId, submodulePath);

    const repoName = extractRepoName(req.repo_url ?? parentRepoUrl);
    const result = await importFromDirectory({
      userId,
      projectKey,
      baseDir,
      parentId: submoduleFolderId,
      repoName,
      allowedExtensions,
      smartImport,
      smartImportTypes,
      enableFormatOptimize,
      traceContext,
      emitProgress,
      traceMetadataBase: { repoUrl: repoUrlForTrace },
      skipRootFolder: true,
    });

    result.root_folder_id = submoduleFolderId;
    result.resolved_branch = resolvedBranch;
    return result;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

export const __test__ = {
  updateSubmoduleInRepo,
};

const scanEntries = async (
  baseDir: string,
): Promise<{ directories: DirectoryEntry[]; files: FileEntry[] }> => {
  const directories: DirectoryEntry[] = [];
  const files: FileEntry[] = [];

  const walk = async (current: string, parent: string | null, depth: number) => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      if (entry.isDirectory()) {
        directories.push({
          path: relativePath,
          parent,
          name: entry.name,
          depth,
        });
        await walk(fullPath, relativePath, depth + 1);
      } else {
        const ext = path.extname(entry.name).toLowerCase().replace(".", "");
        files.push({
          fullPath,
          relativePath,
          parent,
          name: entry.name.replace(path.extname(entry.name), ""),
          ext,
        });
      }
    }
  };

  await walk(baseDir, null, 0);
  directories.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { directories, files };
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

  // Index asynchronously
  knowledgeSearch.indexDocument(userId, projectKey, saved).catch((err) => {
    console.error("Index error:", err);
  });

  return saved.meta.id;
};
