import { buildPreamble, loadHarnessContext } from "./_helpers/account.mjs";

export default async function buildRunCodeScript() {
  const context = await loadHarnessContext();
  return `async (page) => {
${buildPreamble(context)}
  await primeProjectSelection(projectRef);
  await programmaticLogin();
  await selectProject(projectRef);
  await page.goto(\`${'${baseUrl}'}/#/documents\`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  const bodyText = await page.locator('body').innerText();
  if (!bodyText.includes('Harness Root')) {
    throw new Error(\`Harness Root not visible: ${'${bodyText}'}\`);
  }
  await page.screenshot({ path: 'output/harness/document-flow/smoke-login-documents.png', fullPage: true });
  return { ok: true, projectRef };
}`;
}
