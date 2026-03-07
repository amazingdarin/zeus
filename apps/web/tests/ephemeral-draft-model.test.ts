import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EPHEMERAL_DRAFT_ID,
  shouldEnterEphemeralDraftMode,
  shouldRedirectToEphemeralDraft,
} from "../src/features/document-page/ephemeral-draft-model";

test("enters ephemeral draft mode only when project has zero documents", () => {
  assert.equal(shouldEnterEphemeralDraftMode(0), true);
  assert.equal(shouldEnterEphemeralDraftMode(1), false);
});

test("redirects stale route doc id to ephemeral draft when project is empty", () => {
  assert.equal(
    shouldRedirectToEphemeralDraft({
      totalDocumentCount: 0,
      routeDocId: "stale-doc",
    }),
    true,
  );
  assert.equal(
    shouldRedirectToEphemeralDraft({
      totalDocumentCount: 0,
      routeDocId: EPHEMERAL_DRAFT_ID,
    }),
    false,
  );
  assert.equal(
    shouldRedirectToEphemeralDraft({
      totalDocumentCount: 2,
      routeDocId: "stale-doc",
    }),
    false,
  );
});
