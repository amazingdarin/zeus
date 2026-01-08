package gitmanager

import (
	"context"
	"path/filepath"
	"time"
)

func ExampleUsage() {
	baseDir := "/var/lib/zeus/repos"
	factory := func(key GitKey) (*GitClient, error) {
		repoPath := filepath.Join(baseDir, string(key))
		return NewGitClient(
			key,
			WithRepoPath(repoPath),
			WithProjectKey(string(key)),
			WithRemoteURL("ssh://git@localhost/zeus/"+string(key)+".git"),
			WithBranch("main"),
			WithAuthor("Zeus", "zeus@example.com"),
		), nil
	}

	manager := NewGitManager(factory, WithTTL(30*time.Minute))
	ctx := context.Background()
	manager.StartGC(ctx, 5*time.Minute)

	client, err := manager.Get(GitKey("project-alpha"))
	if err != nil {
		return
	}
	defer client.Close()

	_ = client.EnsureReady(ctx)
	_ = client.Pull(ctx, "origin", "main")
	_ = client.Commit(ctx, "docs: update doc-1")
	_ = client.Push(ctx, "origin", "main")
}
