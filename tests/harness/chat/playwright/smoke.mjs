import { buildPreamble, loadHarnessContext } from "../../document-flow/playwright/_helpers/account.mjs";

export default async function buildRunCodeScript() {
  const context = await loadHarnessContext();
  return `async (page) => {
${buildPreamble(context)}
  await primeProjectSelection(projectRef);
  await programmaticLogin();
  await selectProject(projectRef);
  await page.goto(\`${'${baseUrl}'}/#/chat\`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1000);
  const placeholder = await page.locator('textarea').first().getAttribute('placeholder').catch(() => null);
  if (!placeholder) {
    throw new Error('chat textarea placeholder is missing');
  }
  await page.screenshot({ path: 'output/harness/chat/smoke.png', fullPage: true });
  return { ok: true, placeholder };
}`;
}
