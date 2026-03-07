import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const scriptUrl = pathToFileURL(path.resolve('scripts/i18n/build-locales.mjs')).href;

async function setupSource(root) {
  const sourceRoot = path.join(root, 'locales', 'source');
  await mkdir(path.join(sourceRoot, 'zh-CN'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'en'), { recursive: true });
  return sourceRoot;
}

test('buildLocales throws when required namespace file is missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zeus-i18n-missing-'));
  const sourceRoot = await setupSource(root);
  await writeFile(path.join(sourceRoot, 'zh-CN', 'common.json'), JSON.stringify({ 'app.name': 'Zeus' }));
  const { buildLocales } = await import(scriptUrl);
  await assert.rejects(
    () => buildLocales({ rootDir: root }),
    /Missing locale source file/,
  );
});

test('buildLocales emits generated resources for all targets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zeus-i18n-build-'));
  const sourceRoot = await setupSource(root);

  const namespaces = {
    common: {
      'app.name': ['Zeus', 'Zeus'],
      'common.confirm': ['确认', 'Confirm'],
    },
    auth: {
      'auth.login.title': ['登录', 'Sign in'],
    },
  };

  for (const [namespace, values] of Object.entries(namespaces)) {
    const zh = {};
    const en = {};
    for (const [key, [zhValue, enValue]] of Object.entries(values)) {
      zh[key] = zhValue;
      en[key] = enValue;
    }
    await writeFile(path.join(sourceRoot, 'zh-CN', `${namespace}.json`), JSON.stringify(zh, null, 2));
    await writeFile(path.join(sourceRoot, 'en', `${namespace}.json`), JSON.stringify(en, null, 2));
  }

  const { buildLocales } = await import(scriptUrl);
  await buildLocales({ rootDir: root, locales: ['zh-CN', 'en'], namespaces: ['common', 'auth'] });

  const webCommon = path.join(root, 'locales', 'generated', 'web', 'en', 'common.json');
  const serverAuth = path.join(root, 'locales', 'generated', 'server', 'zh-CN', 'auth.json');
  await access(webCommon);
  await access(serverAuth);

  const commonPayload = JSON.parse(await readFile(webCommon, 'utf8'));
  const authPayload = JSON.parse(await readFile(serverAuth, 'utf8'));
  assert.equal(commonPayload['common.confirm'], 'Confirm');
  assert.equal(authPayload['auth.login.title'], '登录');
});
