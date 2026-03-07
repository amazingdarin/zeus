import assert from "node:assert/strict";
import { test } from "node:test";

import { runSmartImportGraph } from "../src/services/smart-import-graph.ts";

test("SmartImportGraph: markdown smart import assembles doc and passes validation", async () => {
  const buffer = Buffer.from("# Title\n\nHello world.\n", "utf-8");

  const result = await runSmartImportGraph({
    userId: "u1",
    projectKey: "p1",
    title: "Example",
    parentId: "root",
    file: {
      buffer,
      originalname: "example.md",
      mimetype: "text/markdown",
      size: buffer.length,
    },
    assetMeta: {
      id: "asset-1",
      filename: "example.md",
      mime: "text/markdown",
      size: buffer.length,
    },
    smartImport: true,
    smartImportTypes: ["markdown", "word", "pdf", "image"],
    enableFormatOptimize: false,
    maxValidateAttempts: 2,
  });

  assert.equal(result.mode, "smart");
  assert.equal(result.smartType, "markdown");
  assert.equal(result.validation.passed, true);
  assert.equal(result.assembledDoc.type, "doc");
  assert.equal(Array.isArray(result.assembledDoc.content), true);

  const first = (result.assembledDoc.content as any[])[0];
  assert.equal(first.type, "file_block");
  assert.equal(first.attrs?.asset_id, "asset-1");
});

