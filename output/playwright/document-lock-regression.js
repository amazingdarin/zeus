async (page) => {
  const base = "http://127.0.0.1:5173";
  const projectRef = "personal::me::lock-test";
  const docId = "d1";
  const nextTitle = `锁定回归_${Date.now()}`;

  const result = {
    assertions: [],
    readonlyAfterLock: false,
    readonlyAfterUnlock: false,
    readonlyAfterFallback: false,
    editorEditableAfterLock: null,
    editorEditableAfterUnlock: null,
    switchCheckedAfterLock: null,
    switchCheckedAfterUnlock: null,
    switchCheckedAfterFallback: null,
    tabLockIconVisibleAfterLock: null,
    tabLockIconVisibleAfterUnlock: null,
    screenshot: "/Users/darin/mine/code/zeus/output/playwright/document-lock-regression.png",
  };

  const expect = (condition, message) => {
    if (!condition) {
      throw new Error(`${message}; context=${JSON.stringify(result)}`);
    }
    result.assertions.push(`PASS: ${message}`);
  };
  const waitForState = async (predicate, attempts = 30, delayMs = 200) => {
    for (let index = 0; index < attempts; index += 1) {
      if (await predicate()) {
        return true;
      }
      await page.waitForTimeout(delayMs);
    }
    return false;
  };

  await page.addInitScript(({ projectRefSeed, docIdSeed }) => {
    const scopedPrefix = "/api/projects/personal/me/lock-test";
    const docStore = {
      [docIdSeed]: {
        id: docIdSeed,
        title: "锁测试文档",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "seed-content" }] }],
        },
      },
    };
    let lock = null;

    window.__zeusLockExternally = () => {
      lock = {
        locked: true,
        lockedBy: "external-user",
        lockedAt: new Date().toISOString(),
      };
    };

    const jsonResponse = (payload, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    const readBody = async (init) => {
      try {
        if (!init || !init.body) {
          return null;
        }
        if (typeof init.body === "string") {
          return JSON.parse(init.body);
        }
      } catch {
        return null;
      }
      return null;
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input : null;
      const method = (init?.method || request?.method || "GET").toUpperCase();
      const urlText = typeof input === "string" ? input : request?.url || "";
      const url = new URL(urlText, window.location.origin);
      const path = url.pathname;

      if (!path.startsWith("/api/")) {
        return originalFetch(input, init);
      }

      if (path === "/api/system") return jsonResponse({ ok: true });
      if (path === "/api/auth/me") {
        return jsonResponse({
          id: "mock-user-1",
          email: "mock@example.com",
          username: "mockuser",
          display_name: "Mock User",
          status: "active",
          created_at: new Date().toISOString(),
        });
      }
      if (path === "/api/auth/refresh") {
        return jsonResponse({
          access_token: "mock-token",
          refresh_token: "mock-refresh-token",
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        });
      }
      if (path === "/api/projects" && method === "GET") {
        return jsonResponse({
          data: {
            contexts: [{
              owner_type: "personal",
              owner_key: "me",
              owner_id: "mock-user-1",
              owner_name: "个人",
              my_role: "owner",
              can_create: true,
            }],
            projects: [{
              id: "mock-project-1",
              key: "lock-test",
              name: "Mock Lock Project",
              owner_type: "personal",
              owner_key: "me",
              owner_id: "mock-user-1",
              owner_name: "个人",
              can_write: true,
            }],
          },
        });
      }
      if (path === "/api/teams") return jsonResponse([]);
      if (path === "/api/llm/configs/type/llm") return jsonResponse([]);
      if (path === "/api/settings/general") return jsonResponse({ data: {} });
      if (path === "/api/skills/enabled-commands") return jsonResponse({ data: [] });
      if (path === `${scopedPrefix}/skills/enabled-commands`) return jsonResponse({ data: [] });
      if (path === `${scopedPrefix}/message-center`) return jsonResponse({ active: [], history: [] });
      if (path === `${scopedPrefix}/documents/sync`) return jsonResponse({ data: { ok: true } });
      if (path === `${scopedPrefix}/documents/favorites`) return jsonResponse({ data: [] });
      if (path === `${scopedPrefix}/documents/recent-edits`) return jsonResponse({ data: [] });
      if (path === `${scopedPrefix}/documents/tree`) {
        const doc = docStore[docIdSeed];
        return jsonResponse({
          data: [{
            id: doc.id,
            title: doc.title,
            kind: "file",
            children: [],
          }],
        });
      }

      const hierarchyMatch = path.match(/^\/api\/projects\/personal\/me\/lock-test\/documents\/([^/]+)\/hierarchy$/);
      if (hierarchyMatch) {
        const id = decodeURIComponent(hierarchyMatch[1]);
        const doc = docStore[id];
        return jsonResponse({
          data: doc ? [{ id: doc.id, title: doc.title }] : [],
        });
      }

      const lockMatch = path.match(/^\/api\/projects\/personal\/me\/lock-test\/documents\/([^/]+)\/lock$/);
      if (lockMatch && method === "PUT") {
        lock = {
          locked: true,
          lockedBy: "mock-user-1",
          lockedAt: new Date().toISOString(),
        };
        return jsonResponse({ data: { lock } });
      }
      if (lockMatch && method === "DELETE") {
        lock = null;
        return jsonResponse({ data: { lock: null } });
      }

      const documentMatch = path.match(/^\/api\/projects\/personal\/me\/lock-test\/documents\/([^/]+)$/);
      if (documentMatch && method === "GET") {
        const id = decodeURIComponent(documentMatch[1]);
        const doc = docStore[id];
        if (!doc) {
          return jsonResponse({ code: "NOT_FOUND", message: "not found" }, 404);
        }
        return jsonResponse({
          data: {
            meta: {
              id: doc.id,
              title: doc.title,
              doc_type: "doc",
              parent_id: "root",
              extra: lock ? { lock } : {},
            },
            body: { type: "tiptap", content: doc.content },
          },
        });
      }

      if (documentMatch && method === "PUT") {
        const id = decodeURIComponent(documentMatch[1]);
        if (lock) {
          return jsonResponse({
            code: "DOCUMENT_LOCKED",
            message: "Document is locked",
            data: { lock },
          }, 423);
        }
        const body = await readBody(init);
        const current = docStore[id];
        const nextTitle = String(body?.meta?.title || current?.title || "无标题文档").trim() || "无标题文档";
        const nextContent = body?.body?.content || current?.content || { type: "doc", content: [] };
        docStore[id] = {
          id,
          title: nextTitle,
          content: nextContent,
        };
        return jsonResponse({
          data: {
            meta: {
              id,
              title: nextTitle,
              doc_type: "doc",
              parent_id: "root",
              extra: lock ? { lock } : {},
            },
            body: { type: "tiptap", content: nextContent },
          },
        });
      }

      return jsonResponse({ data: {} });
    };

    localStorage.setItem("zeus_access_token", "mock-token");
    localStorage.setItem("zeus_refresh_token", "mock-refresh-token");
    localStorage.setItem("zeus.lastProjectRef", projectRefSeed);
  }, { projectRefSeed: projectRef, docIdSeed: docId });

  await page.goto(`${base}/#/documents/${docId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".document-workspace-title-input", { timeout: 60000 });
  await page.waitForSelector(".doc-editor-content .ProseMirror", { timeout: 60000 });
  await page.waitForSelector(".kb-menu-button", { timeout: 60000 });

  const titleInput = page.locator(".document-workspace-title-input").first();
  const menuButton = page.locator(".kb-menu-button").first();
  let lockSwitchReady = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await menuButton.click();
    lockSwitchReady = await waitForState(
      async () => (await page.locator(".kb-menu-item-lock .ant-switch").count()) > 0,
      5,
      120,
    );
    if (lockSwitchReady) {
      break;
    }
  }
  expect(lockSwitchReady, "Lock switch renders in header menu");
  const lockSwitch = page.locator(".kb-menu-item-lock .ant-switch").first();
  const editorRoot = page.locator(".doc-editor-content .ProseMirror").first();
  const activeTabLockIcon = page.locator(".doc-page-tab.active .doc-page-tab-lock").first();

  await lockSwitch.click();
  const lockedStateReady = await waitForState(async () =>
    titleInput.evaluate((el) => el.readOnly).catch(() => false)
  );
  expect(lockedStateReady, "Workspace becomes readonly after lock toggle");
  result.readonlyAfterLock = await titleInput.evaluate((el) => el.readOnly);
  result.switchCheckedAfterLock = await lockSwitch.evaluate((el) =>
    el.classList.contains("ant-switch-checked"),
  );
  result.editorEditableAfterLock = await editorRoot.evaluate(
    (el) => el.getAttribute("contenteditable") === "true",
  );
  result.tabLockIconVisibleAfterLock = await activeTabLockIcon.isVisible().catch(() => false);
  expect(result.readonlyAfterLock, "Title input becomes readonly after lock");
  expect(result.switchCheckedAfterLock === true, "Lock switch shows checked state after lock");
  expect(result.editorEditableAfterLock === false, "Editor becomes readonly after lock");
  expect(result.tabLockIconVisibleAfterLock === true, "Tab lock icon appears after lock");

  await lockSwitch.click();
  const unlockedStateReady = await waitForState(async () =>
    titleInput.evaluate((el) => !el.readOnly).catch(() => false)
  );
  expect(unlockedStateReady, "Workspace becomes editable after unlock toggle");
  result.readonlyAfterUnlock = await titleInput.evaluate((el) => el.readOnly);
  result.switchCheckedAfterUnlock = await lockSwitch.evaluate((el) =>
    el.classList.contains("ant-switch-checked"),
  );
  result.editorEditableAfterUnlock = await editorRoot.evaluate(
    (el) => el.getAttribute("contenteditable") === "true",
  );
  result.tabLockIconVisibleAfterUnlock = await activeTabLockIcon.isVisible().catch(() => false);
  expect(!result.readonlyAfterUnlock, "Title input becomes editable after unlock");
  expect(result.switchCheckedAfterUnlock === false, "Lock switch shows unchecked state after unlock");
  expect(result.editorEditableAfterUnlock === true, "Editor becomes editable after unlock");
  expect(result.tabLockIconVisibleAfterUnlock === false, "Tab lock icon hides after unlock");

  await page.evaluate(() => {
    if (typeof window.__zeusLockExternally === "function") {
      window.__zeusLockExternally();
    }
  });

  await titleInput.click();
  await titleInput.fill(nextTitle);
  await page.waitForTimeout(1400);

  result.readonlyAfterFallback = await titleInput.evaluate((el) => el.readOnly);
  result.switchCheckedAfterFallback = await lockSwitch.evaluate((el) =>
    el.classList.contains("ant-switch-checked"),
  );
  expect(result.switchCheckedAfterFallback === true, "Save 423 updates lock switch to checked");
  expect(result.readonlyAfterFallback, "Save 423 fallback keeps workspace readonly");

  await page.screenshot({ path: result.screenshot, fullPage: true });
  return result;
}
