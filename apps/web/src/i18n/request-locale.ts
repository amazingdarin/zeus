import { DEFAULT_LOCALE, detectBrowserLocale, getLocalLocale, normalizeLocale } from "./locale";

export function resolveRequestLocale(explicitLocale?: string | null): string {
  if (explicitLocale && String(explicitLocale).trim()) {
    return normalizeLocale(explicitLocale);
  }
  const localLocale = getLocalLocale();
  if (localLocale) {
    return localLocale;
  }
  return detectBrowserLocale() || DEFAULT_LOCALE;
}

export function getLocaleRequestHeaders(locale: string): Record<string, string> {
  const normalized = normalizeLocale(locale);
  return {
    "X-Zeus-Locale": normalized,
    "Accept-Language": normalized,
  };
}
