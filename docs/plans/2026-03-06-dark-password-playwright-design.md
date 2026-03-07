# Dark Password Input And Playwright Account Design

## Scope

This change has two goals:

1. Fix dark theme password inputs across the web app so Ant Design `Input.Password` fields do not render with a light inner background, including browser autofill states.
2. Reinitialize the shared Playwright frontend test account and update the canonical credential file used by regression scripts.

## UI Approach

The project already centralizes most Ant Design dark-theme overrides in `apps/web/src/App.css`. The bug is caused by incomplete coverage for password wrappers and the nested input element. The fix should stay in that same global override layer instead of adding page-specific patches.

The change will:

- extend dark-mode selectors for `.ant-input-affix-wrapper` and `.ant-input-password`
- explicitly style the nested `.ant-input` inside password wrappers
- force browser autofill states to keep the dark background and readable foreground
- keep hover/focus behavior aligned with existing dark input styles
- cover the password visibility icon color so it remains readable on dark surfaces

This keeps login, register, and settings/password fields visually consistent without touching component logic.

## Testing Approach

For a minimal regression guard, add a Node test that inspects `apps/web/src/App.css` and asserts the presence of the dark-theme password wrapper and autofill selectors. This matches the repository's lightweight CSS/config regression style.

For end-to-end verification, run Playwright in headless mode after the UI change and use the regenerated shared test account to log in.

## Playwright Account Reinitialization

The source of truth remains `output/playwright/test-account.json`. Reinitialization will happen through the existing auth API, using a fresh email/username if the previous account already exists or has invalid credentials.

The update will:

- register a new valid test account against the running local auth server
- write the resulting credentials and user metadata back to `output/playwright/test-account.json`
- preserve the file's purpose and usage notes while updating timestamps and identifiers

## Risk Management

The UI fix is CSS-only and intentionally avoids token/theme refactors. The main risk is over-broad selectors affecting non-password affix inputs. This is reduced by targeting password-specific classes and verifying the login flow visually.

The Playwright account update risk is low because it only changes the shared test credential file after a successful auth registration/login round trip.
