import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import simpleGit from "simple-git";
import { v4 as uuidv4 } from "uuid";

import { convertDocument } from "./convert";
import { createCoreDocument } from "./documents";

type ImportGitRequest = {
  repo_url?: string;
  branch?: string;
  subdir?: string;
  parent_id?: string;
};

type ImportGitResult = {
  directories: number;
  files: number;
  skipped: number;
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

export const importGit = async (projectKey: string, req: ImportGitRequest): Promise<ImportGitResult> => {
  const repoUrl = String(req.repo_url ?? "").trim();
  if (!repoUrl.startsWith("http://") && !repoUrl.startsWith("https://")) {
    throw new Error("repo_url must be http or https");
  }

  const branch = String(req.branch ?? "main").trim() || "main";
  const subdir = String(req.subdir ?? "").trim();
  const parentId = String(req.parent_id ?? "root");

  const tempDir = path.join(process.cwd(), ".tmp", `git-import-${uuidv4()}`);
  await mkdir(tempDir, { recursive: true });

  const git = simpleGit();
  await git.clone(repoUrl, tempDir, ["--depth=1", "--branch", branch]);

  const baseDir = subdir ? path.join(tempDir, subdir) : tempDir;
  const rootTitle = subdir ? path.basename(subdir) : "";
  const { directories, files } = await scanEntries(baseDir);

  const result: ImportGitResult = { directories: 0, files: 0, skipped: 0 };
  const directoryMap = new Map<string, string>();

  let rootParentId = parentId;
  if (rootTitle) {
    const rootId = await createFolder(projectKey, rootTitle, parentId);
    directoryMap.set(".", rootId);
    rootParentId = rootId;
    result.directories += 1;
  }

  for (const dir of directories) {
    const parentKey = dir.parent ?? ".";
    const resolvedParent = parentKey === "." ? rootParentId : directoryMap.get(parentKey) ?? rootParentId;
    const folderId = await createFolder(projectKey, dir.name, resolvedParent);
    directoryMap.set(dir.path, folderId);
    result.directories += 1;
  }

  for (const file of files) {
    if (result.files + result.skipped >= MAX_FILES) {
      result.skipped += 1;
      continue;
    }
    const info = await stat(file.fullPath);
    if (info.size > MAX_BYTES) {
      result.skipped += 1;
      continue;
    }
    const content = await readFile(file.fullPath);
    const resolvedParent = file.parent ? directoryMap.get(file.parent) ?? rootParentId : rootParentId;
    const markdown = await convertFileToMarkdown(file.ext, content);
    if (!markdown) {
      result.skipped += 1;
      continue;
    }
    await createDocument(projectKey, file.name, resolvedParent, markdown);
    result.files += 1;
  }

  await rm(tempDir, { recursive: true, force: true });
  return result;
};

const scanEntries = async (baseDir: string): Promise<{ directories: DirectoryEntry[]; files: FileEntry[] }> => {
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
  if (["md", "markdown", "txt"].includes(ext)) {
    return content.toString("utf-8");
  }
  if (["docx", "pdf", "html"].includes(ext)) {
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
  }
  return "";
};

const createFolder = async (projectKey: string, title: string, parentId: string): Promise<string> => {
  const response = await createCoreDocument(projectKey, {
    title,
    parent_id: parentId,
    extra: {
      status: "draft",
      tags: [],
      doc_type: "folder",
    },
  }, {
    type: "tiptap",
    content: { type: "doc", content: [] },
  });
  return String(response.meta?.id ?? response.id ?? uuidv4());
};

const createDocument = async (
  projectKey: string,
  title: string,
  parentId: string,
  markdown: string,
): Promise<void> => {
  await createCoreDocument(projectKey, {
    title,
    parent_id: parentId,
    extra: {
      status: "draft",
      tags: [],
    },
  }, {
    type: "markdown",
    content: markdown,
  });
};
