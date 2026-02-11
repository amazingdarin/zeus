import { readdir, readFile, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookup as lookupMime } from "mime-types";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const DEFAULT_DOC_LANGUAGE = "en";
const LANGUAGE_TAG_PATTERN = /^[a-z]{2}(?:-[a-z0-9]{2,8})*$/i;
const LANG_SUFFIX_PATTERN = /^(.*)_([a-z]{2}(?:-[a-z0-9]{2,8})*)$/i;

export type SystemDocTreeItem = {
  type: "file" | "dir";
  name: string;
  path: string;
  children?: SystemDocTreeItem[];
  languages?: string[];
};

export type SystemDocMarkdown = {
  path: string;
  content: string;
  language: string;
  resolvedPath: string;
};

export type SystemDocAsset = {
  path: string;
  buffer: Buffer;
  mime: string;
};

export type SystemDocsErrorCode =
  | "INVALID_PATH"
  | "NOT_FOUND"
  | "UNSUPPORTED_TYPE"
  | "SYSTEM_DOCS_FAILED";

export class SystemDocsError extends Error {
  code: SystemDocsErrorCode;
  status: number;

  constructor(code: SystemDocsErrorCode, message: string, status = 400) {
    super(message);
    this.name = "SystemDocsError";
    this.code = code;
    this.status = status;
  }
}

type MarkdownVariantGroup = {
  logicalName: string;
  logicalPath: string;
  defaultPath: string | null;
  variants: Map<string, string>;
  languages: Set<string>;
};

type MarkdownNameMeta = {
  logicalName: string;
  language: string;
  explicitLanguage: boolean;
};

function normalizeLanguageTag(rawLanguage: string): string {
  const normalized = String(rawLanguage ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (!normalized) {
    return DEFAULT_DOC_LANGUAGE;
  }
  if (!LANGUAGE_TAG_PATTERN.test(normalized)) {
    return DEFAULT_DOC_LANGUAGE;
  }
  return normalized;
}

function sortLanguageTags(languages: Iterable<string>): string[] {
  return Array.from(new Set(languages))
    .sort((a, b) => {
      if (a === b) {
        return 0;
      }
      if (a === DEFAULT_DOC_LANGUAGE) {
        return -1;
      }
      if (b === DEFAULT_DOC_LANGUAGE) {
        return 1;
      }
      return a.localeCompare(b, "en", { sensitivity: "base" });
    });
}

function parseMarkdownName(fileName: string): MarkdownNameMeta {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  const matched = LANG_SUFFIX_PATTERN.exec(stem);
  if (!matched) {
    return {
      logicalName: fileName,
      language: DEFAULT_DOC_LANGUAGE,
      explicitLanguage: false,
    };
  }

  const baseName = String(matched[1] ?? "").trim();
  const rawLanguage = String(matched[2] ?? "").trim().toLowerCase();
  if (!baseName || !LANGUAGE_TAG_PATTERN.test(rawLanguage)) {
    return {
      logicalName: fileName,
      language: DEFAULT_DOC_LANGUAGE,
      explicitLanguage: false,
    };
  }

  return {
    logicalName: `${baseName}${ext}`,
    language: normalizeLanguageTag(rawLanguage),
    explicitLanguage: true,
  };
}

function ensurePosixRelativePath(rawPath: string): string {
  const trimmed = String(rawPath ?? "").trim();
  if (!trimmed) {
    throw new SystemDocsError("INVALID_PATH", "path is required", 400);
  }
  if (trimmed.includes("\0")) {
    throw new SystemDocsError("INVALID_PATH", "path contains invalid character", 400);
  }

  const slashNormalized = trimmed.replace(/\\/g, "/");
  if (slashNormalized.startsWith("/") || /^[a-zA-Z]:/.test(slashNormalized)) {
    throw new SystemDocsError("INVALID_PATH", "path must be relative", 400);
  }

  const segments = slashNormalized.split("/");
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      throw new SystemDocsError("INVALID_PATH", "path cannot contain '..'", 400);
    }
  }

  const normalized = path.posix.normalize(slashNormalized).replace(/^\.\/+/, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new SystemDocsError("INVALID_PATH", "path is invalid", 400);
  }
  return normalized;
}

function assertWithinRoot(root: string, resolvedPath: string): void {
  const normalizedRoot = path.resolve(root);
  const normalizedResolved = path.resolve(resolvedPath);
  if (normalizedResolved === normalizedRoot) {
    return;
  }
  if (!normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new SystemDocsError("INVALID_PATH", "path is outside docs root", 400);
  }
}

