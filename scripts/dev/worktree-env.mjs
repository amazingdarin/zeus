import path from "node:path";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const jsonOnly = args.has("--json");
const cwd = process.cwd();
const repoName = path.basename(cwd);
const gitDir = path.join(cwd, '.git');
const worktreeName = repoName;

function hashText(input) {
  let hash = 0;
  for (const char of input) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1000;
  }
  return hash;
}

const offset = hashText(cwd);
const report = {
  worktreeName,
  repoRoot: cwd,
  gitDir,
  ports: {
    web: 1400 + (offset % 100),
    appBackend: 4800 + (offset % 100),
    server: 8080 + (offset % 20),
  },
  artifactRoot: path.join(cwd, 'output', 'harness', worktreeName),
  seedNamespace: `wt-${worktreeName}-${offset}`,
};

if (jsonOnly) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}
for (const [key, value] of Object.entries(report)) {
  process.stdout.write(`${key}: ${JSON.stringify(value)}\n`);
}
