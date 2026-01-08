package gitclient

import (
	"context"
	"strings"
)

var (
	DefaultInitFunc = func(ctx context.Context, client *GitClient) error {
		return client.ensureReady(ctx)
	}

	DevGitClientFactory = func(key GitKey, remoteURL string) *GitClient {
		if strings.TrimSpace(remoteURL) == "" {
			remoteURL = "git@localhost:zeus/" + string(key) + ".git"
		}
		return NewGitClient(
			key,
			WithRepoPath("/var/lib/zeus/repos/"+string(key)),
			WithProjectKey(string(key)),
			WithRemoteURL(remoteURL),
			WithBranch("main"),
			WithAuthor("Zeus", "zeus@local"),
			WithInitFunc(DefaultInitFunc),
		)
	}
)
