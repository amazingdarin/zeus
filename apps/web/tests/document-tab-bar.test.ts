import assert from "node:assert/strict";
import { test } from "node:test";

import { toTabLabel } from "../src/components/DocumentTabBar";

test("toTabLabel trims title", () => {
  assert.equal(toTabLabel("  Hello  "), "Hello");
});

test("toTabLabel falls back for empty title", () => {
  assert.equal(toTabLabel("   "), "无标题文档");
});
