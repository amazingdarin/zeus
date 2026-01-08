package gitclient

import (
	"context"
	"strings"
)

var (
	DefaultInitFunc = func(ctx context.Context, client *GitClient) error {
		return client.ensureReady(ctx)
	}

	DevGitClientFactory = func(key GitKey, repo string) *GitClient {
		if strings.TrimSpace(repo) == "" {
			repo = string(key) + ".git"
		}
		return NewGitClient(
			key,
			WithRepoPath("/var/lib/zeus/repos/"+string(key)),
			WithProjectKey(string(key)),
			WithRemoteURL("git@localhost:zeus/"),
			WithRepo(repo),
			WithBranch("main"),
			WithAuthor("Zeus", "zeus@local"),
			WithInitFunc(DefaultInitFunc),
		)
	}
)
