export const LAST_PROJECT_REF_STORAGE_KEY = "zeus.lastProjectRef";
export const PROJECT_REF_CHANGED_EVENT = "zeus:project-ref-changed";

function normalizeProjectRef(projectRef: string | null | undefined): string | null {
  const trimmed = String(projectRef ?? "").trim();
  return trimmed || null;
}

export function readLastProjectRef(): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  return normalizeProjectRef(localStorage.getItem(LAST_PROJECT_REF_STORAGE_KEY));
}

export function writeLastProjectRef(projectRef: string | null | undefined): string | null {
  const normalized = normalizeProjectRef(projectRef);
  if (typeof localStorage !== "undefined") {
    if (normalized) {
      localStorage.setItem(LAST_PROJECT_REF_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(LAST_PROJECT_REF_STORAGE_KEY);
    }
  }

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(
      new CustomEvent(PROJECT_REF_CHANGED_EVENT, {
        detail: { projectRef: normalized },
      }),
    );
  }

  return normalized;
}
