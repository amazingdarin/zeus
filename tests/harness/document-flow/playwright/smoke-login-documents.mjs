import { buildPreamble, loadHarnessContext } from "./_helpers/account.mjs";

export default async function buildRunCodeScript() {
  const context = await loadHarnessContext();
  return `async (page) => {
${buildPreamble(context)}
  await primeProjectSelection(projectRef);
  await programmaticLogin();
  await selectProject(projectRef);
  await page.goto(\`${'${baseUrl}'}/#/documents/doc-flow-commented\`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let bodyText = '';
  let visible = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    bodyText = await page.locator('body').innerText().catch(() => '');
    if (bodyText.includes('Commented Child')) {
      visible = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  if (!visible) {
    throw new Error(\`Commented Child not visible: ${'${bodyText}'}\`);
  }
  await page.screenshot({ path: 'output/harness/document-flow/smoke-login-documents.png', fullPage: true });
  return { ok: true, projectRef, docId: 'doc-flow-commented' };
}`;
}
