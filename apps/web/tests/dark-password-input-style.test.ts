import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

test("dark theme styles password wrappers and autofill states globally", () => {
  assert.match(
    css,
    /\[data-theme="dark"\]\s+\.ant-input-affix-wrapper\s+\.ant-input,\s*[\r\n]+\[data-theme="dark"\]\s+\.ant-input-password\s+\.ant-input\s*\{/,
    "expected dark theme selector for nested password inputs",
  );

  assert.match(
    css,
    /\[data-theme="dark"\][^{]*\.ant-input-password[^\n]*:-webkit-autofill/,
    "expected dark theme autofill selector for password inputs",
  );

  assert.match(
    css,
    /\[data-theme="dark"\][^{]*\.ant-input-password-icon[^{]*\{/,
    "expected dark theme selector for password visibility icon",
  );
});
