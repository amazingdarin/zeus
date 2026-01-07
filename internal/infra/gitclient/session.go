package gitclient

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"zeus/internal/domain"
)

const DefaultSessionRepoRoot = "/var/lib/zeus/git-sessions"

var SessionRepoRoot = DefaultSessionRepoRoot

type sessionClientKey struct{}

func SetSessionRepoRoot(root string) {
	root = strings.TrimSpace(root)
	if root == "" {
		return
	}
	SessionRepoRoot = root
}

func SessionRepoPath(sessionID, projectKey string) string {
	sessionID = normalizePathSegment(sessionID)
	projectKey = normalizePathSegment(projectKey)
	if sessionID == "" || projectKey == "" {
		return ""
	}
	return filepath.Join(SessionRepoRoot, sessionID, projectKey)
}

func WithSessionClient(ctx context.Context, client *SessionGitClient) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, sessionClientKey{}, client)
}

func SessionClientFromContext(ctx context.Context) (*SessionGitClient, bool) {
	if ctx == nil {
		return nil, false
	}
	value := ctx.Value(sessionClientKey{})
	if value == nil {
		return nil, false
	}
	client, ok := value.(*SessionGitClient)
	return client, ok
}

type SessionGitClient struct {
	ctx       domain.SessionGitContext
	git       *GitClient
	readyOnce sync.Once
	readyErr  error
	mu        sync.Mutex
	brokenErr error
}

func NewSessionGitClient(ctx domain.SessionGitContext, git *GitClient) *SessionGitClient {
	return &SessionGitClient{
		ctx: ctx,
		git: git,
	}
}

func (c *SessionGitClient) Context() domain.SessionGitContext {
	if c == nil {
		return domain.SessionGitContext{}
	}
	return c.ctx
}

func (c *SessionGitClient) SetRemote(remoteURL string) {
	if c == nil || c.git == nil {
		return
	}
	c.git.SetRemote(remoteURL)
}

func (c *SessionGitClient) SetAuthor(name, email string) {
	if c == nil || c.git == nil {
		return
	}
	c.git.SetAuthor(name, email)
}

func (c *SessionGitClient) WithSessionRepo(
	ctx context.Context,
	fn func(*GitSession) error,
) error {
	if c == nil || c.git == nil {
		return fmt.Errorf("session git client is required")
	}
	if fn == nil {
		return fmt.Errorf("session repo operation is required")
	}

	c.readyOnce.Do(func() {
		c.readyErr = c.git.EnsureReady(ctx)
	})
	if c.readyErr != nil {
		return c.readyErr
	}
	if err := c.broken(); err != nil {
		return err
	}
	ctx = WithSessionClient(ctx, c)
	err := c.git.WithRepo(ctx, fn)
	if err != nil {
		c.markBrokenIfNeeded(err)
	}
	return err
}

func (c *SessionGitClient) broken() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.brokenErr != nil {
		return c.brokenErr
	}
	return nil
}

func (c *SessionGitClient) markBrokenIfNeeded(err error) {
	if err == nil {
		return
	}
	if errors.Is(err, ErrRepoInProgress) {
		c.setBroken(err)
		return
	}

	var cmdErr *ErrGitCommandFailed
	if errors.As(err, &cmdErr) {
		if ClassifyGitError(cmdErr.Stderr, cmdErr) == GitErrFatal {
			c.setBroken(err)
		}
	}
}

func (c *SessionGitClient) setBroken(err error) {
	if err == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.brokenErr == nil {
		c.brokenErr = err
	}
}

type SessionGitManager struct {
	baseDir string
	clients sync.Map
	factory *ClientFactory
}

func NewSessionGitManager(baseDir string, factory *ClientFactory) *SessionGitManager {
	baseDir = strings.TrimSpace(baseDir)
	if baseDir == "" {
		baseDir = SessionRepoRoot
	}
	if factory == nil {
		factory = NewClientFactory(nil)
	}
	return &SessionGitManager{
		baseDir: baseDir,
		factory: factory,
	}
}

func (m *SessionGitManager) Get(sessionID string, projectKey string) (*SessionGitClient, error) {
	if m == nil {
		return nil, fmt.Errorf("session git manager is required")
	}
	sessionID = normalizePathSegment(sessionID)
	projectKey = normalizePathSegment(projectKey)
	if sessionID == "" || projectKey == "" {
		return nil, fmt.Errorf("session_id and project_key are required")
	}
	key := sessionKey(sessionID, projectKey)
	if value, ok := m.clients.Load(key); ok {
		if client, ok := value.(*SessionGitClient); ok {
			return client, nil
		}
	}

	repoPath := filepath.Join(m.baseDir, sessionID, projectKey)
	if err := os.MkdirAll(repoPath, 0o755); err != nil {
		return nil, fmt.Errorf("create session repo path: %w", err)
	}
	client := NewSessionGitClient(
		domain.SessionGitContext{
			SessionID:  sessionID,
			ProjectKey: projectKey,
			RepoPath:   repoPath,
		},
		m.factory.ForRepo(repoPath, projectKey),
	)
	value, loaded := m.clients.LoadOrStore(key, client)
	if loaded {
		if existing, ok := value.(*SessionGitClient); ok {
			return existing, nil
		}
	}
	return client, nil
}

func (m *SessionGitManager) Release(sessionID string) {
	if m == nil {
		return
	}
	sessionID = normalizePathSegment(sessionID)
	if sessionID == "" {
		return
	}
	prefix := sessionID + ":"
	m.clients.Range(func(key, value interface{}) bool {
		keyStr, ok := key.(string)
		if !ok || !strings.HasPrefix(keyStr, prefix) {
			return true
		}
		m.clients.Delete(key)
		if client, ok := value.(*SessionGitClient); ok {
			repoPath := client.Context().RepoPath
			if repoPath != "" {
				_ = os.RemoveAll(repoPath)
			}
		}
		return true
	})
}

func sessionKey(sessionID, projectKey string) string {
	return sessionID + ":" + projectKey
}

func normalizePathSegment(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, string(filepath.Separator), "_")
	value = strings.ReplaceAll(value, "/", "_")
	return value
}
