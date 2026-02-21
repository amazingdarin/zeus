import assert from "node:assert/strict";
import test from "node:test";

import {
  documentContainsAnyBlockType,
  normalizeBlockTypeQuery,
} from "../src/services/document-filter.ts";

test("normalizeBlockTypeQuery trims and deduplicates values", () => {
  const blockTypes = normalizeBlockTypeQuery(" edu_question_set, file_block , edu_question_set ");
  assert.equal(blockTypes.size, 2);
  assert.equal(blockTypes.has("edu_question_set"), true);
  assert.equal(blockTypes.has("file_block"), true);
});

test("documentContainsAnyBlockType matches direct tiptap doc", () => {
  const body = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      { type: "edu_question_set", attrs: { stem: "题干" } },
    ],
  };

  const matched = documentContainsAnyBlockType(body, new Set(["edu_question_set"]));
  assert.equal(matched, true);
});

test("documentContainsAnyBlockType matches wrapped tiptap body", () => {
  const body = {
    type: "tiptap",
    content: {
      meta: {},
      content: {
        type: "doc",
        content: [{ type: "edu_question_set", attrs: { stem: "题干" } }],
      },
    },
  };

  const matched = documentContainsAnyBlockType(body, new Set(["edu_question_set"]));
  assert.equal(matched, true);
});

test("documentContainsAnyBlockType returns false when no block matches", () => {
  const body = {
    type: "doc",
    content: [{ type: "heading", attrs: { level: 1 } }],
  };

  const matched = documentContainsAnyBlockType(body, new Set(["edu_question_set"]));
  assert.equal(matched, false);
});

test("documentContainsAnyBlockType returns true when any block type matches", () => {
  const body = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "intro" }] },
      { type: "file_block", attrs: { file_name: "a.txt" } },
    ],
  };

  const matched = documentContainsAnyBlockType(body, new Set(["edu_question_set", "file_block"]));
  assert.equal(matched, true);
});
