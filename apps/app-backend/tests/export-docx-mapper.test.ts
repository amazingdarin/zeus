import assert from "node:assert/strict";
import { test } from "node:test";
import type { JSONContent } from "@tiptap/core";
import { Paragraph, Table } from "docx";

import { mapTiptapToDocxBlocks } from "../src/services/export-docx-mapper.ts";

function countParagraphs(blocks: Array<Paragraph | Table>): number {
  return blocks.filter((block) => block instanceof Paragraph).length;
}

test("docx mapper maps heading, paragraph and nested list", async () => {
  const tiptap: JSONContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "导出标题" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "正常文本" },
          { type: "text", text: "加粗", marks: [{ type: "bold" }] },
          { type: "text", text: "斜体", marks: [{ type: "italic" }] },
          {
            type: "text",
            text: "链接",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
        ],
      },
      {
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "第一层 1" }],
              },
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "第二层 bullet" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const mapped = await mapTiptapToDocxBlocks(tiptap, {
    resolveImage: async () => null,
  });

  assert.equal(mapped.blocks.length > 0, true);
  assert.equal(mapped.usesOrderedList, true);
  assert.equal(countParagraphs(mapped.blocks) >= 4, true);
  assert.deepEqual(mapped.unsupportedNodeTypes, []);
});

test("docx mapper supports table code quote hr and unknown fallback", async () => {
  const tiptap: JSONContent = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "表头" }] },
                ],
              },
              {
                type: "tableCell",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "单元格" }] },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [{ type: "text", text: "const x = 1;" }],
      },
      {
        type: "blockquote",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "引用内容" }] },
        ],
      },
      { type: "horizontalRule" },
      { type: "plugin_xxx", attrs: { foo: "bar" } },
    ],
  };

  const mapped = await mapTiptapToDocxBlocks(tiptap);

  assert.equal(mapped.blocks.some((block) => block instanceof Table), true);
  assert.equal(mapped.blocks.length >= 5, true);
  assert.deepEqual(mapped.unsupportedNodeTypes, ["plugin_xxx"]);
});
