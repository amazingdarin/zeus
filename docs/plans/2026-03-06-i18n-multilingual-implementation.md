# Internationalization Multilingual UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a production-ready internationalization foundation across `apps/web`, `apps/app-backend`, and `server`, with account-level language preference and first-class `zh-CN` / `en` support.

**Architecture:** The implementation keeps one shared translation key protocol across the stack while using runtime-native libraries per layer: `i18next` in React and Node, `go-i18n` in Go. Locale selection flows from local storage before login and from account settings after login, with every request carrying the active locale via headers so both backends can localize responses consistently.

**Tech Stack:** React, Vite, Tauri shell, TypeScript, Express, Go, Gin, GORM, Postgres, `i18next`, `react-i18next`, `i18next-icu`, `go-i18n`, Playwright CLI.

---

### Task 1: Create translation source layout

**Files:**
- Create: `locales/source/zh-CN/common.json`
- Create: `locales/source/zh-CN/auth.json`
- Create: `locales/source/zh-CN/document.json`
- Create: `locales/source/zh-CN/settings.json`
- Create: `locales/source/zh-CN/errors.json`
- Create: `locales/source/en/common.json`
- Create: `locales/source/en/auth.json`
- Create: `locales/source/en/document.json`
- Create: `locales/source/en/settings.json`
- Create: `locales/source/en/errors.json`
- Create: `scripts/i18n/build-locales.mjs`
- Modify: `package.json`

**Step 1: Write the failing structure check**

Create a small script expectation inside `scripts/i18n/build-locales.mjs` that exits non-zero when any required namespace file is missing.

**Step 2: Run the checker to verify it fails**

Run: `node scripts/i18n/build-locales.mjs`
Expected: FAIL because the locale files do not exist yet.

**Step 3: Add the initial locale source files**

Populate each file with a minimal seed set.

Example `locales/source/zh-CN/common.json`:

```json
{
  "app.name": "Zeus",
  "common.confirm": "确认",
  "common.cancel": "取消",
  "common.save": "保存"
}
```

Example `locales/source/en/common.json`:

```json
{
  "app.name": "Zeus",
  "common.confirm": "Confirm",
  "common.cancel": "Cancel",
  "common.save": "Save"
}
```

**Step 4: Implement the build script**

The script should:

- read `locales/source/<locale>/<namespace>.json`
- validate identical key presence across locales
- emit `locales/generated/web/<locale>/<namespace>.json`
- emit `locales/generated/app-backend/<locale>/<namespace>.json`
- emit `locales/generated/server/<locale>/<namespace>.json`

**Step 5: Add a package script**

Add:

```json
{
  "scripts": {
    "i18n:build": "node scripts/i18n/build-locales.mjs"
  }
}
```

**Step 6: Run the locale build**

Run: `npm run i18n:build`
Expected: PASS and generated files appear under `locales/generated/`.

### Task 2: Add account-level language field in Go server

**Files:**
- Modify: `server/internal/domain/user.go`
- Modify: `server/internal/modules/user/repository/postgres/model/user.go`
- Modify: `server/internal/modules/user/service/user.go`
- Modify: `server/internal/modules/user/api/types.go`
- Modify: `server/internal/modules/user/api/user.go`
- Modify: `server/internal/modules/auth/api/types.go`
- Modify: `server/internal/modules/auth/api/auth.go`
- Modify: `server/internal/modules/user/repository/postgres/user.go`
- Modify: `server/internal/modules/user/repository/repository.go`
- Create: `ddl/migrations/server.postgres/20260306-001-i18n-user-language/up.sql`
- Create: `ddl/migrations/server.postgres/20260306-001-i18n-user-language/down.sql`
- Modify: `ddl/sql/init.sql`
- Modify: `ddl/sql/init.server.postgres.sql`

**Step 1: Write the failing server-side repository test**

Add a test in the user repository package that loads and updates a `language` value.

**Step 2: Run the targeted test**

Run: `cd server && go test ./internal/modules/user/...`
Expected: FAIL because `language` is not in the domain model or database mapping.

**Step 3: Add the schema field**

Migration SQL should add:

```sql
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'zh-CN';
```

**Step 4: Extend the domain and DTOs**

Add `Language string` to the user domain, profile responses, and auth me response.

**Step 5: Extend update profile input**

Allow `PUT /api/users/me` to accept a validated language code.

**Step 6: Re-run the server tests**

Run: `cd server && go test ./internal/modules/user/... ./internal/modules/auth/...`
Expected: PASS.

### Task 3: Bootstrap locale in Web client

**Files:**
- Create: `apps/web/src/i18n/config.ts`
- Create: `apps/web/src/i18n/resources.ts`
- Create: `apps/web/src/i18n/runtime.ts`
- Create: `apps/web/src/i18n/locale-storage.ts`
- Create: `apps/web/src/hooks/useLocaleBootstrap.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/package.json`

