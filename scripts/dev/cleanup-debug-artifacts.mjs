import { rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const targets = [
  ".playwright-cli",
  "output/playwright",
];

for (const target of targets) {
  await rm(path.join(repoRoot, target), { recursive: true, force: true });
  console.log(`removed ${target}`);
}
