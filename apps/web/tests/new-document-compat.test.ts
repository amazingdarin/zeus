import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLegacyEditRedirect } from "../src/features/document-editor/new-document-routing";

test("legacy edit route redirects to unified page", () => {
  assert.equal(
    buildLegacyEditRedirect({ documentId: "doc-1" }),
    "/documents/doc-1",
  );
});

test("create route now redirects to unified documents page", () => {
  assert.equal(
    buildLegacyEditRedirect({ parentId: "root" }),
    "/documents",
  );
});
