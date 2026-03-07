import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

export async function loadHarnessContext() {
  const account = await readJson("output/playwright/test-account.json");
  const project = await readJson("tests/fixtures/document-flow/project.json");
  const baseUrl = String(account.baseUrl || "http://127.0.0.1:1420").replace("[::1]", "127.0.0.1");
  return {
    baseUrl,
    email: String(account.auth?.email || ""),
    password: String(account.auth?.password || ""),
    projectRef: `${project.ownerType}::${project.ownerKey}::${project.projectKey}`,
    emptyProjectRef: `${project.ownerType}::${project.ownerKey}::${project.emptyProjectKey}`,
  };
}

export function buildPreamble(context) {
  return [
    `const baseUrl = ${JSON.stringify(context.baseUrl)};`,
    `const email = ${JSON.stringify(context.email)};`,
    `const password = ${JSON.stringify(context.password)};`,
    `const projectRef = ${JSON.stringify(context.projectRef)};`,
    `const emptyProjectRef = ${JSON.stringify(context.emptyProjectRef)};`,
    `async function primeProjectSelection(ref) {`,
    `  await page.addInitScript((value) => { window.localStorage.setItem('zeus.lastProjectRef', value); }, ref);`,
    `}`,
    `async function loginThroughUi() {`,
    `  await page.goto(\`${'${baseUrl}'}/#/login\`, { waitUntil: 'domcontentloaded', timeout: 60000 });`,
    `  await page.locator('input[placeholder="邮箱"], input[placeholder="Email"]').first().fill(email);`,
    `  await page.locator('input[placeholder="密码"], input[placeholder="Password"]').first().fill(password);`,
    `  await page.locator('button').filter({ hasText: /登\\s*录|Sign in/ }).first().click();`,
    `  await page.locator('.sidebar-user').first().waitFor({ timeout: 60000 });`,
    `}`,
    `async function selectProject(ref) {`,
    `  await page.evaluate((value) => { window.localStorage.setItem('zeus.lastProjectRef', value); }, ref);`,
    `}`,
  ].join("\n");
}
