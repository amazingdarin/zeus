package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"sync"
	"time"

	"zeus/internal/types"
)

// Session stores HTTP session state for repository isolation.
type Session struct {
	ID        string
	UserID    string
	CreatedAt time.Time
	LastSeen  time.Time
}

func WithSession(ctx context.Context, s *Session) context.Context {
	return context.WithValue(ctx, types.SessionKey{}, s)
}

func FromContext(ctx context.Context) (*Session, bool) {
	s, ok := ctx.Value(types.SessionKey{}).(*Session)
	return s, ok
}

type SessionManager struct {
	sessions  sync.Map
	onRelease func(sessionID string)
}

func NewSessionManager(onRelease func(sessionID string)) *SessionManager {
	return &SessionManager{onRelease: onRelease}
}

func (sm *SessionManager) Create(id string) (*Session, error) {
	if sm == nil {
		return nil, fmt.Errorf("session manager is required")
	}
	if id == "" {
		id = NewSessionID()
	}
	now := time.Now()
	session := &Session{
		ID:        id,
		CreatedAt: now,
		LastSeen:  now,
	}
	sm.sessions.Store(id, session)
	return session, nil
}

func (sm *SessionManager) Get(id string) (*Session, bool) {
	if sm == nil || id == "" {
		return nil, false
	}
	value, ok := sm.sessions.Load(id)
	if !ok {
		return nil, false
	}
	session, ok := value.(*Session)
	return session, ok
}

func (sm *SessionManager) Delete(id string) {
	if sm == nil || id == "" {
		return
	}
	sm.sessions.Delete(id)
	if sm.onRelease != nil {
		sm.onRelease(id)
	}
}

func (sm *SessionManager) GC(ttl time.Duration) {
	if sm == nil {
		return
	}
	now := time.Now()
	sm.sessions.Range(func(key, value interface{}) bool {
		session, ok := value.(*Session)
		if !ok {
			sm.sessions.Delete(key)
			return true
		}
		if ttl > 0 && now.Sub(session.LastSeen) > ttl {
			id, _ := key.(string)
			sm.Delete(id)
		}
		return true
	})
}

func NewSessionID() string {
	const size = 16
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Errorf("generate session id: %w", err))
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}
