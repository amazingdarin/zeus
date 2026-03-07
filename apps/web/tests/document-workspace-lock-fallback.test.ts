import assert from "node:assert/strict";
import test from "node:test";

import { reduceLockFallbackState } from "../src/features/document-editor/lock-fallback";

test("save 423 transitions workspace to readonly", () => {
  const next = reduceLockFallbackState(
    { readonly: false },
    { code: "DOCUMENT_LOCKED", status: 423 },
  );
  assert.equal(next.readonly, true);
});

test("non-lock errors keep workspace editable", () => {
  const next = reduceLockFallbackState(
    { readonly: false },
    { code: "UPDATE_FAILED", status: 500 },
  );
  assert.equal(next.readonly, false);
});
