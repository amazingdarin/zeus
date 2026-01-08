package gitclient

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type GitState string

const (
	GitStateInit   GitState = "Init"
	GitStateReady  GitState = "Ready"
	GitStateError  GitState = "Error"
	GitStateClosed GitState = "Closed"
)

var (
	ErrClientClosed = fmt.Errorf("git client is closed")
	ErrNoChanges    = fmt.Errorf("no changes to commit")
	ErrRepoBusy     = fmt.Errorf("git repo has in-progress operation")
)

type GitKey string

type GitClientOption func(*GitClient)

type GitClient struct {
	key GitKey

	stateMu  sync.Mutex
	readyMu  sync.Mutex
	state    GitState
	lastErr  error
	refCount int64
	lastUsed int64

	repoPath      string
	projectKey    string
	remoteURL     string
	defaultBranch string
	authorName    string
	authorEmail   string
	emptyRepo     bool

	initFn  func(ctx context.Context, client *GitClient) error
	closeFn func(ctx context.Context, client *GitClient) error
}

func NewGitClient(key GitKey, opts ...GitClientOption) *GitClient {
	client := &GitClient{
		key:   key,
		state: GitStateInit,
	}
	atomic.StoreInt64(&client.lastUsed, time.Now().UnixNano())
	for _, opt := range opts {
		if opt != nil {
			opt(client)
		}
	}
	if client.initFn == nil {
		client.initFn = func(ctx context.Context, c *GitClient) error {
			return c.ensureReady(ctx)
		}
	}
	return client
}

func WithInitFunc(fn func(ctx context.Context, client *GitClient) error) GitClientOption {
	return func(client *GitClient) {
		client.initFn = fn
	}
}

func WithCloseFunc(fn func(ctx context.Context, client *GitClient) error) GitClientOption {
	return func(client *GitClient) {
		client.closeFn = fn
	}
}

func WithRepoPath(path string) GitClientOption {
	return func(client *GitClient) {
		client.repoPath = strings.TrimSpace(path)
	}
}

func WithProjectKey(projectKey string) GitClientOption {
	return func(client *GitClient) {
		client.projectKey = strings.TrimSpace(projectKey)
	}
}

func WithRemoteURL(url string) GitClientOption {
	return func(client *GitClient) {
		client.remoteURL = strings.TrimSpace(url)
	}
}

func WithBranch(branch string) GitClientOption {
	return func(client *GitClient) {
		client.defaultBranch = strings.TrimSpace(branch)
	}
}

func WithAuthor(name, email string) GitClientOption {
	return func(client *GitClient) {
		client.authorName = strings.TrimSpace(name)
		client.authorEmail = strings.TrimSpace(email)
	}
}

func (c *GitClient) Key() GitKey {
	if c == nil {
		return ""
	}
	return c.key
}

func (c *GitClient) RepoPath() string {
	if c == nil {
		return ""
	}
	return strings.TrimSpace(c.repoPath)
}

func (c *GitClient) State() GitState {
	if c == nil {
		return GitStateClosed
	}
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	return c.state
}

func (c *GitClient) LastError() error {
	if c == nil {
		return nil
	}
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	return c.lastErr
}

func (c *GitClient) RefCount() int64 {
	if c == nil {
		return 0
	}
	return atomic.LoadInt64(&c.refCount)
}

func (c *GitClient) LastUsed() time.Time {
	if c == nil {
		return time.Time{}
	}
	value := atomic.LoadInt64(&c.lastUsed)
	if value == 0 {
		return time.Time{}
	}
	return time.Unix(0, value)
}

// EnsureReady initializes the underlying repo once and transitions the state.
func (c *GitClient) EnsureReady(ctx context.Context) error {
	if c == nil {
		return fmt.Errorf("git client is required")
	}
	c.readyMu.Lock()
	defer c.readyMu.Unlock()

	c.stateMu.Lock()
	if c.state == GitStateClosed {
		c.stateMu.Unlock()
		return ErrClientClosed
	}
	if c.state == GitStateReady {
		c.touch()
		c.stateMu.Unlock()
		return nil
	}
	c.stateMu.Unlock()

	initFn := c.initFn
	var err error
	if initFn != nil {
		err = initFn(ctx, c)
	}

	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	if err != nil {
		c.state = GitStateError
		c.lastErr = err
		c.touch()
		return err
	}
	c.state = GitStateReady
	c.lastErr = nil
	c.touch()
	return nil
}

// Do executes a git operation callback and tracks error state.
func (c *GitClient) Do(ctx context.Context, op string, fn func(context.Context) error) error {
	if c == nil {
		return fmt.Errorf("git client is required")
	}
	if c.State() == GitStateClosed {
		return ErrClientClosed
	}
	c.touch()
	if fn == nil {
		return nil
	}
	if err := fn(ctx); err != nil {
		c.setError(err)
		return err
	}
	return nil
}

