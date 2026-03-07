async (page) => {
  const base = "http://127.0.0.1:5173";
  const projectRef = "personal::me::chat-sidebar-test";
  const docId = "d1";

  const result = {
    assertions: [],
    floatingButtonVisible: null,
    bottomDockVisible: null,
    sidebarVisibleInitially: null,
    sidebarHiddenAfterToggle: null,
    sidebarVisibleAfterToggleBack: null,
    topbarInsideMainColumn: null,
    topbarOverlapSidebar: null,
    layoutMetrics: null,
    emptyHeroFontSize: null,
    quickActionPromptSent: null,
    screenshot: "/Users/darin/mine/code/zeus/output/playwright/document-chat-sidebar-regression.png",
  };

  const expect = (condition, message) => {
    if (!condition) {
      throw new Error(`${message}; context=${JSON.stringify(result)}`);
    }
    result.assertions.push(`PASS: ${message}`);
  };

  await page.addInitScript(({ projectRefSeed, docIdSeed }) => {
    const scopedPrefix = "/api/projects/personal/me/chat-sidebar-test";
    const docStore = {
      [docIdSeed]: {
        id: docIdSeed,
        title: "右侧对话测试文档",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "seed-content" }] }],
        },
      },
    };

    const jsonResponse = (payload, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      });

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
              key: "chat-sidebar-test",
              name: "Mock Chat Sidebar Project",
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
      if (path === `${scopedPrefix}/chat/history`) return jsonResponse({ data: [] });
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

      const hierarchyMatch = path.match(/^\/api\/projects\/personal\/me\/chat-sidebar-test\/documents\/([^/]+)\/hierarchy$/);
      if (hierarchyMatch) {
        const id = decodeURIComponent(hierarchyMatch[1]);
        const doc = docStore[id];
        return jsonResponse({
          data: doc ? [{ id: doc.id, title: doc.title }] : [],
        });
      }

      const documentMatch = path.match(/^\/api\/projects\/personal\/me\/chat-sidebar-test\/documents\/([^/]+)$/);
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
              extra: {},
            },
            body: { type: "tiptap", content: doc.content },
          },
        });
      }

      return jsonResponse({ data: {} });
    };

    localStorage.setItem("zeus_access_token", "mock-token");
    localStorage.setItem("zeus_refresh_token", "mock-refresh-token");
    localStorage.setItem("zeus.lastProjectRef", projectRefSeed);
  }, { projectRefSeed: projectRef, docIdSeed: docId });

  const runNonce = Date.now();
  await page.goto(`${base}/?pw=${runNonce}#/documents/${docId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".document-workspace-title-input", { timeout: 60000 });
  await page.waitForSelector(".doc-page-right-topbar", { timeout: 60000 });
  await page.waitForSelector(".doc-page-workarea-main", { timeout: 60000 });
  await page.waitForSelector(".doc-page-right-head", { timeout: 60000 });
  await page.waitForSelector(".doc-page-llm-sidebar.is-open", { timeout: 60000 });

  result.floatingButtonVisible = await page.locator(".chat-floating-btn").first().isVisible().catch(() => false);
  result.bottomDockVisible = await page.locator(".chat-dock-bottom").first().isVisible().catch(() => false);
  result.sidebarVisibleInitially = await page.locator(".doc-page-llm-sidebar.is-open .chat-dock-side").first().isVisible().catch(() => false);

  expect(result.floatingButtonVisible === false, "Floating chat button is removed");
  expect(result.bottomDockVisible === false, "Bottom chat dock is removed");
  expect(result.sidebarVisibleInitially === true, "Document right sidebar chat is visible by default");

  result.topbarInsideMainColumn = await page.evaluate(() => {
    const main = document.querySelector(".doc-page-workarea-main");
    const head = document.querySelector(".doc-page-right-head");
    return Boolean(main && head && main.contains(head));
  });
  expect(result.topbarInsideMainColumn === true, "Top operation area is inside left main column");

  result.layoutMetrics = await page.evaluate(() => {
    const head = document.querySelector(".doc-page-right-head");
    const sidebar = document.querySelector(".doc-page-llm-sidebar.is-open");
    if (!head || !sidebar) {
      return null;
    }
    const headRect = head.getBoundingClientRect();
    const sidebarRect = sidebar.getBoundingClientRect();
    return {
      headLeft: headRect.left,
      headRight: headRect.right,
      sidebarLeft: sidebarRect.left,
      sidebarRight: sidebarRect.right,
    };
  });
  result.topbarOverlapSidebar = result.layoutMetrics
    ? result.layoutMetrics.headRight > result.layoutMetrics.sidebarLeft + 1
    : null;
  expect(result.topbarOverlapSidebar === false, "Top operation area does not overlap right LLM sidebar");

  result.emptyHeroFontSize = await page.evaluate(() => {
    const target = document.querySelector(".doc-page-llm-sidebar .chat-dock-empty-side .chat-dock-empty-text");
    if (!target) {
      return "";
    }
    return window.getComputedStyle(target).fontSize;
  });
  expect(result.emptyHeroFontSize === "34px", "Sidebar hero title font-size is 34px");

  const firstQuickAction = page.locator(".doc-page-llm-sidebar .chat-dock-side-quick-item").first();
  await firstQuickAction.click();
  await page.waitForTimeout(250);
  result.quickActionPromptSent = await page
    .locator(".doc-page-llm-sidebar .chat-msg-user .chat-msg-text", { hasText: "创建自定义代理" })
    .first()
    .isVisible()
    .catch(() => false);
  expect(result.quickActionPromptSent === true, "Clicking quick action sends mapped prompt immediately");

  const sidebarToggleButton = page.locator('button[aria-label="隐藏 AI 对话"], button[aria-label="显示 AI 对话"]').first();
  await sidebarToggleButton.hover();
  await page.waitForTimeout(120);
  const hasHoverTooltipOverlay = await page.locator(".ant-tooltip").count().then((count) => count > 0).catch(() => false);
  expect(hasHoverTooltipOverlay === false, "LLM toggle hover does not create ant tooltip overlay");

  await sidebarToggleButton.click();
  await page.waitForTimeout(300);
  result.sidebarHiddenAfterToggle = await page.locator(".doc-page-llm-sidebar.is-closed").first().isVisible().catch(() => false);
  expect(result.sidebarHiddenAfterToggle === true, "Topbar toggle hides right sidebar chat");

  await sidebarToggleButton.click();
  await page.waitForTimeout(300);
  result.sidebarVisibleAfterToggleBack = await page.locator(".doc-page-llm-sidebar.is-open .chat-dock-side").first().isVisible().catch(() => false);
  expect(result.sidebarVisibleAfterToggleBack === true, "Topbar toggle shows right sidebar chat again");

  await page.screenshot({ path: result.screenshot, fullPage: true });
  return result;
}
