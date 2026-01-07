package domain

// SessionGitContext carries the session-scoped git working copy information.
// It is a pure domain struct and does not perform any IO or git operations.
type SessionGitContext struct {
	SessionID  string
	ProjectKey string
	RepoPath   string
}