func (c *GitClient) Pull(ctx context.Context, remote, branch string) error {
	return c.Do(ctx, "pull", func(ctx context.Context) error {
		if err := c.EnsureReady(ctx); err != nil {
			return err
		}
		if remote == "" {
			remote = "origin"
		}
		if strings.TrimSpace(branch) == "" {
			branch = c.defaultBranch
		}
		return c.pullRebase(ctx, remote, branch)
	})
}

func (c *GitClient) Commit(ctx context.Context, message string) error {
	return c.Do(ctx, "commit", func(ctx context.Context) error {
		if err := c.EnsureReady(ctx); err != nil {
			return err
		}
		return c.commit(ctx, message)
	})
}

func (c *GitClient) Push(ctx context.Context, remote, branch string) error {
	return c.Do(ctx, "push", func(ctx context.Context) error {
		if err := c.EnsureReady(ctx); err != nil {
			return err
		}
		if remote == "" {
			remote = "origin"
		}
		if strings.TrimSpace(branch) == "" {
			branch = c.defaultBranch
		}
		return c.push(ctx, remote, branch)
	})
}

func (c *GitClient) acquire() error {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	if c.state == GitStateClosed {
		return ErrClientClosed
	}
	atomic.AddInt64(&c.refCount, 1)
	c.touch()
	return nil
}

func (c *GitClient) release() {
	if c == nil {
		return
	}
	atomic.AddInt64(&c.refCount, -1)
	if c.RefCount() < 0 {
		atomic.StoreInt64(&c.refCount, 0)
	}
	c.touch()
}

func (c *GitClient) close(ctx context.Context) error {
	c.stateMu.Lock()
	if c.state == GitStateClosed {
		c.stateMu.Unlock()
		return nil
	}
	if c.RefCount() > 0 {
		c.stateMu.Unlock()
		return fmt.Errorf("git client still in use")
	}
	c.state = GitStateClosed
	c.stateMu.Unlock()

	if c.closeFn != nil {
		if err := c.closeFn(ctx, c); err != nil {
			return err
		}
	}
	c.touch()
	return nil
}

func (c *GitClient) setError(err error) {
	if err == nil {
		return
	}
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	if c.state == GitStateClosed {
		return
	}
	c.state = GitStateError
	c.lastErr = err
}

func (c *GitClient) touch() {
	atomic.StoreInt64(&c.lastUsed, time.Now().UnixNano())
}

func (c *GitClient) ensureReady(ctx context.Context) error {
	if strings.TrimSpace(c.repoPath) == "" {
		return fmt.Errorf("repo path is required")
	}
	if err := os.MkdirAll(c.repoPath, 0o755); err != nil {
		return fmt.Errorf("ensure repo path: %w", err)
	}
	gitDir := filepath.Join(c.repoPath, ".git")
	if !exists(gitDir) {
		if _, _, err := c.exec(ctx, "init"); err != nil {
			return err
		}
	}
	if inProgress(gitDir) {
		return ErrRepoBusy
	}
	if err := c.cleanupIndexLock(gitDir); err != nil {
		return err
	}
	if err := c.ensureRemote(ctx); err != nil {
		return err
	}
	hasCommit, err := c.hasCommit(ctx)
	if err != nil {
		return err
	}
	if !hasCommit {
		c.emptyRepo = true
	}
	return nil
}

func (c *GitClient) pullRebase(ctx context.Context, remote, branch string) error {
	remote = strings.TrimSpace(remote)
	branch = strings.TrimSpace(branch)
	if remote == "" || branch == "" {
		return fmt.Errorf("remote and branch are required")
	}
	remoteRef, _, err := c.exec(ctx, "ls-remote", "--heads", remote, branch)
	if err != nil {
		return err
	}
	if strings.TrimSpace(remoteRef) == "" {
		if !c.emptyRepo {
			if _, _, err := c.exec(ctx, "checkout", "-B", branch); err != nil {
				return err
			}
		}
		return nil
	}

	hasCommit, err := c.hasCommit(ctx)
	if err != nil {
		return err
	}
	if !hasCommit {
		if _, _, err := c.exec(ctx, "fetch", remote, branch); err != nil {
			return err
		}
		if _, _, err := c.exec(ctx, "checkout", "-B", branch, "FETCH_HEAD"); err != nil {
			return err
		}
		return nil
	}
	if _, _, err := c.exec(ctx, "checkout", "-B", branch); err != nil {
		return err
	}
	_, _, err = c.exec(ctx, "pull", "--rebase", remote, branch)
	return err
}

