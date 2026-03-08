import { buildPreamble, loadHarnessContext } from "./_helpers/account.mjs";

export default async function buildRunCodeScript() {
  const context = await loadHarnessContext();
  return `async (page) => {
${buildPreamble(context)}
  await primeProjectSelection(projectRef);
  await programmaticLogin();
  await selectProject(projectRef);
  const consoleEntries = [];
  page.on('console', (message) => {
    consoleEntries.push({ type: message.type(), text: message.text() });
  });
  await page.goto(\`${'${baseUrl}'}/#/documents\`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const projectContextWarnings = consoleEntries.filter((entry) =>
    entry.text.includes('Missing project context for plugin operation')
    || entry.text.includes('[ppt-plugin] Failed to read template catalog')
    || entry.text.includes('[ppt-plugin] Failed to bootstrap template catalog')
  );
  await page.screenshot({ path: 'output/harness/document-flow/ppt-context.png', fullPage: true });
  return { totalConsoleEntries: consoleEntries.length, projectContextWarnings };
}`;
}
