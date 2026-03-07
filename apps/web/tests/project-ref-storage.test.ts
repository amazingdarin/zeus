import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  LAST_PROJECT_REF_STORAGE_KEY,
  PROJECT_REF_CHANGED_EVENT,
  readLastProjectRef,
  writeLastProjectRef,
} from "../src/context/project-ref-storage";

const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
const originalWindow = (globalThis as { window?: EventTarget }).window;

function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    },
  } as Storage;
}

function createWindowTarget(): EventTarget {
  return new EventTarget();
}

afterEach(() => {
  if (originalLocalStorage) {
    (globalThis as { localStorage?: Storage }).localStorage = originalLocalStorage;
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
  if (originalWindow) {
    (globalThis as { window?: EventTarget }).window = originalWindow;
  } else {
    delete (globalThis as { window?: EventTarget }).window;
  }
});

test("project ref storage: reads trimmed value from localStorage", () => {
  const storage = createStorage();
  storage.setItem(LAST_PROJECT_REF_STORAGE_KEY, " personal::me::docs ");
  (globalThis as { localStorage?: Storage }).localStorage = storage;

  assert.equal(readLastProjectRef(), "personal::me::docs");
});

test("project ref storage: writes project ref and dispatches change event", async () => {
  const storage = createStorage();
  const target = createWindowTarget();
  (globalThis as { localStorage?: Storage }).localStorage = storage;
  (globalThis as { window?: EventTarget }).window = target;

  const detail = await new Promise<string | null>((resolve) => {
    target.addEventListener(PROJECT_REF_CHANGED_EVENT, (event) => {
      resolve((event as CustomEvent<{ projectRef: string | null }>).detail.projectRef);
    }, { once: true });
    writeLastProjectRef("personal::me::docs");
  });

  assert.equal(storage.getItem(LAST_PROJECT_REF_STORAGE_KEY), "personal::me::docs");
  assert.equal(detail, "personal::me::docs");
});

test("project ref storage: clears project ref and dispatches null change event", async () => {
  const storage = createStorage();
  storage.setItem(LAST_PROJECT_REF_STORAGE_KEY, "personal::me::docs");
  const target = createWindowTarget();
  (globalThis as { localStorage?: Storage }).localStorage = storage;
  (globalThis as { window?: EventTarget }).window = target;

  const detail = await new Promise<string | null>((resolve) => {
    target.addEventListener(PROJECT_REF_CHANGED_EVENT, (event) => {
      resolve((event as CustomEvent<{ projectRef: string | null }>).detail.projectRef);
    }, { once: true });
    writeLastProjectRef("");
  });

  assert.equal(storage.getItem(LAST_PROJECT_REF_STORAGE_KEY), null);
  assert.equal(detail, null);
});
