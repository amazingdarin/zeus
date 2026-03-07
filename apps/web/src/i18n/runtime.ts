import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { DEFAULT_LOCALE, getLocalLocale, getNavigatorLocales, normalizeLocale, resolveInitialLocale, setLocalLocale } from "./locale";
import { WEB_I18N_NAMESPACES, webI18nResources } from "./resources";

let initialized = false;
let activeLocale = resolveInitialLocale({
  userLocale: null,
  localLocale: getLocalLocale(),
  browserLocales: getNavigatorLocales(),
});

async function ensureInitialized(locale: string): Promise<void> {
  if (initialized) {
    return;
  }
  await i18n
    .use(initReactI18next)
    .init({
      resources: webI18nResources,
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      ns: [...WEB_I18N_NAMESPACES],
      defaultNS: "common",
      interpolation: {
        escapeValue: false,
      },
      returnNull: false,
    });
  initialized = true;
}

export async function bootstrapLocale(input?: { userLocale?: string | null }): Promise<string> {
  const locale = resolveInitialLocale({
    userLocale: input?.userLocale ?? null,
    localLocale: getLocalLocale(),
    browserLocales: getNavigatorLocales(),
  });
  await ensureInitialized(locale);
  if (i18n.language !== locale) {
    await i18n.changeLanguage(locale);
  }
  activeLocale = setLocalLocale(locale);
  return activeLocale;
}

export async function setAppLocale(locale: string): Promise<string> {
  const normalized = normalizeLocale(locale);
  await ensureInitialized(normalized);
  if (i18n.language !== normalized) {
    await i18n.changeLanguage(normalized);
  }
  activeLocale = setLocalLocale(normalized);
  return activeLocale;
}

export function getAppLocale(): string {
  if (initialized && i18n.language) {
    return normalizeLocale(i18n.language);
  }
  return activeLocale;
}

export { i18n };
