async (page) => {
  const baseUrl = "http://127.0.0.1:5173"
  const loginUrl = `${baseUrl}/#/login`
  const docUrl = `${baseUrl}/#/documents`
  const editorSelector = ".doc-editor-content .tiptap.ProseMirror"
  const actionMenuSelector = ".doc-editor-block-action-menu"
  const screenshotPath =
    "/Users/darin/mine/code/zeus/output/playwright/block-style-regression.png"
  const email = "__PW_EMAIL__"
  const password = "__PW_PASSWORD__"

  const report = {
    name: "block-style-regression",
    generatedAt: new Date().toISOString(),
    url: docUrl,
    checks: [],
    screenshot: screenshotPath,
    status: "pending",
  }

  const sleep = (ms) => page.waitForTimeout(ms)

  const assert = (condition, message, detail) => {
    if (!condition) {
      const suffix = detail ? ` | detail=${JSON.stringify(detail)}` : ""
      throw new Error(`${message}${suffix}`)
    }
  }

  const check = async (name, fn) => {
    try {
      const detail = await fn()
      report.checks.push({ name, ok: true, detail: detail ?? null })
      return detail
    } catch (error) {
      report.checks.push({
        name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  async function ensureLoggedIn() {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.fill('input[placeholder="邮箱"]', email)
    await page.fill('input[placeholder="密码"]', password)
    await page
      .locator('button:has-text("登 录"), button:has-text("登录")')
      .first()
      .click()
    await page.waitForFunction(() => !location.hash.includes("/login"), {
      timeout: 45000,
    })
  }

  async function openActionMenuByShortcut() {
    await page.click(editorSelector)
    await page.keyboard.press("Alt+/")
    await sleep(200)
    return page.locator(actionMenuSelector).isVisible().catch(() => false)
  }

  async function closeActionMenuIfOpen() {
    const open = await page
      .locator(actionMenuSelector)
      .isVisible()
      .catch(() => false)
    if (open) {
      await page.keyboard.press("Escape")
      await sleep(120)
    }
  }

  await ensureLoggedIn()
  await page.goto(docUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(800)

  const hasDocItem = await page.locator(".kb-doc-item").first().isVisible().catch(() => false)
  if (hasDocItem) {
    await page.locator(".kb-doc-item").first().click()
  } else {
    const emptyClickable = await page
      .locator(".kb-doc-empty-clickable")
      .isVisible()
      .catch(() => false)
    if (emptyClickable) {
      await page.locator(".kb-doc-empty-clickable").click()
    }
  }

  await page.waitForSelector(editorSelector, { timeout: 60000 })

  await page.click(editorSelector)
  await page.keyboard.press("Control+A")
  await page.keyboard.press("Backspace")
  await page.keyboard.type("块样式颜色回归测试")
  await sleep(120)

  await check("action-menu-has-block-style-entries", async () => {
    await closeActionMenuIfOpen()
    const opened = await openActionMenuByShortcut()
    assert(opened, "块操作菜单未打开")

    const hasBackground = await page
      .locator('.doc-editor-block-action-menu-item:has-text("块背景色")')
      .isVisible()
      .catch(() => false)
    const hasText = await page
      .locator('.doc-editor-block-action-menu-item:has-text("块文字色")')
      .isVisible()
      .catch(() => false)
    assert(hasBackground, "块菜单缺少“块背景色”入口")
    assert(hasText, "块菜单缺少“块文字色”入口")
    return { hasBackground, hasText }
  })

  await check("apply-background-color", async () => {
    await closeActionMenuIfOpen()
    const opened = await openActionMenuByShortcut()
    assert(opened, "块操作菜单未打开")

    await page.locator('.doc-editor-block-action-menu-item:has-text("块背景色")').click()
    await page
      .locator(".doc-editor-block-action-menu-color-grid .doc-editor-block-color-swatch")
      .first()
      .click()
    await sleep(180)

    const style = await page.evaluate(() => {
      const first = document.querySelector(
        ".doc-editor-content .tiptap.ProseMirror > *:first-child"
      )
      return {
        inlineStyle: (first && first.getAttribute("style")) || "",
        backgroundColor: (first && first.style && first.style.backgroundColor) || "",
      }
    })
    assert(
      style.inlineStyle.includes("background-color"),
      "背景色未写入块样式",
      style
    )
    return style
  })

  await check("apply-text-color", async () => {
    await closeActionMenuIfOpen()
    const opened = await openActionMenuByShortcut()
    assert(opened, "块操作菜单未打开")

    await page.locator('.doc-editor-block-action-menu-item:has-text("块文字色")').click()
    await page
      .locator(".doc-editor-block-action-menu-color-grid .doc-editor-block-color-swatch.text")
      .first()
      .click()
    await sleep(180)

    const style = await page.evaluate(() => {
      const first = document.querySelector(
        ".doc-editor-content .tiptap.ProseMirror > *:first-child"
      )
      return {
        inlineStyle: (first && first.getAttribute("style")) || "",
        textColor: (first && first.style && first.style.color) || "",
      }
    })
    assert(style.inlineStyle.includes("color"), "文字色未写入块样式", style)
    return style
  })

  await page.screenshot({ path: screenshotPath, fullPage: true })
  report.status = report.checks.every((item) => item.ok) ? "passed" : "failed"
  return report
}