**Step 1: Write the failing locale bootstrap test**

Add a unit test under `apps/web/tests/` that asserts the boot logic picks local storage while logged out and user language while logged in.

**Step 2: Run the targeted test**

Run: `cd apps/web && npm test -- --runInBand locale-bootstrap`
Expected: FAIL because no locale runtime exists.

**Step 3: Add the i18n runtime**

Initialize `i18next` with:

```ts
import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
```

Configure:

- `lng`
- `fallbackLng: "zh-CN"`
- namespaces `common`, `auth`, `document`, `settings`, `errors`

**Step 4: Add locale storage helpers**

Implement helpers:

- `getLocalLocale()`
- `setLocalLocale()`
- `detectBrowserLocale()`
- `normalizeLocale()`

**Step 5: Wire app bootstrap**

`App.tsx` should await locale bootstrap before rendering shell routes, similar to current session bootstrap.

**Step 6: Run the web tests**

Run: `cd apps/web && npm test -- --runInBand locale-bootstrap`
Expected: PASS.

### Task 4: Send locale headers on every web request

**Files:**
- Modify: `apps/web/src/config/api.ts`
- Create: `apps/web/src/i18n/request-locale.ts`
- Test: `apps/web/tests/api-locale-header.test.ts`

**Step 1: Write the failing request-header test**

Assert that `apiFetch()` adds `X-Zeus-Locale` and `Accept-Language`.

**Step 2: Run the targeted test**

Run: `cd apps/web && npm test -- --runInBand api-locale-header`
Expected: FAIL because headers are not sent yet.

**Step 3: Add locale header helpers**

Implement:

```ts
export function getRequestLocaleHeaders(locale: string): HeadersInit {
  return {
    "X-Zeus-Locale": locale,
    "Accept-Language": locale,
  };
}
```

**Step 4: Patch `fetchWithCredentials`**

Merge the locale headers into all requests unless the caller overrides them.

**Step 5: Re-run the targeted test**

Run: `cd apps/web && npm test -- --runInBand api-locale-header`
Expected: PASS.

### Task 5: Synchronize locale with auth state and settings UI

**Files:**
- Modify: `apps/web/src/context/AuthContext.tsx`
- Modify: `apps/web/src/api/auth.ts`
- Modify: `apps/web/src/api/general-settings.ts`
- Modify: `apps/web/src/components/GeneralSettingsPanel.tsx`
- Create: `apps/web/src/api/user-profile.ts`
- Test: `apps/web/tests/locale-auth-sync.test.ts`

**Step 1: Write the failing auth-sync test**

Cover three cases:

- logged out uses local locale
- login with server locale overrides local locale
- login without server locale writes local locale to account

**Step 2: Run the targeted test**

Run: `cd apps/web && npm test -- --runInBand locale-auth-sync`
Expected: FAIL because user locale is not part of auth payload.

**Step 3: Extend auth payload typing**

Update the `User` type to include `language`.

**Step 4: Add profile update API**

Implement an API call for updating `language` via `PUT /api/users/me`.

**Step 5: Add the language selector UI**

Update `GeneralSettingsPanel.tsx` with a `Select` or segmented control for `zh-CN` / `en`.

**Step 6: Re-run the targeted tests**

Run: `cd apps/web && npm test -- --runInBand locale-auth-sync`
Expected: PASS.

### Task 6: Localize app-backend responses

**Files:**
- Create: `apps/app-backend/src/i18n/runtime.ts`
- Create: `apps/app-backend/src/i18n/locale.ts`
- Create: `apps/app-backend/src/middleware/locale.ts`
- Create: `apps/app-backend/src/services/i18n-error.ts`
- Modify: `apps/app-backend/src/index.ts`
- Modify: `apps/app-backend/src/router.ts`
- Test: `apps/app-backend/tests/i18n-locale-middleware.test.ts`
- Test: `apps/app-backend/tests/i18n-error-response.test.ts`

**Step 1: Write the failing middleware test**

Assert that locale middleware resolves `X-Zeus-Locale`, then `Accept-Language`, then fallback.

**Step 2: Run the targeted tests**

Run: `cd apps/app-backend && npm test -- i18n-locale-middleware i18n-error-response`
Expected: FAIL because no locale middleware exists.

**Step 3: Add the runtime translator**

Load translations from `locales/generated/app-backend` with `i18next-fs-backend`.

**Step 4: Add localized error helper**

Add a helper like:

```ts
localizedError(res, req, code, status, params)
```

Return:

```json
{ "code": "INVALID_BLOCK_SHORTCUTS", "message": "...", "locale": "en" }
```

