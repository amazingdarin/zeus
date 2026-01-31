import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import simpleGit from "simple-git";
import { v4 as uuidv4 } from "uuid";

import { convertDocument } from "./convert.js";
import { documentStore } from "../storage/document-store.js";
import { assetStore } from "../storage/asset-store.js";
import { knowledgeSearch } from "../knowledge/search.js";
import type { Document } from "../storage/types.js";

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
 * Check if a file should use smart import (convert to tiptap with content)
 */
const shouldSmartImport = (
  ext: string,
  smartImport: boolean,
  smartImportTypes: Set<SmartImportType>,
): { enabled: boolean; type: SmartImportType | null } => {
  if (!smartImport) {
    return { enabled: false, type: null };
  }

  const lowerExt = ext.toLowerCase();

  if (smartImportTypes.has("markdown") && ["md", "markdown"].includes(lowerExt)) {
    return { enabled: true, type: "markdown" };
  }
  if (smartImportTypes.has("word") && lowerExt === "docx") {
    return { enabled: true, type: "word" };
  }
  if (smartImportTypes.has("pdf") && lowerExt === "pdf") {
    return { enabled: true, type: "pdf" };
  }

  return { enabled: false, type: null };
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

export const importGit = async (
  projectKey: string,
  req: ImportGitRequest,
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

  const tempDir = path.join(process.cwd(), ".tmp", `git-import-${uuidv4()}`);
  await mkdir(tempDir, { recursive: true });

  try {
    const git = simpleGit();
    await git.clone(repoUrl, tempDir, ["--depth=1", "--branch", branch]);

    const baseDir = subdir ? path.join(tempDir, subdir) : tempDir;
    const { directories, files } = await scanEntries(baseDir);

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
    
    if (filteredFiles.length > 0) {
      // Create the Git project root folder
      const repoFolderId = await createFolder(projectKey, repoName, parentId);
      directoryMap.set(".", repoFolderId);
      rootParentId = repoFolderId;
      result.directories += 1;
    }

    for (const dir of filteredDirs) {
      const parentKey = dir.parent ?? ".";
      const resolvedParent =
        parentKey === "." ? rootParentId : (directoryMap.get(parentKey) ?? rootParentId);
      const folderId = await createFolder(projectKey, dir.name, resolvedParent);
      directoryMap.set(dir.path, folderId);
      result.directories += 1;
    }

    // Step 5: Import files
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

      // Check if should use smart import
      const smartResult = shouldSmartImport(file.ext, smartImport, smartImportTypes);

      if (smartResult.enabled) {
        // Smart import: convert to tiptap document with file block + content
        try {
          const markdown = await convertFileToMarkdown(file.ext, content);
          if (markdown) {
            // Upload as asset first
            const assetMeta = await uploadAsset(projectKey, file, content);
            // Create document with file block + converted content
            await createSmartDocument(projectKey, file.name, resolvedParent, markdown, assetMeta);
            result.converted += 1;
          } else {
            // Conversion failed, fallback to regular file import
            await createDocumentWithAsset(projectKey, file, content, resolvedParent);
            result.fallback += 1;
          }
        } catch (err) {
          console.error("Smart import error:", err);
          // Fallback to regular file import
          await createDocumentWithAsset(projectKey, file, content, resolvedParent);
          result.fallback += 1;
        }
      } else {
        // Regular import: upload as asset and create document with file block only
        await createDocumentWithAsset(projectKey, file, content, resolvedParent);
        result.fallback += 1;
      }
      result.files += 1;
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

const convertFileToMarkdown = async (ext: string, content: Buffer): Promise<string> => {
  const lowerExt = ext.toLowerCase();
  if (["md", "markdown"].includes(lowerExt)) {
    return content.toString("utf-8");
  }
  if (["docx", "pdf"].includes(lowerExt)) {
    try {
      const result = await convertDocument(
        "",
        {
          buffer: content,
          originalname: `file.${ext}`,
          mimetype: "",
          fieldname: "file",
          size: content.length,
          destination: "",
          encoding: "",
          filename: "",
          path: "",
          stream: undefined,
        } as unknown as Express.Multer.File,
        ext,
        "markdown",
      );
      return result.content;
    } catch (err) {
      console.error("Convert error:", err);
      return "";
    }
  }
  return "";
};

const uploadAsset = async (
  projectKey: string,
  file: FileEntry,
  content: Buffer,
): Promise<{ id: string; filename: string; mime: string; size: number }> => {
  const filename = `${file.name}.${file.ext}`;
  const mime = EXT_TO_MIME[file.ext.toLowerCase()] ?? "application/octet-stream";
  const meta = await assetStore.save(projectKey, filename, mime, content);
  return {
    id: meta.id,
    filename: meta.filename,
    mime: meta.mime,
    size: meta.size,
  };
};

const createFolder = async (
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

  const saved = await documentStore.save(projectKey, doc);

  // Index asynchronously
  knowledgeSearch.indexDocument(projectKey, saved).catch((err) => {
    console.error("Index error:", err);
  });

  return saved.meta.id;
};

const createDocumentWithAsset = async (
  projectKey: string,
  file: FileEntry,
  content: Buffer,
  parentId: string,
): Promise<void> => {
  // Upload as asset
  const assetMeta = await uploadAsset(projectKey, file, content);

  // Create document with file block only
  const doc: Document = {
    meta: {
      id: uuidv4(),
      schema_version: "v1",
      title: file.name,
      slug: "",
      path: "",
      parent_id: parentId,
      created_at: "",
      updated_at: "",
      extra: {
        status: "draft",
        tags: [],
      },
    },
    body: {
      type: "tiptap",
      content: buildFileBlockDoc(assetMeta),
    },
  };

  const saved = await documentStore.save(projectKey, doc);

  // Index asynchronously
  knowledgeSearch.indexDocument(projectKey, saved).catch((err) => {
    console.error("Index error:", err);
  });
};

const createSmartDocument = async (
  projectKey: string,
  title: string,
  parentId: string,
  markdown: string,
  assetMeta: { id: string; filename: string; mime: string; size: number },
): Promise<void> => {
  // Create document with file block at top, followed by converted content
  const fileBlock = buildFileBlockNode(assetMeta);
  const tiptapContent = markdownToTiptap(markdown);

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
      },
    },
    body: {
      type: "tiptap",
      content: {
        type: "doc",
        content: [
          fileBlock,
          ...(Array.isArray(tiptapContent.content) ? tiptapContent.content : []),
        ],
      },
    },
  };

  const saved = await documentStore.save(projectKey, doc);

  // Index asynchronously
  knowledgeSearch.indexDocument(projectKey, saved).catch((err) => {
    console.error("Index error:", err);
  });
};

