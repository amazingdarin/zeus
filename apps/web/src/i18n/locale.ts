export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "zh-CN";
export const LOCALE_STORAGE_KEY = "zeus.language";

function normalizeRawLocale(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function normalizeLocale(value: string | null | undefined): SupportedLocale {
  const raw = normalizeRawLocale(value).toLowerCase();
  if (!raw) {
    return DEFAULT_LOCALE;
  }
  if (raw === "en" || raw.startsWith("en-")) {
    return "en";
  }
  if (raw === "zh" || raw.startsWith("zh-")) {
    return "zh-CN";
  }
  return DEFAULT_LOCALE;
}

export function detectBrowserLocale(languages?: readonly string[] | null): SupportedLocale {
  const list = Array.isArray(languages) ? languages : getNavigatorLocales();
  for (const language of list) {
    const raw = normalizeRawLocale(language).toLowerCase();
    if (!raw) {
      continue;
    }
    if (raw === "en" || raw.startsWith("en-")) {
      return "en";
    }
    if (raw === "zh" || raw.startsWith("zh-")) {
      return "zh-CN";
    }
  }
  return DEFAULT_LOCALE;
}

export function getNavigatorLocales(): string[] {
  if (typeof navigator === "undefined") {
    return [];
  }
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  if (typeof navigator.language === "string" && navigator.language.trim()) {
    return [navigator.language];
  }
  return [];
}

export function getLocalLocale(): SupportedLocale | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    return normalizeLocale(stored);
  } catch {
    return null;
  }
}

export function setLocalLocale(locale: string): SupportedLocale {
  const normalized = normalizeLocale(locale);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, normalized);
    } catch {
      // Ignore storage failures.
    }
  }
  return normalized;
}

export function resolveInitialLocale(input: {
  userLocale?: string | null;
  localLocale?: string | null;
  browserLocales?: readonly string[] | null;
}): SupportedLocale {
  const userLocale = normalizeRawLocale(input.userLocale);
  if (userLocale) {
    return normalizeLocale(userLocale);
  }
  const localLocale = normalizeRawLocale(input.localLocale);
  if (localLocale) {
    return normalizeLocale(localLocale);
  }
  return detectBrowserLocale(input.browserLocales);
}

export function shouldSyncLocalLocaleToAccount(input: {
  userLocale?: string | null;
  localLocale?: string | null;
}): boolean {
  return normalizeRawLocale(input.userLocale) === "" && normalizeRawLocale(input.localLocale) !== "";
}
