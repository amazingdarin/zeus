import { access, mkdir } from "node:fs/promises";
import path from "node:path";

import { simpleGit, type SimpleGit } from "simple-git";

export type DocumentGitRepo = {
  ensureRepository(projectRoot: string): Promise<void>;
  add(projectRoot: string, pathspec: string[]): Promise<void>;
  hasChanges(projectRoot: string): Promise<boolean>;
  hasCommits(projectRoot: string): Promise<boolean>;
  commit(projectRoot: string, message: string): Promise<string | undefined>;
  ensureRemote(projectRoot: string, remoteUrl: string): Promise<void>;
  pushForceWithLease(projectRoot: string, branch: string): Promise<void>;
  createTag(projectRoot: string, tagName: string): Promise<void>;
};

const DEFAULT_BRANCH = "main";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createGitClient(projectRoot: string): SimpleGit {
  return simpleGit({ baseDir: projectRoot });
}

export function createSimpleGitRepo(): DocumentGitRepo {
  return {
    async ensureRepository(projectRoot: string): Promise<void> {
      await mkdir(projectRoot, { recursive: true });
      const gitDir = path.join(projectRoot, ".git");
      const git = createGitClient(projectRoot);
      if (!(await exists(gitDir))) {
        await git.init();
        await git.raw(["symbolic-ref", "HEAD", `refs/heads/${DEFAULT_BRANCH}`]);
      }
    },

    async add(projectRoot: string, pathspec: string[]): Promise<void> {
      const git = createGitClient(projectRoot);
      await git.add(pathspec);
    },

    async hasChanges(projectRoot: string): Promise<boolean> {
      const git = createGitClient(projectRoot);
      const status = await git.status();
      return !status.isClean();
    },

    async hasCommits(projectRoot: string): Promise<boolean> {
      const git = createGitClient(projectRoot);
      try {
        await git.raw(["rev-parse", "HEAD"]);
        return true;
      } catch {
        return false;
      }
    },

    async commit(projectRoot: string, message: string): Promise<string | undefined> {
      const git = createGitClient(projectRoot);
      const result = await git.commit(message);
      return result.commit;
    },

    async ensureRemote(projectRoot: string, remoteUrl: string): Promise<void> {
      const git = createGitClient(projectRoot);
      const remotes = await git.getRemotes(true);
      const origin = remotes.find((item) => item.name === "origin");
      if (!origin) {
        await git.addRemote("origin", remoteUrl);
        return;
      }

      const fetchUrl = origin.refs.fetch;
      const pushUrl = origin.refs.push;
      if (fetchUrl !== remoteUrl || pushUrl !== remoteUrl) {
        await git.raw(["remote", "set-url", "origin", remoteUrl]);
      }
    },

    async pushForceWithLease(projectRoot: string, branch: string): Promise<void> {
      const git = createGitClient(projectRoot);
      await git.push("origin", branch, ["--force-with-lease", "-u"]);
    },

    async createTag(projectRoot: string, tagName: string): Promise<void> {
      const git = createGitClient(projectRoot);
      await git.raw(["tag", tagName]);
    },
  };
}

