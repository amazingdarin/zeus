import { execFileSync } from "node:child_process";
import process from "node:process";

const repoRoot = process.cwd();

execFileSync("node", ["scripts/dev/repo-doctor.mjs"], {
  cwd: repoRoot,
  stdio: "inherit",
});

process.stdout.write("\nNext steps:\n");
process.stdout.write("1. npm run seed:doc-flow\n");
process.stdout.write("2. npm run eval:doc-flow:smoke\n");
process.stdout.write("3. npm run eval:chat:api\n");
process.stdout.write("4. npm run eval:project-scope:api\n");
