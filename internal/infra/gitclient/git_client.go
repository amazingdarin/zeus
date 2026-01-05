package gitclient

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	log "github.com/sirupsen/logrus"
)

const DefaultRepoRoot = "/var/lib/zeus/repos"

var RepoRoot = DefaultRepoRoot

type GitClient interface {
	EnsureCloned(ctx context.Context, projectKey, repoURL, localPath string) error
	PullRebase(ctx context.Context, projectKey, localPath, branch string) error
	CheckoutBranch(ctx context.Context, projectKey, localPath, branch string) error
	CommitAll(
		ctx context.Context,
		projectKey, localPath, message, authorName, authorEmail string,
	) (string, error)
	Push(ctx context.Context, projectKey, localPath, branch string) error
}

type ExecClient struct {
	logger      *log.Entry
	lockManager RepoLockManager
	runner      *GitCommandRunner
}

func NewClient(logger *log.Entry) *ExecClient {
	if logger == nil {
		logger = log.NewEntry(log.StandardLogger())
	}
	runner := NewGitCommandRunner(logger)
	return &ExecClient{
		logger:      logger,
		lockManager: NewRepoLockManager(),
		runner:      runner,
	}
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

func (c *ExecClient) EnsureCloned(
	ctx context.Context,
	projectKey, repoURL, localPath string,
) error {
	repoURL = strings.TrimSpace(repoURL)
	localPath = strings.TrimSpace(localPath)
	if repoURL == "" {
		return fmt.Errorf("repo url is required")
	}
	if localPath == "" {
		return fmt.Errorf("local path is required")
	}
	if err := c.validateProjectKey(projectKey); err != nil {
		return err
	}

	return c.withRepoLock(ctx, projectKey, func() error {
		if isGitRepo(localPath) {
			if err := c.run(ctx, localPath, projectKey, "-C", localPath, "fetch", "--all", "--prune"); err != nil {
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

		if err := c.run(ctx, localPath, projectKey, "clone", repoURL, localPath); err != nil {
			return fmt.Errorf("git clone: %w", err)
		}
		return nil
	})
}

func (c *ExecClient) PullRebase(
	ctx context.Context,
	projectKey, localPath, branch string,
) error {
	localPath = strings.TrimSpace(localPath)
	branch = strings.TrimSpace(branch)
	if localPath == "" {
		return fmt.Errorf("local path is required")
	}
	if branch == "" {
		return fmt.Errorf("branch is required")
	}
	if err := c.validateProjectKey(projectKey); err != nil {
		return err
	}

	return c.withRepoLock(ctx, projectKey, func() error {
		remoteRef, err := c.runOutput(ctx, localPath, projectKey, "-C", localPath, "ls-remote", "--heads", "origin", branch)
		if err != nil {
			return fmt.Errorf("git ls-remote: %w", err)
		}
		if strings.TrimSpace(remoteRef) == "" {
			return nil
		}

		if !c.hasCommits(ctx, localPath, projectKey) {
			if err := c.run(ctx, localPath, projectKey, "-C", localPath, "fetch", "origin", branch); err != nil {
				return fmt.Errorf("git fetch: %w", err)
			}
			if err := c.run(ctx, localPath, projectKey, "-C", localPath, "checkout", "-B", branch, "FETCH_HEAD"); err != nil {
				return fmt.Errorf("git checkout: %w", err)
			}
			return nil
		}

		if err := c.run(ctx, localPath, projectKey, "-C", localPath, "checkout", "-B", branch); err != nil {
			return fmt.Errorf("git checkout: %w", err)
		}

		if err := c.run(ctx, localPath, projectKey, "-C", localPath, "pull", "--rebase", "origin", branch); err != nil {
			return fmt.Errorf("git pull --rebase: %w", err)
		}
		return nil
	})
}

func (c *ExecClient) CheckoutBranch(
	ctx context.Context,
	projectKey, localPath, branch string,
) error {
	localPath = strings.TrimSpace(localPath)
	branch = strings.TrimSpace(branch)
	if localPath == "" {
		return fmt.Errorf("local path is required")
	}
	if branch == "" {
		return fmt.Errorf("branch is required")
	}
	if err := c.validateProjectKey(projectKey); err != nil {
		return err
	}

	return c.withRepoLock(ctx, projectKey, func() error {
		if err := c.run(ctx, localPath, projectKey, "-C", localPath, "checkout", "-B", branch); err != nil {
			return fmt.Errorf("git checkout -B: %w", err)
		}
		return nil
	})
}

func (c *ExecClient) CommitAll(
	ctx context.Context,
	projectKey,
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
	if err := c.validateProjectKey(projectKey); err != nil {
		return "", err
	}

	var hash string
	err := c.withRepoLock(ctx, projectKey, func() error {
		statusOutput, err := c.runOutput(ctx, localPath, projectKey, "-C", localPath, "status", "--porcelain")
		if err != nil {
			return fmt.Errorf("git status: %w", err)
		}
		if strings.TrimSpace(statusOutput) == "" {
			return fmt.Errorf("no changes to commit")
		}

		if err := c.run(ctx, localPath, projectKey, "-C", localPath, "add", "-A"); err != nil {
			return fmt.Errorf("git add: %w", err)
		}

		commitArgs := []string{
			"-C", localPath,
			"-c", fmt.Sprintf("user.name=%s", authorName),
			"-c", fmt.Sprintf("user.email=%s", authorEmail),
			"commit", "-m", message,
			"--author", fmt.Sprintf("%s <%s>", authorName, authorEmail),
		}
		if err := c.run(ctx, localPath, projectKey, commitArgs...); err != nil {
			return fmt.Errorf("git commit: %w", err)
		}

		value, err := c.runOutput(ctx, localPath, projectKey, "-C", localPath, "rev-parse", "HEAD")
		if err != nil {
			return fmt.Errorf("git rev-parse: %w", err)
		}
		hash = strings.TrimSpace(value)
		return nil
	})
	if err != nil {
		return "", err
	}
	return hash, nil
}

func (c *ExecClient) Push(
	ctx context.Context,
	projectKey, localPath, branch string,
) error {
	localPath = strings.TrimSpace(localPath)
	branch = strings.TrimSpace(branch)
	if localPath == "" {
		return fmt.Errorf("local path is required")
	}
	if branch == "" {
		return fmt.Errorf("branch is required")
	}
	if err := c.validateProjectKey(projectKey); err != nil {
		return err
	}

	return c.withRepoLock(ctx, projectKey, func() error {
		if err := c.run(ctx, localPath, projectKey, "-C", localPath, "push", "origin", branch); err != nil {
			return fmt.Errorf("git push: %w", err)
		}
		return nil
	})
}

func (c *ExecClient) hasCommits(ctx context.Context, localPath, projectKey string) bool {
	output, err := c.runOutput(ctx, localPath, projectKey, "-C", localPath, "rev-parse", "--verify", "HEAD")
	if err != nil {
		return false
	}
	return strings.TrimSpace(output) != ""
}

func (c *ExecClient) run(
	ctx context.Context,
	repoPath string,
	projectKey string,
	args ...string,
) error {
	if c.runner == nil {
		return fmt.Errorf("git command runner is required")
	}
	return c.runner.Run(ctx, repoPath, projectKey, args...)
}

func (c *ExecClient) runOutput(
	ctx context.Context,
	repoPath string,
	projectKey string,
	args ...string,
) (string, error) {
	if c.runner == nil {
		return "", fmt.Errorf("git command runner is required")
	}
	return c.runner.RunWithOutput(ctx, repoPath, projectKey, args...)
}

func (c *ExecClient) withRepoLock(
	ctx context.Context,
	projectKey string,
	fn func() error,
) error {
	if c.lockManager == nil {
		return fmt.Errorf("repo lock manager is required")
	}
	return c.lockManager.WithRepoLock(ctx, projectKey, fn)
}

func (c *ExecClient) validateProjectKey(projectKey string) error {
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return fmt.Errorf("project key is required")
	}
	return nil
}

type RepoLockManager interface {
	WithRepoLock(ctx context.Context, projectKey string, fn func() error) error
}

type RepoLockManagerImpl struct {
	locks sync.Map
}

func NewRepoLockManager() *RepoLockManagerImpl {
	return &RepoLockManagerImpl{}
}

func (m *RepoLockManagerImpl) WithRepoLock(
	_ context.Context,
	projectKey string,
	fn func() error,
) error {
	if strings.TrimSpace(projectKey) == "" {
		return fmt.Errorf("project key is required")
	}
	value, _ := m.locks.LoadOrStore(projectKey, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()
	return fn()
}

type GitCommandRunner struct {
	logger *log.Entry
}

func NewGitCommandRunner(logger *log.Entry) *GitCommandRunner {
	if logger == nil {
		logger = log.NewEntry(log.StandardLogger())
	}
	return &GitCommandRunner{logger: logger}
}

func (r *GitCommandRunner) Run(
	ctx context.Context,
	repoPath string,
	projectKey string,
	args ...string,
) error {
	_, err := r.run(ctx, repoPath, projectKey, args...)
	return err
}

func (r *GitCommandRunner) RunWithOutput(
	ctx context.Context,
	repoPath string,
	projectKey string,
	args ...string,
) (string, error) {
	stdout, err := r.run(ctx, repoPath, projectKey, args...)
	return stdout, err
}

func (r *GitCommandRunner) run(
	ctx context.Context,
	repoPath string,
	projectKey string,
	args ...string,
) (string, error) {
	start := time.Now()
	cmd := exec.CommandContext(ctx, "git", args...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if repoPath != "" && exists(repoPath) {
		cmd.Dir = repoPath
	}
	err := cmd.Run()
	elapsed := time.Since(start)
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ProcessState != nil {
			exitCode = exitErr.ProcessState.ExitCode()
		} else {
			exitCode = -1
		}
	}
	entry := r.logger.WithFields(log.Fields{
		"project_key": projectKey,
		"repo_path":   repoPath,
		"command":     "git " + strings.Join(args, " "),
		"stdout":      stdout.String(),
		"stderr":      stderr.String(),
		"duration_ms": elapsed.Milliseconds(),
		"exit_code":   exitCode,
	})
	if err != nil {
		entry.Error("git command failed")
		return stdout.String(), fmt.Errorf("git %s failed: %s", strings.Join(args, " "), strings.TrimSpace(stderr.String()))
	}
	entry.Info("git command completed")
	return stdout.String(), nil
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