**Step 5: Patch high-frequency routes first**

Start with:

- `/settings/general`
- auth-related proxy failure paths
- document lock / comment / code-exec error paths if already using shared helpers

**Step 6: Re-run the targeted tests**

Run: `cd apps/app-backend && npm test -- i18n-locale-middleware i18n-error-response`
Expected: PASS.

### Task 7: Localize Go server responses

**Files:**
- Create: `server/internal/i18n/localizer.go`
- Create: `server/internal/api/handler/locale.go`
- Modify: `server/internal/api/handler/router.go`
- Modify: `server/internal/modules/auth/api/auth.go`
- Modify: `server/internal/modules/user/api/user.go`
- Test: `server/internal/modules/auth/api/auth_i18n_test.go`
- Test: `server/internal/modules/user/api/user_i18n_test.go`

**Step 1: Write the failing handler tests**

Assert that the same error code returns different messages for `zh-CN` and `en`.

**Step 2: Run the targeted tests**

Run: `cd server && go test ./internal/modules/auth/api ./internal/modules/user/api`
Expected: FAIL because messages are hardcoded.

**Step 3: Add locale resolution middleware**

Resolve locale from:

- `X-Zeus-Locale`
- `Accept-Language`
- authenticated user language if available
- fallback `zh-CN`

**Step 4: Add the Go localizer helper**

Wrap `go-i18n` so handlers can call a simple helper instead of embedding English strings.

**Step 5: Migrate auth and user handlers**

Replace hardcoded strings like `"not authenticated"` and `"username already taken"` with translation keys.

**Step 6: Re-run the Go tests**

Run: `cd server && go test ./internal/modules/auth/api ./internal/modules/user/api`
Expected: PASS.

### Task 8: Migrate high-priority front-end UI strings

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx`
- Modify: `apps/web/src/pages/RegisterPage.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/components/GeneralSettingsPanel.tsx`
- Modify: `apps/web/src/pages/DocumentPage.tsx`
- Test: `apps/web/tests/login-i18n.test.ts`
- Test: `apps/web/tests/settings-language-switch.test.ts`

**Step 1: Write failing UI tests**

Cover:

- login page strings switch with locale
- settings page strings switch with locale
- document page common action labels switch with locale

**Step 2: Run the targeted tests**

Run: `cd apps/web && npm test -- --runInBand login-i18n settings-language-switch`
Expected: FAIL because pages still hardcode Chinese strings.

**Step 3: Replace hardcoded strings with `t()`**

Use namespaced keys only.

Example:

```tsx
const { t } = useTranslation(["auth", "common"]);
<Button>{t("auth.login.submit")}</Button>
```

**Step 4: Re-run the targeted tests**

Run: `cd apps/web && npm test -- --runInBand login-i18n settings-language-switch`
Expected: PASS.

### Task 9: Add end-to-end regression coverage

**Files:**
- Create: `output/playwright/i18n-language-switch-regression.js`
- Modify: `AGENTS.md`

**Step 1: Write the Playwright scenario**

Cover:

- unauthenticated local locale selection
- login and account-locale sync
- page reload persistence
- server error localized rendering

**Step 2: Run the script and verify failure first**

Run: `playwright-cli run-code "$(cat output/playwright/i18n-language-switch-regression.js)"`
Expected: FAIL before implementation is complete.

**Step 3: Update `AGENTS.md` guidance if needed**

Document the expected test file or i18n regression rule only if the repository workflow needs it.

**Step 4: Re-run after implementation**

Run: `playwright-cli run-code "$(cat output/playwright/i18n-language-switch-regression.js)"`
Expected: PASS.

### Task 10: Final validation and cleanup

**Files:**
- Modify: `docs/plans/2026-03-06-i18n-multilingual-design.md`
- Modify: `docs/plans/2026-03-06-i18n-multilingual-implementation.md`

**Step 1: Build locale assets**

Run: `npm run i18n:build`
Expected: PASS.

**Step 2: Run focused web tests**

Run: `cd apps/web && npm test -- --runInBand locale-bootstrap api-locale-header locale-auth-sync login-i18n settings-language-switch`
Expected: PASS.

**Step 3: Run focused app-backend tests**

Run: `cd apps/app-backend && npm test -- i18n-locale-middleware i18n-error-response`
Expected: PASS.

**Step 4: Run focused Go tests**

Run: `cd server && go test ./internal/modules/auth/api ./internal/modules/user/api ./internal/modules/user/...`
Expected: PASS.

**Step 5: Run Playwright regression**

Run: `playwright-cli run-code "$(cat output/playwright/i18n-language-switch-regression.js)"`
Expected: PASS.

**Step 6: Update docs if reality diverges**

Keep both plan docs aligned with the final architecture if any implementation detail changes.
