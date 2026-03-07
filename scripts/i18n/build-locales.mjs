import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export const DEFAULT_LOCALES = ['zh-CN', 'en'];
export const DEFAULT_NAMESPACES = ['common', 'auth', 'chat', 'document', 'edu', 'settings', 'team', 'errors'];
export const DEFAULT_TARGETS = ['web', 'app-backend', 'server'];

async function readJson(filePath) {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content);
}

function normalizeObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Locale file must contain a JSON object');
  }
  return input;
}

function listKeys(input) {
  return Object.keys(input).sort((left, right) => left.localeCompare(right, 'en'));
}

function ensureSameKeys(referenceLocale, referenceKeys, locale, keys, namespace) {
  const missing = referenceKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !referenceKeys.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    const details = [
      missing.length > 0 ? `missing=[${missing.join(', ')}]` : '',
      extra.length > 0 ? `extra=[${extra.join(', ')}]` : '',
    ].filter(Boolean).join(' ');
    throw new Error(`Locale key mismatch for namespace ${namespace}: ${locale} vs ${referenceLocale} ${details}`.trim());
  }
}

async function loadNamespacePayload(rootDir, locale, namespace) {
  const filePath = path.join(rootDir, 'locales', 'source', locale, `${namespace}.json`);
  try {
    const payload = normalizeObject(await readJson(filePath));
    return { filePath, payload };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Missing locale source file: ${filePath}`);
    }
    if (error instanceof Error) {
      throw new Error(`Invalid locale source file ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

export async function buildLocales(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const locales = Array.isArray(options.locales) && options.locales.length > 0 ? options.locales : DEFAULT_LOCALES;
  const namespaces = Array.isArray(options.namespaces) && options.namespaces.length > 0 ? options.namespaces : DEFAULT_NAMESPACES;
  const targets = Array.isArray(options.targets) && options.targets.length > 0 ? options.targets : DEFAULT_TARGETS;

  for (const namespace of namespaces) {
    let referenceLocale = '';
    let referenceKeys = [];
    const payloadByLocale = new Map();

    for (const locale of locales) {
      const { payload } = await loadNamespacePayload(rootDir, locale, namespace);
      const keys = listKeys(payload);
      if (!referenceLocale) {
        referenceLocale = locale;
        referenceKeys = keys;
      } else {
        ensureSameKeys(referenceLocale, referenceKeys, locale, keys, namespace);
      }
      payloadByLocale.set(locale, payload);
    }

    for (const target of targets) {
      for (const locale of locales) {
        const outputDir = path.join(rootDir, 'locales', 'generated', target, locale);
        await mkdir(outputDir, { recursive: true });
        const outputFile = path.join(outputDir, `${namespace}.json`);
        await writeFile(outputFile, `${JSON.stringify(payloadByLocale.get(locale), null, 2)}\n`, 'utf8');
      }
    }
  }
}

async function main() {
  await buildLocales();
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