/**
 * Convert markdown text to tiptap JSON structure
 */
function markdownToTiptap(markdown: string): { type: string; content: unknown[] } {
  // Simple conversion: split by paragraphs
  const paragraphs = markdown.split(/\n\n+/).filter((p) => p.trim());
  const content: unknown[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Check for headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      content.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: [{ type: "text", text: headingMatch[2] }],
      });
      continue;
    }

    // Check for code blocks
    if (trimmed.startsWith("```")) {
      const lines = trimmed.split("\n");
      const lang = lines[0].replace(/^```/, "").trim();
      const code = lines.slice(1, -1).join("\n");
      content.push({
        type: "codeBlock",
        attrs: { language: lang || null },
        content: [{ type: "text", text: code }],
      });
      continue;
    }

    // Regular paragraph
    content.push({
      type: "paragraph",
      content: [{ type: "text", text: trimmed }],
    });
  }

  return { type: "doc", content };
}

/**
 * Build a Tiptap document with a file block
 */
function buildFileBlockDoc(assetMeta: {
  id: string;
  filename: string;
  mime: string;
  size: number;
}): unknown {
  return {
    type: "doc",
    content: [buildFileBlockNode(assetMeta)],
  };
}

/**
 * Build a file block node
 */
function buildFileBlockNode(assetMeta: {
  id: string;
  filename: string;
  mime: string;
  size: number;
}): unknown {
  const { fileType, officeType } = resolveFileKind(assetMeta.filename, assetMeta.mime);
  return {
    type: "file_block",  // Use snake_case to match tiptap node name
    attrs: {
      asset_id: assetMeta.id,
      file_name: assetMeta.filename,
      mime: assetMeta.mime,
      size: assetMeta.size,
      file_type: fileType,
      office_type: officeType,
    },
  };
}

/**
 * Resolve file kind from filename and MIME type
 */
function resolveFileKind(
  fileName: string,
  mime: string,
): { fileType: "office" | "text" | "unknown"; officeType?: string } {
  const OFFICE_MIME_MAP: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };

  const OFFICE_EXT_MAP: Record<string, string> = {
    pdf: "pdf",
    docx: "docx",
    pptx: "pptx",
    xlsx: "xlsx",
  };

  const TEXT_EXTENSIONS = new Set(["txt", "md", "csv", "json", "yaml", "yml", "log"]);

  const normalizedMime = mime.toLowerCase();
  if (normalizedMime in OFFICE_MIME_MAP) {
    return { fileType: "office", officeType: OFFICE_MIME_MAP[normalizedMime] };
  }
  if (normalizedMime.startsWith("text/")) {
    return { fileType: "text" };
  }

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext in OFFICE_EXT_MAP) {
    return { fileType: "office", officeType: OFFICE_EXT_MAP[ext] };
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return { fileType: "text" };
  }

  return { fileType: "unknown" };
}
