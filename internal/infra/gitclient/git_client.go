package gitclient

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"
)

const DefaultRepoRoot = "/var/lib/zeus/repos"

var RepoRoot = DefaultRepoRoot

type GitClient interface {
	EnsureCloned(ctx context.Context, repoURL, localPath string) error
	PullRebase(ctx context.Context, localPath, branch string) error
	CheckoutBranch(ctx context.Context, localPath, branch string) error
	CommitAll(ctx context.Context, localPath, message, authorName, authorEmail string) (string, error)
	Push(ctx context.Context, localPath, branch string) error
}

type ExecClient struct {
	logger *log.Entry
}

func NewClient(logger *log.Entry) *ExecClient {
	if logger == nil {
		logger = log.NewEntry(log.StandardLogger())
	}
	return &ExecClient{logger: logger}
}

func SetRepoRoot(root string) {
	root = strings.TrimSpace(root)
	if root == "" {
		return
	}
	RepoRoot = root
}

func RepoPath(projectKey string) string {
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return ""
	}
	return filepath.Join(RepoRoot, projectKey)
}

func (c *ExecClient) EnsureCloned(ctx context.Context, repoURL, localPath string) error {
	repoURL = strings.TrimSpace(repoURL)
	localPath = strings.TrimSpace(localPath)
	if repoURL == "" {
		return fmt.Errorf("repo url is required")
	}
	if localPath == "" {
		return fmt.Errorf("local path is required")
	}

	if isGitRepo(localPath) {
		_, err := c.run(ctx, []string{"-C", localPath, "fetch", "--all", "--prune"})
		if err != nil {
			return fmt.Errorf("git fetch: %w", err)
		}
		return nil
	}
	if exists(localPath) {
		return fmt.Errorf("local path exists but is not a git repo")
	}

	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return fmt.Errorf("create repo root: %w", err)
	}

	_, err := c.run(ctx, []string{"clone", repoURL, localPath})
	if err != nil {
		return fmt.Errorf("git clone: %w", err)
	}
	return nil
}

func (c *ExecClient) PullRebase(ctx context.Context, localPath, branch string) error {
	localPath = strings.TrimSpace(localPath)
	branch = strings.TrimSpace(branch)
	if localPath == "" {
		return fmt.Errorf("local path is required")
	}
	if branch == "" {
		return fmt.Errorf("branch is required")
	}

	remoteRef, err := c.run(ctx, []string{"-C", localPath, "ls-remote", "--heads", "origin", branch})
	if err != nil {
		return fmt.Errorf("git ls-remote: %w", err)
	}
	if strings.TrimSpace(remoteRef) == "" {
		return nil
	}

	if !c.hasCommits(ctx, localPath) {
		if _, err := c.run(ctx, []string{"-C", localPath, "fetch", "origin", branch}); err != nil {
			return fmt.Errorf("git fetch: %w", err)
		}
		if _, err := c.run(ctx, []string{"-C", localPath, "checkout", "-B", branch, "FETCH_HEAD"}); err != nil {
			return fmt.Errorf("git checkout: %w", err)
		}
		return nil
	}

	if _, err := c.run(ctx, []string{"-C", localPath, "checkout", "-B", branch}); err != nil {
		return fmt.Errorf("git checkout: %w", err)
	}

	_, err = c.run(ctx, []string{"-C", localPath, "pull", "--rebase", "origin", branch})
	if err != nil {
		return fmt.Errorf("git pull --rebase: %w", err)
	}
	return nil
}

func (c *ExecClient) CheckoutBranch(ctx context.Context, localPath, branch string) error {
	localPath = strings.TrimSpace(localPath)
	branch = strings.TrimSpace(branch)
	if localPath == "" {
		return fmt.Errorf("local path is required")
	}
	if branch == "" {
		return fmt.Errorf("branch is required")
	}

	_, err := c.run(ctx, []string{"-C", localPath, "checkout", "-B", branch})
	if err != nil {
		return fmt.Errorf("git checkout -B: %w", err)
	}
	return nil
}

