import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/dev/run-playwright-harness.mjs <module-path>");
  process.exit(1);
}

const repoRoot = process.cwd();
const modulePath = path.resolve(repoRoot, target);
const pwcli = path.join(process.env.CODEX_HOME || path.join(process.env.HOME || "", ".codex"), "skills/playwright/scripts/playwright_cli.sh");
const loaded = await import(`file://${modulePath}`);
if (typeof loaded.default !== "function") {
  throw new Error(`${target} must export a default async function`);
}
const script = await loaded.default();
try {
  execFileSync(pwcli, ["close-all"], { stdio: "ignore" });
} catch {}
execFileSync(pwcli, ["open", "about:blank"], { stdio: "inherit" });
execFileSync(pwcli, ["run-code", script], { stdio: "inherit", maxBuffer: 1024 * 1024 * 20 });
