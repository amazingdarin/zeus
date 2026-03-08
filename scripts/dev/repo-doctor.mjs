import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const jsonOnly = args.has("--json");

function runJsonScript(relativePath, extraArgs = []) {
  try {
    const output = execFileSync("node", [relativePath, "--json", ...extraArgs], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return JSON.parse(output);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function harnessExists(relativePath) {
  return existsSync(path.join(repoRoot, relativePath));
}

const documentFlow = runJsonScript("scripts/dev/document-flow-doctor.mjs");
const report = {
  server: documentFlow.server ?? { ok: false },
  appBackend: documentFlow.appBackend ?? { ok: false },
  web: documentFlow.web ?? { ok: false },
  postgres: documentFlow.postgres ?? { ok: false },
  testAccount: documentFlow.testAccount ?? { ok: false },
  documentFlow,
  chat: {
    ok: harnessExists("tests/harness/chat/README.md") && harnessExists("tests/harness/chat/api/session-smoke.mjs"),
    harnessRoot: "tests/harness/chat",
  },
  projectScope: {
    ok: harnessExists("tests/harness/project-scope/README.md") && harnessExists("tests/harness/project-scope/api/auth-smoke.mjs"),
    harnessRoot: "tests/harness/project-scope",
  },
  plugins: {
    ok: harnessExists("docs/architecture/plugins.md") && harnessExists("docs/evals/plugins.md"),
    note: "plugin harness skeleton planned via roadmap tasks",
  },
};

if (jsonOnly) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

for (const [key, value] of Object.entries(report)) {
  process.stdout.write(`${key}: ${JSON.stringify(value)}\n`);
}
