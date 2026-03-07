# Block Style Regression (playwright-cli)

Date: 2026-03-01  
Base URL: `http://127.0.0.1:5173`

## Script

- Regression script: `/Users/darin/mine/code/zeus/output/playwright/block-style-regression.js`
- Credential source: `/Users/darin/mine/code/zeus/output/playwright/test-account.json`

## Command

```bash
PWCLI="${CODEX_HOME:-$HOME/.codex}/skills/playwright/scripts/playwright_cli.sh"
CODE=$(node - <<'NODE'
const fs=require('fs');
const tpl=fs.readFileSync('/Users/darin/mine/code/zeus/output/playwright/block-style-regression.js','utf8');
const account=JSON.parse(fs.readFileSync('/Users/darin/mine/code/zeus/output/playwright/test-account.json','utf8'));
const escape=(v)=>String(v).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
process.stdout.write(
  tpl
    .replace('__PW_EMAIL__', escape(account.auth.email))
    .replace('__PW_PASSWORD__', escape(account.auth.password))
);
NODE
)
"$PWCLI" run-code "$CODE"
```

## Result

- `action-menu-has-block-style-entries`: passed
- `apply-background-color`: passed
- `apply-text-color`: passed
- Overall status: `passed`

## Artifact

- Screenshot: `/Users/darin/mine/code/zeus/output/playwright/block-style-regression.png`