function resolvePathInRoot(root: string, relativePath: string): string {
  const normalizedRelative = ensurePosixRelativePath(relativePath);
  const resolved = path.resolve(root, normalizedRelative);
  assertWithinRoot(root, resolved);
  return resolved;
}

async function ensureDirectory(absPath: string, label: string): Promise<void> {
  let info;
  try {
    info = await stat(absPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new SystemDocsError("NOT_FOUND", `${label} not found: ${absPath}`, 404);
    }
    throw err;
  }

  if (!info.isDirectory()) {
    throw new SystemDocsError("NOT_FOUND", `${label} is not a directory: ${absPath}`, 404);
  }
}

function isMarkdownFile(name: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function sortTreeItems(items: SystemDocTreeItem[]): SystemDocTreeItem[] {
  return items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "dir" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "zh-Hans-CN", { sensitivity: "base" });
  });
}

function collectVariantGroups(entries: Dirent[], relDir = ""): Map<string, MarkdownVariantGroup> {
  const groups = new Map<string, MarkdownVariantGroup>();

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (!entry.isFile() || !isMarkdownFile(entry.name)) {
      continue;
    }

    const nextRel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const nameMeta = parseMarkdownName(entry.name);
    const logicalPath = relDir ? `${relDir}/${nameMeta.logicalName}` : nameMeta.logicalName;
    let group = groups.get(nameMeta.logicalName);
    if (!group) {
      group = {
        logicalName: nameMeta.logicalName,
        logicalPath,
        defaultPath: null,
        variants: new Map<string, string>(),
        languages: new Set<string>(),
      };
      groups.set(nameMeta.logicalName, group);
    }

    if (nameMeta.explicitLanguage) {
      if (!group.variants.has(nameMeta.language)) {
        group.variants.set(nameMeta.language, nextRel);
      }
    } else {
      group.defaultPath = nextRel;
    }
    group.languages.add(nameMeta.language);
  }

  return groups;
}

function pickVariantPath(group: MarkdownVariantGroup, language: string): string | null {
  const normalizedLanguage = normalizeLanguageTag(language);
  if (normalizedLanguage !== DEFAULT_DOC_LANGUAGE) {
    const exact = group.variants.get(normalizedLanguage);
    if (exact) {
      return exact;
    }
  }

  if (group.defaultPath) {
    return group.defaultPath;
  }

  const englishVariant = group.variants.get(DEFAULT_DOC_LANGUAGE);
  if (englishVariant) {
    return englishVariant;
  }

  const sortedLanguages = sortLanguageTags(group.variants.keys());
  for (const lang of sortedLanguages) {
    const variantPath = group.variants.get(lang);
    if (variantPath) {
      return variantPath;
    }
  }

  return null;
}

async function scanDirectory(
  absDir: string,
  relDir = "",
  language = DEFAULT_DOC_LANGUAGE,
): Promise<SystemDocTreeItem[]> {
  const entries = await readdir(absDir, { withFileTypes: true });
  const out: SystemDocTreeItem[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (!entry.isDirectory()) {
      continue;
    }

    const nextRel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const nextAbs = path.join(absDir, entry.name);
    const children = await scanDirectory(nextAbs, nextRel, language);
    if (children.length > 0) {
      out.push({
        type: "dir",
        name: entry.name,
        path: nextRel,
        children,
      });
    }
  }

  const groups = collectVariantGroups(entries, relDir);
  for (const group of groups.values()) {
    const selected = pickVariantPath(group, language);
    if (!selected) {
      continue;
    }
    out.push({
      type: "file",
      name: group.logicalName,
      path: group.logicalPath,
      languages: sortLanguageTags(group.languages),
    });
  }

  return sortTreeItems(out);
}

