import assert from "node:assert/strict";
import { test } from "node:test";

import { validatePptSlideDeck } from "../src/llm/skills/ppt-guard.ts";
import { documentSkills } from "../src/llm/skills/document-skills.ts";

function textNode(text: string) {
  return { type: "text", text };
}

function h1(id: string, text: string) {
  return { type: "heading", attrs: { id, level: 1 }, content: [textNode(text)] };
}

function p(id: string, text: string) {
  return { type: "paragraph", attrs: { id }, content: [textNode(text)] };
}

function hr(id: string) {
  return { type: "horizontalRule", attrs: { id } };
}

function bulletList(id: string, items: string[]) {
  return {
    type: "bulletList",
    attrs: { id },
    content: items.map((t, idx) => ({
      type: "listItem",
      attrs: { id: `${id}-li-${idx}` },
      content: [{ type: "paragraph", attrs: { id: `${id}-p-${idx}` }, content: [textNode(t)] }],
    })),
  };
}

test("documentSkills exposes ppt alias and split skills", () => {
  const compat = documentSkills.find((s) => s.name === "doc-optimize-ppt");
  const outline = documentSkills.find((s) => s.name === "doc-optimize-ppt-outline");
  const htmlRender = documentSkills.find((s) => s.name === "doc-render-ppt-html");

  assert(compat, "doc-optimize-ppt skill not found");
  assert(outline, "doc-optimize-ppt-outline skill not found");
  assert(htmlRender, "doc-render-ppt-html skill not found");

  assert.equal(compat?.command, "/doc-optimize-ppt");
  assert.equal(outline?.command, "/doc-optimize-ppt-outline");
  assert.equal(htmlRender?.command, "/doc-render-ppt-html");

  assert.equal(compat?.inputSchema.safeParse({ doc_id: "doc-1" }).success, true);
  assert.equal(outline?.inputSchema.safeParse({ doc_id: "doc-1" }).success, true);
  assert.equal(htmlRender?.inputSchema.safeParse({ doc_id: "doc-1", theme: "modern" }).success, true);
  assert.equal(htmlRender?.inputSchema.safeParse({}).success, false);
});

test("ppt-guard passes for a valid slide deck", () => {
  const doc = {
    type: "doc",
    content: [
      h1("h1-cover", "系统方案汇报"),
      p("p-cover", "报告人：待填写  时间：2026-02-09"),
      hr("hr-1"),
      h1("h1-2", "背景与目标"),
      bulletList("bl-2", ["📌 背景要点", "✅ 目标要点"]),
    ],
  };

  const result = validatePptSlideDeck(doc as any);
  assert.equal(result.passed, true);
  assert.equal(result.issues.length, 0);
});

test("ppt-guard fails when a slide does not start with Heading 1", () => {
  const doc = {
    type: "doc",
    content: [
      h1("h1-cover", "系统方案汇报"),
      p("p-cover", "报告人：待填写"),
      hr("hr-1"),
      p("p-2", "这一页没有页首一级标题"),
      h1("h1-late", "不应该在这里出现"),
    ],
  };

  const result = validatePptSlideDeck(doc as any);
  assert.equal(result.passed, false);
  assert.equal(result.issues.some((m) => m.includes("第 2 页未以 Heading 1 开始")), true);
});

test("ppt-guard fails when cover slide contains bullet list", () => {
  const doc = {
    type: "doc",
    content: [
      h1("h1-cover", "系统方案汇报"),
      bulletList("bl-cover", ["这不应该出现在封面"]),
      hr("hr-1"),
      h1("h1-2", "内容页"),
      p("p-2", "ok"),
    ],
  };

  const result = validatePptSlideDeck(doc as any);
  assert.equal(result.passed, false);
  assert.equal(result.issues.some((m) => m.includes("封面页包含正文要点")), true);
});

test("ppt-guard fails on empty slide caused by consecutive horizontal rules", () => {
  const doc = {
    type: "doc",
    content: [
      h1("h1-1", "封面"),
      p("p-1", "meta"),
      hr("hr-1"),
      hr("hr-2"),
      h1("h1-3", "内容页"),
      p("p-3", "ok"),
    ],
  };

  const result = validatePptSlideDeck(doc as any);
  assert.equal(result.passed, false);
  assert.equal(result.issues.some((m) => m.includes("第 2 页为空")), true);
});

test("ppt-guard fails when a slide contains multiple Heading 1", () => {
  const doc = {
    type: "doc",
    content: [
      h1("h1-1", "封面"),
      p("p-1", "meta"),
      hr("hr-1"),
      h1("h1-2", "内容页"),
      p("p-2", "text"),
      h1("h1-2b", "重复的一级标题"),
    ],
  };

  const result = validatePptSlideDeck(doc as any);
  assert.equal(result.passed, false);
  assert.equal(result.issues.some((m) => m.includes("出现多个 Heading 1")), true);
});

