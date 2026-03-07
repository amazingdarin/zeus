import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  readAsset,
  readMarkdown,
  resolveSystemDocsRoot,
  scanDocsTree,
  SystemDocsError,
} from "../src/services/system-docs.ts";

async function withSystemDocsDir(
  run: (docsDir: string) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "zeus-system-docs-"));
  const previous = process.env.SYSTEM_DOCS_DIR;
  process.env.SYSTEM_DOCS_DIR = tempRoot;

  try {
    await run(tempRoot);
  } finally {
    if (previous === undefined) {
      delete process.env.SYSTEM_DOCS_DIR;
    } else {
      process.env.SYSTEM_DOCS_DIR = previous;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("system-docs: resolve root from SYSTEM_DOCS_DIR", async () => {
  await withSystemDocsDir(async (docsDir) => {
    const resolved = await resolveSystemDocsRoot();
    assert.equal(resolved, docsDir);
  });
});

test("system-docs: scan tree keeps markdown and markdown-containing directories", async () => {
  await withSystemDocsDir(async (docsDir) => {
    await writeFile(path.join(docsDir, "overview.md"), "# Overview\n", "utf-8");
    await writeFile(path.join(docsDir, ".hidden.md"), "# hidden\n", "utf-8");

    await mkdir(path.join(docsDir, "guide"), { recursive: true });
    await writeFile(path.join(docsDir, "guide", "intro.md"), "# Intro\n", "utf-8");
    await writeFile(path.join(docsDir, "guide", "notes.txt"), "ignore", "utf-8");

    await mkdir(path.join(docsDir, "assets"), { recursive: true });
    await writeFile(path.join(docsDir, "assets", "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const tree = await scanDocsTree();

    assert.deepEqual(tree, [
      {
        type: "dir",
        name: "guide",
        path: "guide",
        children: [
          {
            type: "file",
            name: "intro.md",
            path: "guide/intro.md",
            languages: ["en"],
          },
        ],
      },
      {
        type: "file",
        name: "overview.md",
        path: "overview.md",
        languages: ["en"],
      },
    ]);
  });
});

test("system-docs: language variants are grouped by logical path", async () => {
  await withSystemDocsDir(async (docsDir) => {
    await writeFile(path.join(docsDir, "test.md"), "# English\n", "utf-8");
    await writeFile(path.join(docsDir, "test_zh.md"), "# 中文\n", "utf-8");
    await writeFile(path.join(docsDir, "guide_ja.md"), "# 日本語\n", "utf-8");

    const tree = await scanDocsTree("zh");
    assert.deepEqual(tree, [
      {
        type: "file",
        name: "guide.md",
        path: "guide.md",
        languages: ["ja"],
      },
      {
        type: "file",
        name: "test.md",
        path: "test.md",
        languages: ["en", "zh"],
      },
    ]);
  });
});

test("system-docs: markdown content only allows .md/.markdown", async () => {
  await withSystemDocsDir(async (docsDir) => {
    await writeFile(path.join(docsDir, "doc.md"), "# Doc\n", "utf-8");
    await writeFile(path.join(docsDir, "plain.txt"), "plain", "utf-8");

    const content = await readMarkdown("doc.md");
    assert.equal(content.path, "doc.md");
    assert.equal(content.content, "# Doc\n");
    assert.equal(content.language, "en");
    assert.equal(content.resolvedPath, "doc.md");

    await assert.rejects(
      () => readMarkdown("plain.txt"),
      (err: unknown) =>
        err instanceof SystemDocsError && err.code === "UNSUPPORTED_TYPE",
    );
  });
});

test("system-docs: markdown language fallback prefers matching lang, then english", async () => {
  await withSystemDocsDir(async (docsDir) => {
    await writeFile(path.join(docsDir, "test.md"), "# EN\n", "utf-8");
    await writeFile(path.join(docsDir, "test_zh.md"), "# ZH\n", "utf-8");
    await writeFile(path.join(docsDir, "only_zh.md"), "# ONLY_ZH\n", "utf-8");

    const zhDoc = await readMarkdown("test.md", "zh");
    assert.equal(zhDoc.content, "# ZH\n");
    assert.equal(zhDoc.path, "test.md");
    assert.equal(zhDoc.resolvedPath, "test_zh.md");

    const frDoc = await readMarkdown("test.md", "fr");
    assert.equal(frDoc.content, "# EN\n");
    assert.equal(frDoc.path, "test.md");
    assert.equal(frDoc.resolvedPath, "test.md");

    const onlyZhFallback = await readMarkdown("only.md", "en");
    assert.equal(onlyZhFallback.content, "# ONLY_ZH\n");
    assert.equal(onlyZhFallback.path, "only.md");
    assert.equal(onlyZhFallback.resolvedPath, "only_zh.md");
  });
});

test("system-docs: read asset supports binary file and mime", async () => {
  await withSystemDocsDir(async (docsDir) => {
    await mkdir(path.join(docsDir, "images"), { recursive: true });
    const logoPath = path.join(docsDir, "images", "logo.png");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    await writeFile(logoPath, bytes);

    const asset = await readAsset("images/logo.png");
    assert.equal(asset.path, "images/logo.png");
    assert.equal(asset.mime, "image/png");
    assert.deepEqual(asset.buffer, bytes);
  });
});

test("system-docs: path traversal is rejected", async () => {
  await withSystemDocsDir(async (docsDir) => {
    await writeFile(path.join(docsDir, "ok.md"), "# ok\n", "utf-8");

    await assert.rejects(
      () => readMarkdown("../secret.md"),
      (err: unknown) =>
        err instanceof SystemDocsError && err.code === "INVALID_PATH",
    );

    await assert.rejects(
      () => readAsset("/etc/passwd"),
      (err: unknown) =>
        err instanceof SystemDocsError && err.code === "INVALID_PATH",
    );
  });
});
