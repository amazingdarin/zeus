package gitclient

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
)

const (
	DefaultRepoRoot        = "/var/lib/zeus/repos"
	readOnlyCmdTimeout     = 1 * time.Second
	localCmdTimeout        = 3 * time.Second
	networkCmdTimeout      = 10 * time.Second
	minTransientRetryDelay = 200 * time.Millisecond
	defaultRepoPermission  = 0o755
)

var (
	RepoRoot = DefaultRepoRoot

	ErrEmptyRepo      = errors.New("git repo has no commits")
	ErrRepoInProgress = errors.New("git repo has in-progress operation")
	ErrNoChanges      = errors.New("no changes to commit")
)

type ErrGitCommandFailed struct {
	Command  string
	ExitCode int
	Stderr   string
	Err      error
}

func (e *ErrGitCommandFailed) Error() string {
	if e == nil {
		return "git command failed"
	}
	if strings.TrimSpace(e.Stderr) != "" {
		return fmt.Sprintf("git %s failed: %s", e.Command, strings.TrimSpace(e.Stderr))
	}
	return fmt.Sprintf("git %s failed with exit code %d", e.Command, e.ExitCode)
}

func (e *ErrGitCommandFailed) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

type GitExecDiagnosis struct {
	ExitCode     int
	ProcessState string
	Signal       string
	Killed       bool
	TimedOut     bool
	Transient    bool
}

func DiagnoseGitExecError(err error) GitExecDiagnosis {
	diagnosis := GitExecDiagnosis{
		ExitCode: -1,
	}
	if err == nil {
		return diagnosis
	}

	var cmdErr *ErrGitCommandFailed
	if errors.As(err, &cmdErr) {
		diagnosis.ExitCode = cmdErr.ExitCode
		if cmdErr.Err != nil {
			err = cmdErr.Err
		}
	}

	if errors.Is(err, context.DeadlineExceeded) {
		diagnosis.TimedOut = true
	}

	if exitErr, ok := err.(*exec.ExitError); ok {
		if exitErr.ProcessState != nil {
			diagnosis.ProcessState = exitErr.ProcessState.String()
			diagnosis.ExitCode = exitErr.ExitCode()
			if status, ok := exitErr.ProcessState.Sys().(syscall.WaitStatus); ok && status.Signaled() {
				diagnosis.Signal = status.Signal().String()
				if status.Signal() == syscall.SIGKILL {
					diagnosis.Killed = true
				}
			}
			if strings.Contains(strings.ToLower(diagnosis.ProcessState), "signal: killed") {
				diagnosis.Killed = true
				if diagnosis.Signal == "" {
					diagnosis.Signal = "killed"
				}
			}
		}
	}

	if diagnosis.ExitCode == -1 || diagnosis.Killed || diagnosis.TimedOut {
		diagnosis.Transient = true
	}
	return diagnosis
}

type Logger interface {
	WithContext(ctx context.Context) *log.Entry
	WithFields(fields log.Fields) *log.Entry
	WithField(key string, value interface{}) *log.Entry
	Info(args ...interface{})
	Warn(args ...interface{})
	Error(args ...interface{})
}

type RepoLocker interface {
	Lock(key string)
	Unlock(key string)
}

type MapLocker struct {
	locks sync.Map
}

func NewRepoLocker() *MapLocker {
	return &MapLocker{}
}

