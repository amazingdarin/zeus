import test from "node:test";
import assert from "node:assert/strict";
import type { JSONContent } from "@tiptap/core";

import {
  assertExecutableCodeBlock,
  CodeExecGuardError,
} from "../src/services/code-exec/guard.js";
import type { Document } from "../src/storage/types.js";

function buildDoc(content: JSONContent, options?: { locked?: boolean }): Document {
  return {
    meta: {
      id: "d1",
      schema_version: "v1",
      title: "Doc 1",
      slug: "doc-1",
      path: "d1.json",
      parent_id: "root",
      created_at: "2026-03-04T00:00:00.000Z",
      updated_at: "2026-03-04T00:00:00.000Z",
      extra: options?.locked
        ? {
          lock: {
            locked: true,
            lockedBy: "u1",
            lockedAt: "2026-03-04T00:00:00.000Z",
          },
        }
        : {},
    },
    body: {
      type: "tiptap",
      content,
    },
  };
}

test("assertExecutableCodeBlock rejects locked document", async () => {
  const doc = buildDoc(
    {
      type: "doc",
      content: [],
    },
    { locked: true },
  );

  assert.throws(
    () =>
      assertExecutableCodeBlock({
        doc,
        blockId: "b1",
        language: "python",
        code: "print('ok')",
      }),
    /Document is locked/,
  );
});

test("assertExecutableCodeBlock rejects unsupported language", async () => {
  const doc = buildDoc({
    type: "doc",
    content: [
      {
        type: "codeBlock",
        attrs: { id: "b1", language: "python" },
        content: [{ type: "text", text: "print('ok')" }],
      },
    ],
  });

  assert.throws(
    () =>
      assertExecutableCodeBlock({
        doc,
        blockId: "b1",
        language: "go",
        code: "fmt.Println('ok')",
      }),
    (error: unknown) => {
      assert.ok(error instanceof CodeExecGuardError);
      assert.equal(error.code, "LANG_NOT_ALLOWED");
      assert.equal(error.status, 400);
      return true;
    },
  );
});

test("assertExecutableCodeBlock rejects non-code block", async () => {
  const doc = buildDoc({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: "b1" },
        content: [{ type: "text", text: "not code" }],
      },
    ],
  });

  assert.throws(
    () =>
      assertExecutableCodeBlock({
        doc,
        blockId: "b1",
        language: "python",
        code: "print('ok')",
      }),
    (error: unknown) => {
      assert.ok(error instanceof CodeExecGuardError);
      assert.equal(error.code, "BLOCK_NOT_EXECUTABLE");
      assert.equal(error.status, 400);
      return true;
    },
  );
});

test("assertExecutableCodeBlock rejects code mismatch", async () => {
  const doc = buildDoc({
    type: "doc",
    content: [
      {
        type: "codeBlock",
        attrs: { id: "b1", language: "python" },
        content: [{ type: "text", text: "print('server')" }],
      },
    ],
  });

  assert.throws(
    () =>
      assertExecutableCodeBlock({
        doc,
        blockId: "b1",
        language: "python",
        code: "print('client')",
      }),
    (error: unknown) => {
      assert.ok(error instanceof CodeExecGuardError);
      assert.equal(error.code, "CODE_MISMATCH");
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test("assertExecutableCodeBlock returns normalized payload when valid", async () => {
  const doc = buildDoc({
    type: "doc",
    content: [
      {
        type: "codeBlock",
        attrs: { id: "b1", language: "python" },
        content: [{ type: "text", text: "print('ok')" }],
      },
    ],
  });

  const out = assertExecutableCodeBlock({
    doc,
    blockId: "b1",
    language: "python",
    code: "print('ok')",
  });

  assert.equal(out.blockId, "b1");
  assert.equal(out.language, "python");
  assert.equal(out.code, "print('ok')");
});
