import { AsyncLocalStorage } from "node:async_hooks";

import { DEFAULT_LOCALE, type SupportedLocale, normalizeLocale } from "./locale.js";

type RequestLocaleStore = {
  locale: SupportedLocale;
};

const requestLocaleStorage = new AsyncLocalStorage<RequestLocaleStore>();

export function runWithRequestLocale(locale: string | null | undefined, callback: () => void): void {
  requestLocaleStorage.run({ locale: normalizeLocale(locale) }, callback);
}

export function getCurrentRequestLocale(): SupportedLocale {
  return requestLocaleStorage.getStore()?.locale ?? DEFAULT_LOCALE;
}
