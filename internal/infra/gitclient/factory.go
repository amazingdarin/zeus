package gitclient

import (
	"context"
)

var (
	DefaultInitFunc = func(ctx context.Context, client *GitClient) error {
		return client.ensureReady(ctx)
	}

	DevGitClientFactory = func(key GitKey) *GitClient {
		return NewGitClient(
			key,
			WithRepoPath("/var/lib/zeus/repos/"+string(key)),
			WithProjectKey(string(key)),
			WithRemoteURL("git@localhost:zeus/"+string(key)+".git"),
			WithBranch("main"),
			WithAuthor("Zeus", "zeus@local"),
			WithInitFunc(DefaultInitFunc),
		)
	}
)