func (c *ExecClient) CommitAll(
	ctx context.Context,
	localPath,
	message,
	authorName,
	authorEmail string,
) (string, error) {
	localPath = strings.TrimSpace(localPath)
	message = strings.TrimSpace(message)
	authorName = strings.TrimSpace(authorName)
	authorEmail = strings.TrimSpace(authorEmail)
	if localPath == "" {
		return "", fmt.Errorf("local path is required")
	}
	if message == "" {
		return "", fmt.Errorf("commit message is required")
	}
	if authorName == "" || authorEmail == "" {
		return "", fmt.Errorf("author name and email are required")
	}

	statusOutput, err := c.run(ctx, []string{"-C", localPath, "status", "--porcelain"})
	if err != nil {
		return "", fmt.Errorf("git status: %w", err)
	}
	if strings.TrimSpace(statusOutput) == "" {
		return "", fmt.Errorf("no changes to commit")
	}

	if _, err := c.run(ctx, []string{"-C", localPath, "add", "-A"}); err != nil {
		return "", fmt.Errorf("git add: %w", err)
	}

	if _, err := c.runWithEnv(ctx, []string{
		"-C", localPath, "commit", "-m", message, "--author", fmt.Sprintf("%s <%s>", authorName, authorEmail),
	}, map[string]string{
		"GIT_AUTHOR_NAME":     authorName,
		"GIT_AUTHOR_EMAIL":    authorEmail,
		"GIT_COMMITTER_NAME":  authorName,
		"GIT_COMMITTER_EMAIL": authorEmail,
	}); err != nil {
		return "", fmt.Errorf("git commit: %w", err)
	}

	hash, err := c.run(ctx, []string{"-C", localPath, "rev-parse", "HEAD"})
	if err != nil {
		return "", fmt.Errorf("git rev-parse: %w", err)
	}
	return strings.TrimSpace(hash), nil
}

func (c *ExecClient) Push(ctx context.Context, localPath, branch string) error {
	localPath = strings.TrimSpace(localPath)
	branch = strings.TrimSpace(branch)
	if localPath == "" {
		return fmt.Errorf("local path is required")
	}
	if branch == "" {
		return fmt.Errorf("branch is required")
	}

	_, err := c.run(ctx, []string{"-C", localPath, "push", "origin", branch})
	if err != nil {
		return fmt.Errorf("git push: %w", err)
	}
	return nil
}

func (c *ExecClient) hasCommits(ctx context.Context, localPath string) bool {
	output, err := c.run(ctx, []string{"-C", localPath, "rev-parse", "--verify", "HEAD"})
	if err != nil {
		return false
	}
	return strings.TrimSpace(output) != ""
}

func (c *ExecClient) run(ctx context.Context, args []string) (string, error) {
	return c.runWithEnv(ctx, args, nil)
}

func (c *ExecClient) runWithEnv(
	ctx context.Context,
	args []string,
	env map[string]string,
) (string, error) {
	start := time.Now()
	cmd := exec.CommandContext(ctx, "git", args...)
	if len(env) > 0 {
		cmd.Env = append([]string{}, os.Environ()...)
		for key, value := range env {
			cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", key, value))
		}
	}

	output, err := cmd.CombinedOutput()
	elapsed := time.Since(start)
	c.logCommand(args, elapsed, err)
	if err != nil {
		return string(output), fmt.Errorf("git %s failed: %w", strings.Join(args, " "), err)
	}
	return string(output), nil
}

func (c *ExecClient) logCommand(args []string, elapsed time.Duration, err error) {
	entry := c.logger.WithFields(log.Fields{
		"cmd":     "git " + strings.Join(args, " "),
		"elapsed": elapsed.String(),
		"success": err == nil,
	})
	if err != nil {
		entry.WithField("error", err.Error()).Warn("git command failed")
		return
	}
	entry.Info("git command completed")
}

func isGitRepo(localPath string) bool {
	info, err := os.Stat(localPath)
	if err != nil || !info.IsDir() {
		return false
	}
	gitDir := filepath.Join(localPath, ".git")
	gitInfo, err := os.Stat(gitDir)
	return err == nil && gitInfo.IsDir()
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
