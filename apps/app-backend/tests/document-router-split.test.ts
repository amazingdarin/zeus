import assert from "node:assert/strict";
import { test } from "node:test";

import { registerDocumentCommentRoutes } from "../src/router/document-comments.ts";
import { registerDocumentLockRoutes } from "../src/router/document-lock.ts";
import { registerDocumentReadRoutes } from "../src/router/documents.ts";

test("document router split exports route registration helpers", () => {
  assert.equal(typeof registerDocumentCommentRoutes, "function");
  assert.equal(typeof registerDocumentLockRoutes, "function");
  assert.equal(typeof registerDocumentReadRoutes, "function");
});