async function resolveMarkdownVariantPath(
  root: string,
  logicalPath: string,
  language: string,
): Promise<string> {
  const dirName = path.posix.dirname(logicalPath);
  const baseName = path.posix.basename(logicalPath);
  const requestedNameMeta = parseMarkdownName(baseName);

  if (requestedNameMeta.explicitLanguage) {
    const candidateAbsPath = resolvePathInRoot(root, logicalPath);
    try {
      const fileInfo = await stat(candidateAbsPath);
      if (fileInfo.isFile()) {
        return logicalPath;
      }
      throw new SystemDocsError("NOT_FOUND", `file not found: ${logicalPath}`, 404);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!(code === "ENOENT" || code === "ENOTDIR")) {
        if (err instanceof SystemDocsError) {
          throw err;
        }
        throw err;
      }
    }
  }

  const relDir = dirName === "." ? "" : dirName;
  const absDir = relDir ? resolvePathInRoot(root, relDir) : root;

  let entries: Dirent[];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new SystemDocsError("NOT_FOUND", `file not found: ${logicalPath}`, 404);
    }
    throw err;
  }

  const groups = collectVariantGroups(entries, relDir);
  const group = groups.get(requestedNameMeta.logicalName);
  if (!group) {
    throw new SystemDocsError("NOT_FOUND", `file not found: ${logicalPath}`, 404);
  }

  const explicitLanguage = requestedNameMeta.explicitLanguage
    ? requestedNameMeta.language
    : normalizeLanguageTag(language);
  const resolvedPath = pickVariantPath(group, explicitLanguage);
  if (!resolvedPath) {
    throw new SystemDocsError("NOT_FOUND", `file not found: ${logicalPath}`, 404);
  }
  return resolvedPath;
}

export async function resolveSystemDocsRoot(): Promise<string> {
  const configured = String(process.env.SYSTEM_DOCS_DIR ?? "").trim();
  if (configured) {
    const configuredPath = path.resolve(process.cwd(), configured);
    await ensureDirectory(configuredPath, "SYSTEM_DOCS_DIR");
    return configuredPath;
  }

  const cwd = process.cwd();
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(cwd, "../../docs"),
    path.resolve(cwd, "../docs"),
    path.resolve(cwd, "./docs"),
    path.resolve(moduleDir, "../../../docs"),
    path.resolve(moduleDir, "../../../../docs"),
    path.resolve(moduleDir, "../../docs"),
  ];

  const checked = new Set<string>();
  for (const candidate of candidates) {
    if (checked.has(candidate)) {
      continue;
    }
    checked.add(candidate);

    try {
      await ensureDirectory(candidate, "system docs");
      return candidate;
    } catch (err) {
      if (err instanceof SystemDocsError && err.code === "NOT_FOUND") {
        continue;
      }
      throw err;
    }
  }

  throw new SystemDocsError(
    "NOT_FOUND",
    "system docs directory not found, set SYSTEM_DOCS_DIR to configure it",
    404,
  );
}

export async function scanDocsTree(language = DEFAULT_DOC_LANGUAGE): Promise<SystemDocTreeItem[]> {
  const root = await resolveSystemDocsRoot();
  const normalizedLanguage = normalizeLanguageTag(language);
  return scanDirectory(root, "", normalizedLanguage);
}

export async function readMarkdown(
  relativePath: string,
  language = DEFAULT_DOC_LANGUAGE,
): Promise<SystemDocMarkdown> {
  const root = await resolveSystemDocsRoot();
  const normalizedPath = ensurePosixRelativePath(relativePath);
  const normalizedLanguage = normalizeLanguageTag(language);

  if (!isMarkdownFile(normalizedPath)) {
    throw new SystemDocsError("UNSUPPORTED_TYPE", "only markdown files are supported", 400);
  }

  const resolvedPath = await resolveMarkdownVariantPath(root, normalizedPath, normalizedLanguage);
  const absPath = resolvePathInRoot(root, resolvedPath);
  let info;
  try {
    info = await stat(absPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new SystemDocsError("NOT_FOUND", `file not found: ${normalizedPath}`, 404);
    }
    throw err;
  }

  if (!info.isFile()) {
    throw new SystemDocsError("NOT_FOUND", `file not found: ${normalizedPath}`, 404);
  }

  const content = await readFile(absPath, "utf-8");
  return {
    path: normalizedPath,
    content,
    language: normalizedLanguage,
    resolvedPath,
  };
}

export async function readAsset(relativePath: string): Promise<SystemDocAsset> {
  const root = await resolveSystemDocsRoot();
  const normalizedPath = ensurePosixRelativePath(relativePath);
  const absPath = resolvePathInRoot(root, normalizedPath);

  let info;
  try {
    info = await stat(absPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new SystemDocsError("NOT_FOUND", `asset not found: ${normalizedPath}`, 404);
    }
    throw err;
  }

  if (!info.isFile()) {
    throw new SystemDocsError("NOT_FOUND", `asset not found: ${normalizedPath}`, 404);
  }

  const buffer = await readFile(absPath);
  const mime = lookupMime(absPath) || "application/octet-stream";

  return {
    path: normalizedPath,
    buffer,
    mime,
  };
}
