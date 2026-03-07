import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDocumentLock,
  assertDocumentUnlocked,
  clearDocumentLock,
  DocumentLockedError,
  getDocumentLockInfo,
} from "../src/services/document-lock.js";

test("lock helpers read and write meta.extra.lock", () => {
  const meta = {
    id: "d1",
    title: "doc",
    extra: {},
  } as {
    id: string;
    title: string;
    extra?: Record<string, unknown>;
  };

  const lock = applyDocumentLock(meta, "u1", "2026-03-02T00:00:00.000Z");
  assert.equal(lock.locked, true);
  assert.equal(lock.lockedBy, "u1");
  assert.equal(getDocumentLockInfo(meta)?.locked, true);

  clearDocumentLock(meta);
  assert.equal(getDocumentLockInfo(meta), null);
});

test("getDocumentLockInfo returns null for malformed lock payload", () => {
  const meta = {
    extra: {
      lock: {
        locked: true,
        lockedBy: "",
        lockedAt: "",
      },
    },
  } as { extra?: Record<string, unknown> };

  assert.equal(getDocumentLockInfo(meta), null);
});

test("assertDocumentUnlocked throws DocumentLockedError when document is locked", () => {
  const meta = { extra: {} } as { extra?: Record<string, unknown> };
  applyDocumentLock(meta, "u1", "2026-03-02T00:00:00.000Z");

  assert.throws(
    () => assertDocumentUnlocked(meta),
    (error) =>
      error instanceof DocumentLockedError
      && error.code === "DOCUMENT_LOCKED"
      && error.status === 423
      && error.lock.lockedBy === "u1",
  );
});
