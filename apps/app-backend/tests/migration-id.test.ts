import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareMigrationIds,
  parseMigrationId,
} from "../src/migrations/migration-id.ts";

test("parseMigrationId parses valid id", () => {
  const parsed = parseMigrationId("20260301-001-v1.0.0");
  assert.equal(parsed.id, "20260301-001-v1.0.0");
  assert.equal(parsed.date, "20260301");
  assert.equal(parsed.seq, 1);
  assert.equal(parsed.seqRaw, "001");
  assert.equal(parsed.schemaVersion, "v1.0.0");
});

test("parseMigrationId rejects invalid id", () => {
  assert.throws(() => parseMigrationId("2026-01-v1.0.0"), /Invalid migration id/);
});

test("compareMigrationIds sorts by date then seq then id", () => {
  const ids = [
    "20260301-010-v1.0.0",
    "20260301-002-v1.0.0",
    "20260228-999-v1.0.0",
    "20260301-002-v1.0.1",
  ];

  ids.sort(compareMigrationIds);

  assert.deepEqual(ids, [
    "20260228-999-v1.0.0",
    "20260301-002-v1.0.0",
    "20260301-002-v1.0.1",
    "20260301-010-v1.0.0",
  ]);
});

