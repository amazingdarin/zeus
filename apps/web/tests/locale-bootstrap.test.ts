import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_LOCALE,
  detectBrowserLocale,
  normalizeLocale,
  resolveInitialLocale,
  shouldSyncLocalLocaleToAccount,
} from "../src/i18n/locale";

test("i18n locale: normalizeLocale maps supported variants", () => {
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("zh"), "zh-CN");
  assert.equal(normalizeLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(normalizeLocale("fr-FR"), DEFAULT_LOCALE);
});

test("i18n locale: detectBrowserLocale uses navigator.languages priority", () => {
  assert.equal(detectBrowserLocale(["en-US", "zh-CN"]), "en");
  assert.equal(detectBrowserLocale(["fr-FR", "zh-CN"]), "zh-CN");
  assert.equal(detectBrowserLocale([]), DEFAULT_LOCALE);
});

test("i18n locale: resolveInitialLocale prefers authenticated account locale", () => {
  const locale = resolveInitialLocale({
    userLocale: "en",
    localLocale: "zh-CN",
    browserLocales: ["zh-CN"],
  });
  assert.equal(locale, "en");
});

test("i18n locale: resolveInitialLocale falls back to local locale before browser", () => {
  const locale = resolveInitialLocale({
    userLocale: null,
    localLocale: "en-US",
    browserLocales: ["zh-CN"],
  });
  assert.equal(locale, "en");
});

test("i18n locale: shouldSyncLocalLocaleToAccount only when account lacks locale", () => {
  assert.equal(shouldSyncLocalLocaleToAccount({ userLocale: null, localLocale: "en" }), true);
  assert.equal(shouldSyncLocalLocaleToAccount({ userLocale: "zh-CN", localLocale: "en" }), false);
  assert.equal(shouldSyncLocalLocaleToAccount({ userLocale: null, localLocale: null }), false);
});
