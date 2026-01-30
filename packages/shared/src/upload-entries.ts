export type DirectoryEntry = {
  path: string;
  name: string;
  parentPath: string | null;
  depth: number;
};

export type FileEntry = {
  file: File;
  path: string;
  name: string;
  parentPath: string | null;
};

export const normalizeRelativePath = (value: string): string => value.replace(/\\/g, "/");

export const buildUploadEntries = (
  files: File[],
): { directories: DirectoryEntry[]; files: FileEntry[] } => {
  const directoryMap = new Map<string, DirectoryEntry>();
  const fileEntries: FileEntry[] = [];

  for (const file of files) {
    const rawPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const relativePath = normalizeRelativePath(
      rawPath && rawPath.trim() ? rawPath : file.name,
    );
    const segments = relativePath.split("/").filter(Boolean);
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
      path: relativePath,
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
