package gitclient

import (
	"context"
	"time"
)

// ExampleUsage demonstrates safe acquisition and release.
// EnsureReady is invoked once per client lifecycle, while the manager
// reuses clients and garbage collects idle instances automatically.
func ExampleUsage() {
	ctx := context.Background()
	manager := NewGitClientManager("/var/lib/zeus/repos", func(key GitKey, baseRepoUrl, repo string) *GitClient {
		return NewGitClient(
			key,
			WithRepoPath("/var/lib/zeus/repos/"+string(key)),
			WithProjectKey(string(key)),
			WithRemoteURL(baseRepoUrl+"/"+repo),
			WithBranch("main"),
			WithAuthor("Zeus", "zeus@local"),
			WithInitFunc(func(ctx context.Context, client *GitClient) error {
				return client.ensureReady(ctx)
			}),
		)
	})
	manager.StartGC(ctx, 2*time.Minute, 10*time.Minute)

	handle, _ := manager.Get(GitKey("repo-alpha"), "git@localhost:zeus/repo-alpha.git")
	defer handle.Close()

	client := handle.Client()
	_ = client.EnsureReady(ctx)
	_ = client.Pull(ctx, "origin", "main")
}
