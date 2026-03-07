export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "zh-CN";

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

export function resolveLocaleFromHeaders(headers: Record<string, unknown>): SupportedLocale {
  const explicitHeader = normalizeRawLocale(headers["x-zeus-locale"] as string | undefined);
  if (explicitHeader) {
    return normalizeLocale(explicitHeader);
  }
  const acceptLanguage = normalizeRawLocale(headers["accept-language"] as string | undefined);
  if (acceptLanguage) {
    const candidates = acceptLanguage.split(",").map((part) => part.split(";")[0]?.trim() ?? "");
    for (const candidate of candidates) {
      const raw = normalizeRawLocale(candidate);
      if (!raw) {
        continue;
      }
      const normalized = normalizeLocale(raw);
      if (normalized === "en" || normalized === "zh-CN") {
        return normalized;
      }
    }
  }
  return DEFAULT_LOCALE;
}
