import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_LOCALE, normalizeLocale, resolveLocaleFromHeaders } from "../src/i18n/locale.ts";
import { getCurrentRequestLocale, runWithRequestLocale } from "../src/i18n/request-context.ts";

test("app-backend locale: normalizeLocale supports zh and en variants", () => {
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(normalizeLocale("fr-FR"), DEFAULT_LOCALE);
});

test("app-backend locale: resolveLocaleFromHeaders prefers X-Zeus-Locale over Accept-Language", () => {
  const locale = resolveLocaleFromHeaders({
    "x-zeus-locale": "en",
    "accept-language": "zh-CN,zh;q=0.9",
  });
  assert.equal(locale, "en");
});

test("app-backend locale: resolveLocaleFromHeaders falls back to Accept-Language then default", () => {
  assert.equal(resolveLocaleFromHeaders({ "accept-language": "en-US,en;q=0.9" }), "en");
  assert.equal(resolveLocaleFromHeaders({}), DEFAULT_LOCALE);
});

test("app-backend locale: request context stores the normalized locale", () => {
  let localeInScope = DEFAULT_LOCALE;
  runWithRequestLocale("en-US", () => {
    localeInScope = getCurrentRequestLocale();
  });
  assert.equal(localeInScope, "en");
  assert.equal(getCurrentRequestLocale(), DEFAULT_LOCALE);
});
