const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const TEXT_EXTENSIONS = new Set(["md", "txt", "csv", "json", "yaml", "yml", "log"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const WORD_EXTENSIONS = new Set(["docx"]);
const TEXT_MIME_PREFIX = "text/";
const TEXT_MIME_VALUES = new Set([
  "application/json",
  "application/x-yaml",
  "application/yaml",
  "application/xml",
  "application/x-www-form-urlencoded",
]);
const MARKDOWN_MIME_VALUES = new Set(["text/markdown", "text/x-markdown"]);
const TEXT_SNIFF_BYTES = 16 * 1024;

export type UploadedAssetMeta = {
  filename: string;
  mime: string;
};

export const getFileExtension = (filename: string): string => {
  const trimmed = filename.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return "";
  }
  return trimmed.slice(lastDot + 1);
};

export const isMarkdownFile = (file: File): boolean => {
  const mime = file.type.trim().toLowerCase();
  if (MARKDOWN_MIME_VALUES.has(mime)) {
    return true;
  }
  const extension = getFileExtension(file.name);
  return extension ? MARKDOWN_EXTENSIONS.has(extension) : false;
};

export const isDocxFile = (file: File): boolean => {
  const extension = getFileExtension(file.name);
  if (extension) {
    return WORD_EXTENSIONS.has(extension);
  }
  return (
    file.type.trim().toLowerCase() ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
};

export const isImageAsset = (mime: string, filename: string): boolean => {
  const normalizedMime = mime.toLowerCase();
  if (normalizedMime.startsWith("image/")) {
    return true;
  }
  const extension = getFileExtension(filename);
  return extension ? IMAGE_EXTENSIONS.has(extension) : false;
};

export const isLikelyTextFile = async (
  file: File,
  asset: UploadedAssetMeta,
): Promise<boolean> => {
  const normalizedMime = asset.mime.toLowerCase();
  if (normalizedMime.startsWith(TEXT_MIME_PREFIX) || TEXT_MIME_VALUES.has(normalizedMime)) {
    return true;
  }
  const extension = getFileExtension(asset.filename);
  if (extension && TEXT_EXTENSIONS.has(extension)) {
    return true;
  }
  if (normalizedMime && normalizedMime !== "application/octet-stream") {
    return false;
  }
  return sniffTextContent(file);
};

const sniffTextContent = async (file: File): Promise<boolean> => {
  try {
    const slice = file.slice(0, TEXT_SNIFF_BYTES);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length === 0) {
      return false;
    }
    let suspicious = 0;
    let printable = 0;
    for (let i = 0; i < bytes.length; i += 1) {
      const value = bytes[i];
      if (value === 0) {
        return false;
      }
      if (value === 9 || value === 10 || value === 13) {
        printable += 1;
        continue;
      }
      if (value >= 32 && value <= 126) {
        printable += 1;
        continue;
      }
      suspicious += 1;
    }
    const printableRatio = printable / bytes.length;
    if (printableRatio >= 0.9) {
      return true;
    }
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const decoded = decoder.decode(bytes);
    if (!decoded) {
      return false;
    }
    let control = 0;
    for (let i = 0; i < decoded.length; i += 1) {
      const code = decoded.charCodeAt(i);
      if (code === 9 || code === 10 || code === 13) {
        continue;
      }
      if (code < 32 || code === 65533) {
        control += 1;
      }
    }
    return control / decoded.length < 0.1;
  } catch {
    return false;
  }
};
