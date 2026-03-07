import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLocalizedErrorPayload, buildLocalizedErrorPayloadSync } from "../src/services/i18n-error.ts";
import { initAppI18nRuntime } from "../src/i18n/runtime.ts";

await initAppI18nRuntime();

test("app-backend i18n error: uses translated message for known code", async () => {
  const payload = await buildLocalizedErrorPayload({
    locale: "en",
    code: "UNAUTHORIZED",
    fallbackMessage: "user not authenticated",
  });
  assert.equal(payload.code, "UNAUTHORIZED");
  assert.equal(payload.locale, "en");
  assert.equal(payload.message, "Not authenticated or session expired");
});

test("app-backend i18n error: sync payload uses translated message after runtime init", () => {
  const payload = buildLocalizedErrorPayloadSync({
    locale: "zh-CN",
    code: "FORBIDDEN",
    fallbackMessage: "forbidden",
  });
  assert.equal(payload.code, "FORBIDDEN");
  assert.equal(payload.locale, "zh-CN");
  assert.equal(payload.message, "无权执行该操作");
});

test("app-backend i18n error: falls back when translation key is missing", async () => {
  const payload = await buildLocalizedErrorPayload({
    locale: "en",
    code: "UNKNOWN_CODE",
    fallbackMessage: "fallback message",
  });
  assert.equal(payload.message, "fallback message");
  assert.equal(payload.locale, "en");
});
