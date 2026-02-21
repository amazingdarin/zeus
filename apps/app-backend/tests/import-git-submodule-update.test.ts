import assert from "node:assert/strict";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { simpleGit } from "simple-git";

import { __test__ } from "../src/services/import-git.ts";

const createRepo = async (repoPath: string) => {
  await mkdir(repoPath, { recursive: true });
  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig("user.name", "zeus-test");
  await git.addConfig("user.email", "zeus-test@example.com");
  return git;
};

test("updateSubmoduleInRepo initializes submodule in cloned repo", async (t) => {
  const gitProbe = simpleGit();
  const hasGit = await gitProbe.raw(["--version"]).then(
    () => true,
    () => false,
  );
  if (!hasGit) {
    t.skip("git not available in test environment");
    return;
  }

  const root = path.join(process.cwd(), ".tmp", `submodule-test-${Date.now()}`);
  const subRepo = path.join(root, "sub");
  const parentRepo = path.join(root, "parent");
  const cloneRepo = path.join(root, "clone");

  await mkdir(root, { recursive: true });
  const prevAllowProtocol = process.env.GIT_ALLOW_PROTOCOL;
  process.env.GIT_ALLOW_PROTOCOL = "file";

  try {
    const subGit = await createRepo(subRepo);
    await writeFile(path.join(subRepo, "README.md"), "submodule content");
    await subGit.add(["README.md"]);
    await subGit.commit("init submodule");

    const parentGit = await createRepo(parentRepo);
    await writeFile(path.join(parentRepo, "README.md"), "parent content");
    await parentGit.add(["README.md"]);
    await parentGit.commit("init parent");

    await parentGit.raw(["submodule", "add", subRepo, "libs/submodule"]);
    await parentGit.commit("add submodule");

    const git = simpleGit();
    await git.clone(parentRepo, cloneRepo, ["--no-recurse-submodules"]);

    await __test__.updateSubmoduleInRepo(cloneRepo, "libs/submodule");

    await stat(path.join(cloneRepo, "libs/submodule/README.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
    if (prevAllowProtocol === undefined) {
      delete process.env.GIT_ALLOW_PROTOCOL;
    } else {
      process.env.GIT_ALLOW_PROTOCOL = prevAllowProtocol;
    }
  }
});
