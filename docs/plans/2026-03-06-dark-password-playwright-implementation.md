# Dark Password Input And Playwright Account Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix dark-theme password inputs across the web app and reinitialize the shared Playwright frontend test account.

**Architecture:** Keep the UI fix in the existing global Ant Design dark-mode CSS override layer, and treat the Playwright credential file as the canonical artifact regenerated from the auth API. Verify with a focused CSS regression test plus a real headless Playwright login.

**Tech Stack:** React, Ant Design, CSS, Node test runner, Playwright CLI, Go auth API.

---

### Task 1: Add a CSS regression test for dark password inputs

**Files:**
- Create: `docs/plans/2026-03-06-dark-password-playwright-design.md`
- Create: `docs/plans/2026-03-06-dark-password-playwright-implementation.md`
- Create: `apps/web/tests/dark-password-input-style.test.ts`

**Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

test("dark theme styles password wrappers and autofill states", () => {
  assert.match(css, /\[data-theme="dark"\][^\n]*\.ant-input-password/);
  assert.match(css, /:-webkit-autofill/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test apps/web/tests/dark-password-input-style.test.ts`
Expected: FAIL because the dark password autofill selectors are missing.

**Step 3: Write minimal implementation**

Add the missing selector expectations only after verifying the initial failure.

**Step 4: Run test to verify it passes**

Run: `node --import tsx --test apps/web/tests/dark-password-input-style.test.ts`
Expected: PASS.

### Task 2: Implement the dark password CSS fix

**Files:**
- Modify: `apps/web/src/App.css`
- Test: `apps/web/tests/dark-password-input-style.test.ts`

**Step 1: Write the minimal CSS change**

Add dark-mode rules for:

- `.ant-input-affix-wrapper`, `.ant-input-password`
- nested `.ant-input` inside those wrappers
- `:-webkit-autofill` on both standard and password inputs
- suffix icon color for password visibility toggle

**Step 2: Run the focused regression test**

Run: `node --import tsx --test apps/web/tests/dark-password-input-style.test.ts`
Expected: PASS.

**Step 3: Run the existing locale/auth smoke test**

Run: `node --import tsx --test apps/web/tests/auth-settings-locale-resources.test.ts`
Expected: PASS.

### Task 3: Reinitialize the Playwright shared test account

**Files:**
- Modify: `output/playwright/test-account.json`

**Step 1: Start the required local services**

Run the local auth server and frontend so the account can be created and verified.

**Step 2: Register a fresh account through the auth API**

Use `curl` or a short script against `http://127.0.0.1:8080/api/auth/register` with a unique email/username and a strong password.

**Step 3: Update the canonical account file**

Write the new email, password, user id, username, display name, and timestamp to `output/playwright/test-account.json`.

**Step 4: Verify login via Playwright headless run**

Use the shared credential file to perform a login flow against `http://127.0.0.1:5173`.
Expected: login succeeds and lands on the authenticated app shell.

### Task 4: Final verification

**Files:**
- Verify: `apps/web/src/App.css`
- Verify: `apps/web/tests/dark-password-input-style.test.ts`
- Verify: `output/playwright/test-account.json`

**Step 1: Run focused tests**

Run:

```bash
node --import tsx --test apps/web/tests/dark-password-input-style.test.ts apps/web/tests/auth-settings-locale-resources.test.ts
```

Expected: PASS.

**Step 2: Run the required frontend browser verification**

Run a headless Playwright check using the new shared account and verify the login page works under dark mode.

**Step 3: Inspect git diff**

Run: `git diff -- apps/web/src/App.css apps/web/tests/dark-password-input-style.test.ts output/playwright/test-account.json docs/plans/2026-03-06-dark-password-playwright-design.md docs/plans/2026-03-06-dark-password-playwright-implementation.md`
Expected: only the intended UI, plan, and account changes are present.
