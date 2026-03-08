import { buildPreamble, loadHarnessContext } from "../../document-flow/playwright/_helpers/account.mjs";

export default async function buildRunCodeScript() {
  const context = await loadHarnessContext();
  return `async (page) => {
${buildPreamble(context)}
  await primeProjectSelection(projectRef);
  await programmaticLogin();
  const payload = await page.evaluate(async () => {
    const token = window.localStorage.getItem('zeus_access_token');
    const response = await fetch('/api/plugins/v2/me/runtime', {
      headers: { Authorization: ` + "`Bearer ${token}`" + ` },
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(` + "`plugin runtime request failed: ${response.status}`" + `);
    }
    return await response.json();
  });
  const plugins = Array.isArray(payload?.data?.plugins) ? payload.data.plugins : [];
  if (plugins.length === 0) {
    throw new Error('expected at least one plugin runtime item');
  }
  await page.screenshot({ path: 'output/harness/plugins/runtime-smoke.png', fullPage: true });
  return { ok: true, pluginCount: plugins.length };
}`;
}
