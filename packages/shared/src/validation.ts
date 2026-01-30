export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidGitBranch(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.endsWith("/") || trimmed.startsWith("/") || trimmed.includes("..")) {
    return false;
  }
  if (/[\s~^:?*\[\\]/.test(trimmed)) {
    return false;
  }
  return true;
}
