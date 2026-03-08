import fixture from "../../../fixtures/project-scope/personal.json" with { type: "json" };
import { buildPreamble, loadHarnessContext } from "../../document-flow/playwright/_helpers/account.mjs";

export default async function buildRunCodeScript() {
  const context = await loadHarnessContext();
  return `async (page) => {
${buildPreamble(context)}
  const expectedPath = '/api/projects/${fixture.ownerType}/${fixture.ownerKey}/${fixture.projectKey}/documents/tree';
  await page.addInitScript(() => {
    const calls = [];
    const originalFetch = window.fetch.bind(window);
    window.__zeusFetchCalls = calls;
    window.fetch = async (...args) => {
      const input = args[0];
      const urlText = typeof input === 'string' ? input : input?.url || '';
      const url = new URL(urlText, window.location.origin);
      calls.push(url.pathname);
      return originalFetch(...args);
    };
  });
  await primeProjectSelection(projectRef);
  await programmaticLogin();
  await page.goto(\`${'${baseUrl}'}/#/documents\`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(async () => {
    await fetch('/api/projects/personal/me/playwright-doc-flow/documents/tree', { credentials: 'include' });
  });
  await page.waitForTimeout(500);
  const calls = await page.evaluate(() => window.__zeusFetchCalls || []);
  if (!Array.isArray(calls) || !calls.includes(expectedPath)) {
    throw new Error(\`project-scope roundtrip mismatch: ${'${JSON.stringify(calls)}'} expected ${'${expectedPath}'}\`);
  }
  await page.screenshot({ path: 'output/harness/project-scope/personal-project-ref.png', fullPage: true });
  return { ok: true, matchedPath: expectedPath };
}`;
}
