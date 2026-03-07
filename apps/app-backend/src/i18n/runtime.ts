import i18next, { type i18n as I18nInstance } from "i18next";
import Backend from "i18next-fs-backend";
import path from "node:path";

import { DEFAULT_LOCALE, type SupportedLocale, normalizeLocale } from "./locale.js";

let instance: I18nInstance | null = null;
let instancePromise: Promise<I18nInstance> | null = null;

function resolveLocaleRoot(): string {
  return path.resolve(process.cwd(), "../../locales/generated/app-backend");
}

async function createI18nInstance(): Promise<I18nInstance> {
  const nextInstance = i18next.createInstance();
  await nextInstance
    .use(Backend)
    .init({
      lng: DEFAULT_LOCALE,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: ["zh-CN", "en"],
      preload: ["zh-CN", "en"],
      ns: ["common", "auth", "chat", "document", "edu", "settings", "team", "errors"],
      defaultNS: "common",
      backend: {
        loadPath: path.join(resolveLocaleRoot(), "{{lng}}", "{{ns}}.json"),
      },
      interpolation: {
        escapeValue: false,
      },
      returnNull: false,
    });
  instance = nextInstance;
  return nextInstance;
}

export async function initAppI18nRuntime(): Promise<I18nInstance> {
  return getI18n();
}

async function getI18n(): Promise<I18nInstance> {
  if (instance) {
    return instance;
  }
  if (!instancePromise) {
    instancePromise = createI18nInstance();
  }
  instance = await instancePromise;
  return instance;
}

export function translateAppMessageSync(input: {
  locale: string;
  key: string;
  namespace?: string;
  fallback: string;
  params?: Record<string, unknown>;
}): { locale: SupportedLocale; message: string } {
  const locale = normalizeLocale(input.locale);
  if (!instance?.isInitialized) {
    return {
      locale,
      message: input.fallback,
    };
  }
  const message = instance.t(input.key, {
    lng: locale,
    ns: input.namespace,
    defaultValue: input.fallback,
    ...(input.params ?? {}),
  });
  return {
    locale,
    message: String(message || input.fallback),
  };
}

export async function translateAppMessage(input: {
  locale: string;
  key: string;
  namespace?: string;
  fallback: string;
  params?: Record<string, unknown>;
}): Promise<{ locale: SupportedLocale; message: string }> {
  const locale = normalizeLocale(input.locale);
  const i18n = await getI18n();
  const message = i18n.t(input.key, {
    lng: locale,
    ns: input.namespace,
    defaultValue: input.fallback,
    ...(input.params ?? {}),
  });
  return {
    locale,
    message: String(message || input.fallback),
  };
}
