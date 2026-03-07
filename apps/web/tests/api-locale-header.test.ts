import assert from "node:assert/strict";
import { test } from "node:test";

import { getLocaleRequestHeaders } from "../src/i18n/request-locale";

test("i18n headers: locale headers include both app and standard header", () => {
  assert.deepEqual(getLocaleRequestHeaders("en"), {
    "X-Zeus-Locale": "en",
    "Accept-Language": "en",
  });
});
