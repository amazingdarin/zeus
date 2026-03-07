import { buildPreamble, loadHarnessContext } from "./_helpers/account.js";

export default async function buildRunCodeScript() {
  const context = await loadHarnessContext();
  return `async (page) => {
${buildPreamble(context)}
  const result = { login: false, switchedToEn: false, chatPage: false, systemDocs: false, restoredZh: false };
  async function openSettings() {
    await page.locator('.sidebar-user').click();
    await page.getByText(/设置|Settings/).last().click();
    await page.locator('.settings-modal').waitFor({ timeout: 15000 });
  }
  await primeProjectSelection(projectRef);
  await loginThroughUi();
  result.login = true;
  await selectProject(projectRef);
  await page.goto(\`${'${baseUrl}'}/#/documents\`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await openSettings();
  await page.getByText(/通用配置|General/).first().click();
  const languageCard = page.locator('.general-settings-card').filter({ hasText: /界面语言|Interface language/ }).first();
  await languageCard.locator('.ant-select').first().click();
  await page.locator('.ant-select-item-option').filter({ hasText: 'English' }).first().click();
  await languageCard.getByRole('button', { name: /应用语言|Apply language/ }).click();
  await page.waitForTimeout(1200);
  result.switchedToEn = await page.locator('.settings-modal').getByText('Settings').first().isVisible().catch(() => false);
  if (!result.switchedToEn) throw new Error('Failed to switch UI to English');
  await page.keyboard.press('Escape');
  await page.goto(\`${'${baseUrl}'}/#/chat\`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const chatPlaceholder = await page.locator('textarea').first().getAttribute('placeholder').catch(() => null);
  result.chatPage = chatPlaceholder === 'Type a message, @ to scope documents, @ppt for templates, / for commands...';
  if (!result.chatPage) throw new Error(\`Chat page placeholder mismatch: ${'${chatPlaceholder}'}\`);
  await page.goto(\`${'${baseUrl}'}/#/system-docs\`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  result.systemDocs = await page.getByText('Tutorial docs').first().isVisible().catch(() => false);
  if (!result.systemDocs) throw new Error('System docs page did not render English title');
  await page.evaluate(async () => {
    const token = window.localStorage.getItem('zeus_access_token');
    if (!token) throw new Error('missing zeus_access_token');
    const response = await fetch('/api/users/me', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': ` + "`Bearer ${token}`" + `,
        'X-Zeus-Locale': 'zh-CN',
        'Accept-Language': 'zh-CN'
      },
      body: JSON.stringify({ language: 'zh-CN' }),
      credentials: 'include'
    });
    if (!response.ok) throw new Error(` + "`restore locale failed: ${response.status}`" + `);
    window.localStorage.setItem('zeus.language', 'zh-CN');
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.goto(\`${'${baseUrl}'}/#/documents\`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);
  await openSettings();
  result.restoredZh = await page.locator('.settings-modal').getByText('设置').first().isVisible().catch(() => false);
  if (!result.restoredZh) throw new Error('Failed to restore UI to zh-CN');
  await page.screenshot({ path: 'output/harness/document-flow/i18n.png', fullPage: true });
  return result;
}`;
}
