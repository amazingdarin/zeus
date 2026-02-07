import assert from "node:assert/strict";
import { test } from "node:test";

import { runDocGuard } from "../src/llm/skills/doc-guard.ts";

test("DocGuard: unknown node type treated as protocol error", () => {
  const proposed = {
    type: "doc",
    content: [
      {
        type: "weirdNode",
        attrs: { id: "x1" },
        content: [],
      },
    ],
  };

  const result = runDocGuard({
    policy: "protocol_only",
    proposedDoc: proposed,
  });

  assert.equal(result.passed, false);
  assert.equal(result.protocolPassed, false);
  assert.equal(result.issues.some((i) => i.code === "protocol_unknown_node_type"), true);
});

test("DocGuard: unknown mark type treated as protocol error", () => {
  const proposed = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: "p1" },
        content: [
          {
            type: "text",
            text: "hello",
            marks: [{ type: "nope" }],
          },
        ],
      },
    ],
  };

  const result = runDocGuard({
    policy: "protocol_only",
    proposedDoc: proposed,
  });

  assert.equal(result.passed, false);
  assert.equal(result.protocolPassed, false);
  assert.equal(result.issues.some((i) => i.code === "protocol_unknown_mark_type"), true);
});

test("DocGuard: additive strict fails when original block IDs are missing", () => {
  const original = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "A" }] },
      { type: "paragraph", attrs: { id: "b" }, content: [{ type: "text", text: "B" }] },
    ],
  };

  const proposed = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "A" }] },
    ],
  };

  const result = runDocGuard({
    policy: "additive_strict",
    originalDoc: original as any,
    proposedDoc: proposed,
  });

  assert.equal(result.protocolPassed, true);
  assert.equal(result.passed, false);
  assert.equal(result.additivePassed, false);
  assert.equal(result.issues.some((i) => i.code === "additive_deleted_blocks"), true);
});

test("DocGuard: additive strict fails when original block text is modified", () => {
  const original = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "A" }] },
    ],
  };

  const proposed = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "A changed" }] },
    ],
  };

  const result = runDocGuard({
    policy: "additive_strict",
    originalDoc: original as any,
    proposedDoc: proposed,
  });

  assert.equal(result.protocolPassed, true);
  assert.equal(result.passed, false);
  assert.equal(result.additivePassed, false);
  assert.equal(result.issues.some((i) => i.code === "additive_modified_blocks"), true);
});

test("DocGuard: additive strict allows replacing the top summary subtree", () => {
  const original = {
    type: "doc",
    content: [
      {
        type: "blockquote",
        attrs: { id: "sum" },
        content: [
          {
            type: "paragraph",
            attrs: { id: "sum-p" },
            content: [{ type: "text", text: "📝 摘要：old summary" }],
          },
        ],
      },
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "keep" }] },
    ],
  };

  const proposed = {
    type: "doc",
    content: [
      {
        type: "blockquote",
        attrs: { id: "sum-new" },
        content: [
          {
            type: "paragraph",
            attrs: { id: "sum-new-p" },
            content: [{ type: "text", text: "📝 摘要：new summary" }],
          },
        ],
      },
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "keep" }] },
    ],
  };

  const result = runDocGuard({
    policy: "additive_strict",
    originalDoc: original as any,
    proposedDoc: proposed,
  });

  assert.equal(result.protocolPassed, true);
  assert.equal(result.additivePassed, true);
  assert.equal(result.passed, true);
});

