import assert from "node:assert/strict";
import { test } from "node:test";

import {
  querySuggestsBatchTranscription,
  normalizeAssetIdList,
  readMediaCandidatesFromArgs,
  writeMediaCandidatesToArgs,
} from "../src/services/media-transcribe-context.ts";

test("querySuggestsBatchTranscription detects multi-item intents", () => {
  assert.equal(querySuggestsBatchTranscription("把这几个视频全部转写"), true);
  assert.equal(querySuggestsBatchTranscription("transcribe all attached videos"), true);
  assert.equal(querySuggestsBatchTranscription("只转写这个视频"), false);
});

test("normalizeAssetIdList deduplicates and trims values", () => {
  const normalized = normalizeAssetIdList([" a1 ", "", "a2", "a1", null] as unknown[]);
  assert.deepEqual(normalized, ["a1", "a2"]);
});

test("write/read media candidates roundtrip via args", () => {
  const args = writeMediaCandidatesToArgs(
    {},
    [
      {
        candidateKey: "att:asset-1",
        assetId: "asset-1",
        source: "attachment",
        mediaKind: "video",
        label: "file-a.mp4 | video/mp4 | 聊天附件",
        filename: "file-a.mp4",
        mimeType: "video/mp4",
      },
      {
        candidateKey: "doc:doc-a:b1:asset-2",
        assetId: "asset-2",
        source: "document",
        mediaKind: "audio",
        label: "meeting.m4a | audio/mp4 | 文档A | block:b1",
        filename: "meeting.m4a",
        mimeType: "audio/mp4",
        docId: "doc-a",
        docTitle: "文档A",
        blockId: "b1",
      },
    ],
  );
  const parsed = readMediaCandidatesFromArgs(args);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.assetId, "asset-1");
  assert.equal(parsed[1]?.docId, "doc-a");
});
