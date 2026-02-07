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
  // Options for Smart Import
  smart_import?: boolean;
  smart_import_types?: SmartImportType[];
  file_types?: FileTypeFilter[];
  // Enable format optimization using LLM (optional, fail-safe)
  enable_format_optimize?: boolean;
};

export type ImportGitResult = {
  directories: number;
  files: number;
  skipped: number;
  converted: number;
  fallback: number;
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

export const importGit = async (
  userId: string,
  projectKey: string,
  req: ImportGitRequest,
  traceContext?: TraceContext,
): Promise<ImportGitResult> => {
  const repoUrl = String(req.repo_url ?? "").trim();
  if (!repoUrl.startsWith("http://") && !repoUrl.startsWith("https://")) {
    throw new Error("repo_url must be http or https");
  }

  const branch = String(req.branch ?? "main").trim() || "main";
  const subdir = String(req.subdir ?? "").trim();
  const parentId = String(req.parent_id ?? "root");
  const smartImport = req.smart_import ?? false;
  const smartImportTypes = new Set<SmartImportType>(req.smart_import_types ?? []);
  const allowedExtensions = buildAllowedExtensions(req.file_types ?? []);
  const enableFormatOptimize = req.enable_format_optimize ?? false;
  const repoUrlForTrace = sanitizeRepoUrlForTrace(repoUrl);

  const tempDir = path.join(process.cwd(), ".tmp", `git-import-${uuidv4()}`);
  await mkdir(tempDir, { recursive: true });

  try {
    const git = simpleGit();

    const cloneSpan = traceContext
      ? traceManager.startSpan(traceContext, "git-clone", {
          repo_url: repoUrlForTrace,
          branch,
          depth: 1,
        })
      : null;
    const cloneStart = Date.now();
    try {
      await git.clone(repoUrl, tempDir, ["--depth=1", "--branch", branch]);
      if (cloneSpan) {
        traceManager.endSpan(cloneSpan, { durationMs: Date.now() - cloneStart });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (cloneSpan) {
        traceManager.endSpan(
          cloneSpan,
          { durationMs: Date.now() - cloneStart, error: msg },
          "ERROR",
        );
      }
      throw err;
    }

    const baseDir = subdir ? path.join(tempDir, subdir) : tempDir;

    const scanSpan = traceContext
      ? traceManager.startSpan(traceContext, "scan-entries", {
          subdir: subdir || ".",
        })
      : null;
    const scanStart = Date.now();
    const { directories, files } = await scanEntries(baseDir);
    if (scanSpan) {
      traceManager.endSpan(scanSpan, {
        durationMs: Date.now() - scanStart,
        directoryCount: directories.length,
        fileCount: files.length,
      });
    }

    const result: ImportGitResult = {
      directories: 0,
      files: 0,
      skipped: 0,
      converted: 0,
      fallback: 0,
    };

    // Step 1: Filter files by allowed extensions
    const filteredFiles: FileEntry[] = [];
    for (const file of files) {
      if (!isExtensionAllowed(file.ext, allowedExtensions)) {
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

    // Always create a root folder with the Git repo name
    const repoName = extractRepoName(repoUrl);
    let rootParentId = parentId;

    const foldersSpan = traceContext
      ? traceManager.startSpan(traceContext, "create-folders", {
          repoName,
          filteredDirCount: filteredDirs.length,
          hasFiles: filteredFiles.length > 0,
        })
      : null;
    const foldersStart = Date.now();
    try {
      if (filteredFiles.length > 0) {
        // Create the Git project root folder
        const repoFolderId = await createFolder(userId, projectKey, repoName, parentId);
        directoryMap.set(".", repoFolderId);
        rootParentId = repoFolderId;
        result.directories += 1;
      }

      for (const dir of filteredDirs) {
        const parentKey = dir.parent ?? ".";
        const resolvedParent =
          parentKey === "." ? rootParentId : (directoryMap.get(parentKey) ?? rootParentId);
        const folderId = await createFolder(userId, projectKey, dir.name, resolvedParent);
        directoryMap.set(dir.path, folderId);
        result.directories += 1;
      }

      if (foldersSpan) {
        traceManager.endSpan(foldersSpan, {
          durationMs: Date.now() - foldersStart,
          created: result.directories,
        });
      }
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
    const importSpan = traceContext
      ? traceManager.startSpan(traceContext, "import-files", {
          fileCount: filteredFiles.length,
          smartImport,
          smartImportTypes: Array.from(smartImportTypes),
          enableFormatOptimize,
          limits: { maxFiles: MAX_FILES, maxBytes: MAX_BYTES },
        })
      : null;
    const importStart = Date.now();
    try {
      for (const file of filteredFiles) {
        if (result.files >= MAX_FILES) {
          result.skipped += 1;
          continue;
        }

        const info = await stat(file.fullPath);
        if (info.size > MAX_BYTES) {
          result.skipped += 1;
          continue;
        }

        const content = await readFile(file.fullPath);
        const resolvedParent = file.parent
          ? (directoryMap.get(file.parent) ?? rootParentId)
          : rootParentId;

        const mime = EXT_TO_MIME[file.ext.toLowerCase()] ?? "application/octet-stream";
        const originalname = file.ext ? `${file.name}.${file.ext}` : file.name;
        const imported = await importFileAsDocument(userId, projectKey, {
          parentId: resolvedParent,
          title: file.name,
          file: {
            buffer: content,
            originalname,
            mimetype: mime,
            size: info.size,
          },
          smartImport,
          smartImportTypes: Array.from(smartImportTypes),
          enableFormatOptimize,
          traceContext,
          traceMetadata: {
            source: "git",
            repoUrl: repoUrlForTrace,
            relativePath: file.relativePath,
          },
        });

        if (imported.mode === "smart") {
          result.converted += 1;
        } else {
          result.fallback += 1;
        }
        result.files += 1;
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

    return result;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