func (m *MapLocker) Lock(key string) {
	if strings.TrimSpace(key) == "" {
		key = "__default__"
	}
	value, _ := m.locks.LoadOrStore(key, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
}

func (m *MapLocker) Unlock(key string) {
	if strings.TrimSpace(key) == "" {
		key = "__default__"
	}
	if value, ok := m.locks.Load(key); ok {
		lock := value.(*sync.Mutex)
		lock.Unlock()
	}
}

type ClientFactory struct {
	locker RepoLocker
	logger Logger
}

func NewClientFactory(logger Logger) *ClientFactory {
	if logger == nil {
		logger = log.NewEntry(log.StandardLogger())
	}
	return &ClientFactory{
		locker: NewRepoLocker(),
		logger: logger,
	}
}

func (f *ClientFactory) ForRepo(repoPath, projectKey string) *GitClient {
	return &GitClient{
		repoPath:   strings.TrimSpace(repoPath),
		projectKey: strings.TrimSpace(projectKey),
		locker:     f.locker,
		logger:     f.logger,
	}
}

type GitClient struct {
	repoPath   string
	projectKey string
	locker     RepoLocker
	logger     Logger
	remoteURL  string
	authorName string
	authorMail string
}

func (c *GitClient) SetRemote(remoteURL string) {
	c.remoteURL = strings.TrimSpace(remoteURL)
}

func (c *GitClient) SetAuthor(name, email string) {
	c.authorName = strings.TrimSpace(name)
	c.authorMail = strings.TrimSpace(email)
}

type GitErrorCategory string

const (
	GitErrTransient GitErrorCategory = "transient"
	GitErrConflict  GitErrorCategory = "conflict"
	GitErrFatal     GitErrorCategory = "fatal"
)

// ClassifyGitError maps stderr+error into retry-safe categories.
// Conflict errors are never retried. Transient errors are retriable.
func ClassifyGitError(stderr string, err error) GitErrorCategory {
	if err == nil {
		return GitErrFatal
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return GitErrTransient
	}
	if errors.Is(err, context.Canceled) {
		return GitErrFatal
	}

	normalized := strings.ToLower(strings.TrimSpace(stderr))
	if normalized == "" {
		normalized = strings.ToLower(err.Error())
	}

	conflictMatchers := []string{
		"conflict",
		"merge conflict",
		"rebase conflict",
		"cannot lock ref",
	}
	for _, match := range conflictMatchers {
		if strings.Contains(normalized, match) {
			return GitErrConflict
		}
	}

	fatalMatchers := []string{
		"not a git repository",
		"permission denied",
		"malformed object",
		"unknown revision",
		"bad object",
		"fatal: not a git repository",
		"pathspec",
		"invalid object",
	}
	for _, match := range fatalMatchers {
		if strings.Contains(normalized, match) {
			return GitErrFatal
		}
	}

	exit := exitCode(err)
	transientMatchers := []string{
		"index.lock",
		"unable to create file",
		"temporary failure",
		"connection reset",
		"connection timed out",
		"i/o error",
		"connection refused",
		"network is unreachable",
		"failed to connect",
	}
	for _, match := range transientMatchers {
		if strings.Contains(normalized, match) {
			if exit == 128 || strings.Contains(normalized, "connection") || strings.Contains(normalized, "network") {
				return GitErrTransient
			}
		}
	}

	if exit == 128 && strings.Contains(normalized, "unable to create") {
		return GitErrTransient
	}
	return GitErrFatal
}

type RetryPolicy struct {
	MaxAttempts int
	BaseDelay   time.Duration
	MaxDelay    time.Duration
}

var (
	ReadOnlyRetryPolicy = RetryPolicy{
		MaxAttempts: 2,
		BaseDelay:   100 * time.Millisecond,
		MaxDelay:    1 * time.Second,
	}
	WriteRetryPolicy = RetryPolicy{
		MaxAttempts: 3,
		BaseDelay:   300 * time.Millisecond,
		MaxDelay:    2 * time.Second,
	}
)

// WithRepo serializes access to a single repo, ensures repo readiness, then runs fn.
func (c *GitClient) WithRepo(ctx context.Context, fn func(*GitSession) error) error {
	return c.withRepoSession(ctx, fn)
}

func (c *GitClient) EnsureReady(ctx context.Context) error {
	return c.withRepoSession(ctx, func(session *GitSession) error {
		return session.EnsureReady()
	})
}

func (c *GitClient) withRepoSession(ctx context.Context, fn func(*GitSession) error) error {
	if c == nil {
		return fmt.Errorf("git client is required")
	}
	if fn == nil {
		return fmt.Errorf("repo operation is required")
	}
	lockKey := c.projectKey
	if lockKey == "" {
		lockKey = c.repoPath
	}
	if lockKey == "" {
		return fmt.Errorf("repo lock key is required")
	}
	if c.locker == nil {
		c.locker = NewRepoLocker()
	}

	c.locker.Lock(lockKey)
	defer c.locker.Unlock(lockKey)

	if ctx == nil {
		ctx = context.Background()
	}
	operationID := uuid.NewString()
	logger := c.logger
	if logger == nil {
		logger = log.NewEntry(log.StandardLogger())
	}
	entry := logger.WithContext(ctx).WithFields(log.Fields{
		"operation_id": operationID,
		"project_key":  c.projectKey,
		"repo_path":    c.repoPath,
	})
	if sessionClient, ok := SessionClientFromContext(ctx); ok {
		sessionID := strings.TrimSpace(sessionClient.Context().SessionID)
		if sessionID != "" {
			entry = entry.WithField("session_id", sessionID)
		}
	}

	session := &GitSession{
		repoPath:    c.repoPath,
		projectKey:  c.projectKey,
		logger:      entry,
		operationID: operationID,
		remoteURL:   c.remoteURL,
		authorName:  c.authorName,
		authorMail:  c.authorMail,
		ctx:         ctx,
	}

	if err := fn(session); err != nil {
		entry.WithError(err).Error("git repo operation failed")
		return err
	}
	return nil
}

type GitSession struct {
	repoPath    string
	projectKey  string
	logger      *log.Entry
	operationID string
	remoteURL   string
	authorName  string
	authorMail  string
	emptyRepo   bool
	ctx         context.Context
}

// EnsureReady performs defensive repo checks and prepares the repo for commands.
func (s *GitSession) EnsureReady() error {
	if s == nil {
		return fmt.Errorf("git session is required")
	}
	if strings.TrimSpace(s.repoPath) == "" {
		return fmt.Errorf("repo path is required")
	}
	if err := os.MkdirAll(s.repoPath, defaultRepoPermission); err != nil {
		return fmt.Errorf("ensure repo path: %w", err)
	}

	gitDir := filepath.Join(s.repoPath, ".git")
	if !exists(gitDir) {
		if _, _, err := s.ExecWithRetry(s.ctx, WriteRetryPolicy, "init"); err != nil {
			return fmt.Errorf("git init: %w", err)
		}
	}

	if inProgress(gitDir) {
		return ErrRepoInProgress
	}

	if err := s.cleanupIndexLock(gitDir); err != nil {
		return err
	}

	if err := s.ensureRemote(); err != nil {
		return err
	}

	hasCommit, err := s.HasCommit()
	if err != nil {
		return err
	}
	if !hasCommit {
		s.emptyRepo = true
	}
	return nil
}

func (s *GitSession) HasCommit() (bool, error) {
	_, _, err := s.ExecWithRetry(s.ctx, ReadOnlyRetryPolicy, "show-ref", "--head", "--quiet")
	if err != nil {
		exit := exitCode(err)
		if exit == 1 {
			return false, nil
		}
		diagnosis := DiagnoseGitExecError(err)
		if diagnosis.ExitCode == -1 || diagnosis.Killed || diagnosis.TimedOut {
			_, _, revErr := s.Exec(s.ctx, "rev-parse", "--git-dir")
			if revErr != nil {
				return false, revErr
			}
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (s *GitSession) CurrentHead() (string, error) {
	hasCommit, err := s.HasCommit()
	if err != nil || !hasCommit {
		return "", err
	}
	stdout, _, err := s.ExecWithRetry(s.ctx, ReadOnlyRetryPolicy, "rev-parse", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(stdout), nil
}

func (s *GitSession) Status() (string, error) {
	stdout, _, err := s.ExecWithRetry(s.ctx, ReadOnlyRetryPolicy, "status", "--porcelain")
	if err != nil {
		return "", err
	}
	return stdout, nil
}

func (s *GitSession) PullRebase(remote, branch string) error {
	remote = strings.TrimSpace(remote)
	branch = strings.TrimSpace(branch)
	if remote == "" || branch == "" {
		return fmt.Errorf("remote and branch are required")
	}
	ctx, cancel := withTimeout(s.ctx, networkCmdTimeout)
	defer cancel()

	remoteRef, _, err := s.ExecWithRetry(ctx, ReadOnlyRetryPolicy, "ls-remote", "--heads", remote, branch)
	if err != nil {
		return err
	}
	if strings.TrimSpace(remoteRef) == "" {
		if !s.emptyRepo {
			if _, _, err := s.ExecWithRetry(ctx, WriteRetryPolicy, "checkout", "-B", branch); err != nil {
				return err
			}
		}
		return nil
	}

	hasCommit, err := s.HasCommit()
	if err != nil {
		return err
	}
	if !hasCommit {
		if _, _, err := s.ExecWithRetry(ctx, WriteRetryPolicy, "fetch", remote, branch); err != nil {
			return err
		}
		if _, _, err := s.ExecWithRetry(ctx, WriteRetryPolicy, "checkout", "-B", branch, "FETCH_HEAD"); err != nil {
			return err
		}
		return nil
	}

	if _, _, err := s.ExecWithRetry(ctx, WriteRetryPolicy, "checkout", "-B", branch); err != nil {
		return err
	}
	if _, _, err := s.ExecWithRetry(ctx, WriteRetryPolicy, "pull", "--rebase", remote, branch); err != nil {
		return err
	}
	return nil
}

func (s *GitSession) AddAll() error {
	_, _, err := s.ExecWithRetry(s.ctx, WriteRetryPolicy, "add", "-A")
	return err
}

func (s *GitSession) Commit(message string) error {
	message = strings.TrimSpace(message)
	if message == "" {
		return fmt.Errorf("commit message is required")
	}
	status, err := s.Status()
	if err != nil {
		return err
	}
	if strings.TrimSpace(status) == "" {
		return ErrNoChanges
	}
	if err := s.AddAll(); err != nil {
		return err
	}
	args := []string{"commit", "-m", message}
	if s.authorName != "" && s.authorMail != "" {
		args = append(
			[]string{
				"-c", fmt.Sprintf("user.name=%s", s.authorName),
				"-c", fmt.Sprintf("user.email=%s", s.authorMail),
			},
			args...,
		)
		args = append(args, "--author", fmt.Sprintf("%s <%s>", s.authorName, s.authorMail))
	}
	_, _, err = s.ExecWithRetry(s.ctx, WriteRetryPolicy, args...)
	return err
}

func (s *GitSession) Push(remote, branch string) error {
	remote = strings.TrimSpace(remote)
	branch = strings.TrimSpace(branch)
	if remote == "" || branch == "" {
		return fmt.Errorf("remote and branch are required")
	}
	ctx, cancel := withTimeout(s.ctx, networkCmdTimeout)
	defer cancel()
	_, _, err := s.ExecWithRetry(ctx, WriteRetryPolicy, "push", remote, branch)
	return err
}

// Exec runs a git command with structured logging and timeout safeguards.
func (s *GitSession) Exec(ctx context.Context, args ...string) (string, string, error) {
	if s == nil {
		return "", "", fmt.Errorf("git session is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	timeout := commandTimeout(args)
	ctx, cancel := withTimeout(ctx, timeout)
	defer cancel()

	cleanArgs := append([]string{}, args...)
	if isReadOnlyCommand(cleanArgs) {
		cleanArgs = append([]string{"--no-optional-locks"}, cleanArgs...)
	}

	cmd := exec.CommandContext(ctx, "git", cleanArgs...)
	cmd.Dir = s.repoPath
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	start := time.Now()
	err := cmd.Run()
	elapsed := time.Since(start)

	exitCode := 0
	diagnosis := DiagnoseGitExecError(err)
	if err != nil {
		exitCode = diagnosis.ExitCode
	}

	command := "git " + strings.Join(cleanArgs, " ")
	entry := s.logger.WithContext(ctx).WithFields(log.Fields{
		"operation_id": s.operationID,
		"project_key":  s.projectKey,
		"repo_path":    s.repoPath,
		"command":      command,
		"stdout":       stdout.String(),
		"stderr":       stderr.String(),
		"duration_ms":  elapsed.Milliseconds(),
		"exit_code":    exitCode,
	})
	if err != nil {
		entry = entry.WithFields(log.Fields{
			"process_state": diagnosis.ProcessState,
			"signal":        diagnosis.Signal,
			"killed":        diagnosis.Killed,
			"timed_out":     diagnosis.TimedOut,
		})
		entry.Error("git command failed")
		return stdout.String(), stderr.String(), &ErrGitCommandFailed{
			Command:  strings.Join(cleanArgs, " "),
			ExitCode: exitCode,
			Stderr:   stderr.String(),
			Err:      err,
		}
	}
	entry.Info("git command completed")
	return stdout.String(), stderr.String(), nil
}

// ExecWithRetry retries transient failures using the provided policy.
func (s *GitSession) ExecWithRetry(ctx context.Context, policy RetryPolicy, args ...string) (string, string, error) {
	if s == nil {
		return "", "", fmt.Errorf("git session is required")
	}
	maxAttempts := policy.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 1
	}
	retryPolicy := policy
	var lastStdout string
	var lastStderr string
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		stdout, stderr, err := s.Exec(ctx, args...)
		lastStdout = stdout
		lastStderr = stderr
		lastErr = err
		if err == nil {
			return stdout, stderr, nil
		}

		diagnosis := DiagnoseGitExecError(err)
		category := ClassifyGitError(stderr, err)
		if diagnosis.Transient {
			category = GitErrTransient
		}
		if category != GitErrTransient {
			return stdout, stderr, err
		}

		if diagnosis.ExitCode == -1 {
			if maxAttempts > 2 {
				maxAttempts = 2
			}
			if retryPolicy.BaseDelay < minTransientRetryDelay {
				retryPolicy.BaseDelay = minTransientRetryDelay
			}
		}

		if attempt >= maxAttempts {
			break
		}

		delay := backoffDelay(retryPolicy, attempt)
		logFields := log.Fields{
			"operation_id": s.operationID,
			"project_key":  s.projectKey,
			"repo_path":    s.repoPath,
			"command":      "git " + strings.Join(args, " "),
			"attempt":      attempt,
			"max_attempts": maxAttempts,
			"delay_ms":     delay.Milliseconds(),
			"exit_code":    diagnosis.ExitCode,
			"signal":       diagnosis.Signal,
			"stderr":       truncate(lastStderr, 240),
		}
		if deadline, ok := ctx.Deadline(); ok {
			logFields["deadline_ms"] = time.Until(deadline).Milliseconds()
		}
		s.logger.WithContext(ctx).WithFields(logFields).Warn("retrying git command")

		if err := sleepWithContext(ctx, delay); err != nil {
			return stdout, stderr, err
		}
	}

	s.logger.WithContext(ctx).WithFields(log.Fields{
		"operation_id": s.operationID,
		"project_key":  s.projectKey,
		"repo_path":    s.repoPath,
		"command":      "git " + strings.Join(args, " "),
		"attempts":     maxAttempts,
		"stderr":       truncate(lastStderr, 240),
	}).Error("git command failed after retries")
	return lastStdout, lastStderr, lastErr
}

func (s *GitSession) ensureRemote() error {
	if strings.TrimSpace(s.remoteURL) == "" {
		return nil
	}
	stdout, _, err := s.ExecWithRetry(s.ctx, ReadOnlyRetryPolicy, "remote", "get-url", "origin")
	if err != nil {
		if exitCode(err) != 0 {
			_, _, addErr := s.ExecWithRetry(s.ctx, WriteRetryPolicy, "remote", "add", "origin", s.remoteURL)
			return addErr
		}
		return err
	}
	if strings.TrimSpace(stdout) != strings.TrimSpace(s.remoteURL) {
		_, _, err = s.ExecWithRetry(s.ctx, WriteRetryPolicy, "remote", "set-url", "origin", s.remoteURL)
		return err
	}
	return nil
}

func (s *GitSession) cleanupIndexLock(gitDir string) error {
	lockPath := filepath.Join(gitDir, "index.lock")
	if !exists(lockPath) {
		return nil
	}
	if err := os.Remove(lockPath); err != nil {
		return fmt.Errorf("remove index.lock: %w", err)
	}
	s.logger.WithContext(s.ctx).WithFields(log.Fields{
		"operation_id": s.operationID,
		"repo_path":    s.repoPath,
	}).Warn("removed stale index.lock")
	return nil
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

func withTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		timeout = localCmdTimeout
	}
	if ctx == nil {
		return context.WithTimeout(context.Background(), timeout)
	}
	if _, ok := ctx.Deadline(); ok {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, timeout)
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

func exitCode(err error) int {
	var cmdErr *ErrGitCommandFailed
	if errors.As(err, &cmdErr) {
		return cmdErr.ExitCode
	}
	return -1
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

func backoffDelay(policy RetryPolicy, attempt int) time.Duration {
	if attempt <= 0 {
		return policy.BaseDelay
	}
	delay := policy.BaseDelay * time.Duration(1<<(attempt-1))
	if policy.MaxDelay > 0 && delay > policy.MaxDelay {
		return policy.MaxDelay
	}
	return delay
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func truncate(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) <= max {
		return value
	}
	return value[:max] + "..."
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
		return readOnlyCmdTimeout
	case "ls-remote", "fetch", "pull", "push", "clone":
		return networkCmdTimeout
	default:
		return localCmdTimeout
	}
}
