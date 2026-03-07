import assert from "node:assert/strict";
import test from "node:test";

import { buildDocumentScopeForChat } from "../src/features/chat/document-scope";

test("uses explicit mention scope when doc mentions exist", () => {
  const scope = buildDocumentScopeForChat({
    mentions: [
      { kind: "doc", docId: "doc-a", includeChildren: true },
      { kind: "doc", docId: "doc-b", includeChildren: false },
    ],
    defaultDocumentId: "doc-fallback",
  });

  assert.deepEqual(scope, [
    { docId: "doc-a", includeChildren: true },
    { docId: "doc-b", includeChildren: false },
  ]);
});

test("uses default document when there is no explicit mention", () => {
  const scope = buildDocumentScopeForChat({
    mentions: [],
    defaultDocumentId: "doc-current",
  });

  assert.deepEqual(scope, [{ docId: "doc-current", includeChildren: false }]);
});

test("uses default document when only plugin template mention exists", () => {
  const scope = buildDocumentScopeForChat({
    mentions: [{ kind: "plugin_template", docId: "ppt-template" }],
    defaultDocumentId: "doc-current",
  });

  assert.deepEqual(scope, [{ docId: "doc-current", includeChildren: false }]);
});

test("returns undefined when both explicit and fallback document are missing", () => {
  const scope = buildDocumentScopeForChat({
    mentions: [{ kind: "plugin_template", docId: "ppt-template" }],
    defaultDocumentId: "   ",
  });

  assert.equal(scope, undefined);
});

