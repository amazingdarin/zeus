import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { updateCurrentUserProfile } from "../src/api/user-profile";

const originalFetch = globalThis.fetch;
const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
const originalDocument = (globalThis as { document?: { cookie?: string } }).document;

function createStorage() {
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
  } as Storage;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalLocalStorage) {
    (globalThis as { localStorage?: Storage }).localStorage = originalLocalStorage;
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
  if (originalDocument) {
    (globalThis as { document?: { cookie?: string } }).document = originalDocument;
  } else {
    delete (globalThis as { document?: { cookie?: string } }).document;
  }
});

test("user-profile api: updateCurrentUserProfile sends language payload", async () => {
  const storage = createStorage();
  storage.setItem("zeus_access_token", "token-1");
  storage.setItem("zeus.language", "en");
  (globalThis as { localStorage?: Storage }).localStorage = storage;
  (globalThis as { document?: { cookie?: string } }).document = { cookie: "" };

  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(
      JSON.stringify({
        id: "user-1",
        email: "test@example.com",
        username: "tester",
        display_name: "Tester",
        language: "en",
        status: "active",
        created_at: new Date().toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const user = await updateCurrentUserProfile({ language: "en" });
  assert.equal(requestUrl, "/api/users/me");
  assert.equal((requestInit?.method ?? "GET").toUpperCase(), "PUT");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("Authorization"), "Bearer token-1");
  assert.equal(headers.get("X-Zeus-Locale"), "en");
  assert.equal(headers.get("Accept-Language"), "en");
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(String(requestInit?.body ?? "{}")), { language: "en" });
  assert.equal(user.language, "en");
});