func (c *GitClient) commit(ctx context.Context, message string) error {
	message = strings.TrimSpace(message)
	if message == "" {
		return fmt.Errorf("commit message is required")
	}
	status, err := c.status(ctx)
	if err != nil {
		return err
	}
	if strings.TrimSpace(status) == "" {
		return ErrNoChanges
	}
	if _, _, err := c.exec(ctx, "add", "-A"); err != nil {
		return err
	}
	args := []string{"commit", "-m", message}
	if c.authorName != "" && c.authorEmail != "" {
		args = append(
			[]string{
				"-c", fmt.Sprintf("user.name=%s", c.authorName),
				"-c", fmt.Sprintf("user.email=%s", c.authorEmail),
			},
			args...,
		)
		args = append(args, "--author", fmt.Sprintf("%s <%s>", c.authorName, c.authorEmail))
	}
	_, _, err = c.exec(ctx, args...)
	return err
}

func (c *GitClient) push(ctx context.Context, remote, branch string) error {
	remote = strings.TrimSpace(remote)
	branch = strings.TrimSpace(branch)
	if remote == "" || branch == "" {
		return fmt.Errorf("remote and branch are required")
	}
	_, _, err := c.exec(ctx, "push", remote, branch)
	return err
}

func (c *GitClient) status(ctx context.Context) (string, error) {
	stdout, _, err := c.exec(ctx, "status", "--porcelain")
	return stdout, err
}

func (c *GitClient) hasCommit(ctx context.Context) (bool, error) {
	_, _, err := c.exec(ctx, "show-ref", "--head", "--quiet")
	if err == nil {
		return true, nil
	}
	if exitCode(err) == 1 {
		return false, nil
	}
	return false, err
}

func (c *GitClient) ensureRemote(ctx context.Context) error {
	remoteURL := strings.TrimSpace(c.remoteURL)
	if remoteURL == "" {
		return nil
	}
	stdout, _, err := c.exec(ctx, "remote", "get-url", "origin")
	if err != nil {
		if exitCode(err) != 0 {
			_, _, addErr := c.exec(ctx, "remote", "add", "origin", remoteURL)
			return addErr
		}
		return err
	}
	if strings.TrimSpace(stdout) != remoteURL {
		_, _, err = c.exec(ctx, "remote", "set-url", "origin", remoteURL)
		return err
	}
	return nil
}

func (c *GitClient) exec(ctx context.Context, args ...string) (string, string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if strings.TrimSpace(c.repoPath) == "" {
		return "", "", fmt.Errorf("repo path is required")
	}
	timeout := commandTimeout(args)
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cleanArgs := append([]string{}, args...)
	if isReadOnlyCommand(cleanArgs) {
		cleanArgs = append([]string{"--no-optional-locks"}, cleanArgs...)
	}
	cmd := exec.CommandContext(ctx, "git", cleanArgs...)
	cmd.Dir = c.repoPath
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	var stdout strings.Builder
	var stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		return stdout.String(), stderr.String(), &execError{
			command:  "git " + strings.Join(cleanArgs, " "),
			exitCode: exitCode(err),
			stderr:   stderr.String(),
			err:      err,
		}
	}
	return stdout.String(), stderr.String(), nil
}

func (c *GitClient) cleanupIndexLock(gitDir string) error {
	lockPath := filepath.Join(gitDir, "index.lock")
	if !exists(lockPath) {
		return nil
	}
	if err := os.Remove(lockPath); err != nil {
		return fmt.Errorf("remove index.lock: %w", err)
	}
	return nil
}

type execError struct {
	command  string
	exitCode int
	stderr   string
	err      error
}

func (e *execError) Error() string {
	if e == nil {
		return "git command failed"
	}
	if strings.TrimSpace(e.stderr) != "" {
		return fmt.Sprintf("%s failed: %s", e.command, strings.TrimSpace(e.stderr))
	}
	return fmt.Sprintf("%s failed with exit code %d", e.command, e.exitCode)
}

func (e *execError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func exitCode(err error) int {
	var cmdErr *execError
	if errors.As(err, &cmdErr) {
		return cmdErr.exitCode
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && exitErr.ProcessState != nil {
		return exitErr.ProcessState.ExitCode()
	}
	return -1
}

func inProgress(gitDir string) bool {
	if exists(filepath.Join(gitDir, "rebase-apply")) {
		return true
	}
	if exists(filepath.Join(gitDir, "rebase-merge")) {
		return true
	}
	if exists(filepath.Join(gitDir, "MERGE_HEAD")) {
		return true
	}
	return false
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func isReadOnlyCommand(args []string) bool {
	cmd := ""
	for _, arg := range args {
		if strings.HasPrefix(arg, "-") {
			continue
		}
		cmd = arg
		break
	}
	switch cmd {
	case "status", "show-ref", "rev-parse", "ls-remote", "diff", "log":
		return true
	default:
		return false
	}
}

func commandTimeout(args []string) time.Duration {
	cmd := ""
	for _, arg := range args {
		if strings.HasPrefix(arg, "-") {
			continue
		}
		cmd = arg
		break
	}
	switch cmd {
	case "show-ref", "status", "rev-parse", "diff", "log":
		return 1 * time.Second
	case "ls-remote", "fetch", "pull", "push", "clone":
		return 10 * time.Second
	default:
		return 3 * time.Second
	}
}
