import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const documentPage = readFileSync(path.join(repoRoot, 'apps/web/src/pages/DocumentPage.tsx'), 'utf8');

test('document page delegates logic to feature modules', () => {
  assert.match(documentPage, /features\/document-page\/document-flow-orchestrator/);
  assert.match(documentPage, /features\/document-page\/document-flow-selectors/);
});
