import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDocumentVersionDispatcher,
} from "../src/services/document-version/dispatch.ts";

test("document-version-dispatch: does not throw when versioning fails", async () => {
  const dispatch = createDocumentVersionDispatcher({
    recordVersion: async () => {
      throw new Error("git down");
    },
  });

  await assert.doesNotReject(() =>
    dispatch({
      userId: "user-1",
      projectKey: "personal::user-1::demo",
      event: "document.update",
      payload: { docId: "d1" },
      isAuthenticated: false,
    })
  );
});

