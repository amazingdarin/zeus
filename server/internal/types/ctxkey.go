package types

type SessionKey struct{}

// RepoSkipPullKey marks a request context that should skip git pull for repo access.
type RepoSkipPullKey struct{}

// CtxKey represents context keys for user information
type CtxKey string

const (
	CtxKeyUserID       CtxKey = "user_id"
	CtxKeyUserEmail    CtxKey = "user_email"
	CtxKeyUserUsername CtxKey = "user_username"
)
