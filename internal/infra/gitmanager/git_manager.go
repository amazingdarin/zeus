package gitmanager

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type GitClientFactory func(key GitKey) (*GitClient, error)

type GitManagerOption func(*GitManager)

type GitManager struct {
	mu      sync.Mutex
	clients map[GitKey]*GitClient
	factory GitClientFactory
	ttl     time.Duration
}

func NewGitManager(factory GitClientFactory, opts ...GitManagerOption) *GitManager {
	manager := &GitManager{
		clients: make(map[GitKey]*GitClient),
		factory: factory,
		ttl:     30 * time.Minute,
	}
	if manager.factory == nil {
		manager.factory = func(key GitKey) (*GitClient, error) {
			return NewGitClient(key), nil
		}
	}
	for _, opt := range opts {
		if opt != nil {
			opt(manager)
		}
	}
	return manager
}

func WithTTL(ttl time.Duration) GitManagerOption {
	return func(manager *GitManager) {
		if manager != nil {
			manager.ttl = ttl
		}
	}
}

type ManagedGitClient struct {
	*GitClient
	releaseOnce sync.Once
}

func (m *ManagedGitClient) Close() error {
	if m == nil || m.GitClient == nil {
		return nil
	}
	m.releaseOnce.Do(func() {
		m.GitClient.release()
	})
	return nil
}

func (m *GitManager) Get(key GitKey) (*ManagedGitClient, error) {
	if m == nil {
		return nil, fmt.Errorf("git manager is required")
	}
	if key == "" {
		return nil, fmt.Errorf("git key is required")
	}
	var lastErr error
	for attempts := 0; attempts < 2; attempts++ {
		m.mu.Lock()
		client := m.clients[key]
		if client != nil && client.State() == GitStateClosed {
			delete(m.clients, key)
			client = nil
		}
		if client == nil {
			created, err := m.factory(key)
			if err != nil {
				m.mu.Unlock()
				return nil, err
			}
			client = created
			m.clients[key] = client
		}
		lastErr = client.acquire()
		m.mu.Unlock()
		if lastErr == nil {
			return &ManagedGitClient{GitClient: client}, nil
		}
		if lastErr == ErrClientClosed {
			continue
		}
		break
	}
	return nil, lastErr
}

func (m *GitManager) StartGC(ctx context.Context, interval time.Duration) {
	if m == nil || interval <= 0 {
		return
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.collect(ctx)
			}
		}
	}()
}

func (m *GitManager) collect(ctx context.Context) {
	if m == nil {
		return
	}
	ttl := m.ttl
	if ttl <= 0 {
		return
	}
	now := time.Now()
	m.mu.Lock()
	clients := make(map[GitKey]*GitClient, len(m.clients))
	for key, client := range m.clients {
		clients[key] = client
	}
	m.mu.Unlock()

	for key, client := range clients {
		if client == nil {
			continue
		}
		if client.State() == GitStateClosed {
			m.mu.Lock()
			if current := m.clients[key]; current == client {
				delete(m.clients, key)
			}
			m.mu.Unlock()
			continue
		}
		if client.RefCount() != 0 {
			continue
		}
		if now.Sub(client.LastUsed()) < ttl {
			continue
		}
		_ = client.close(ctx)
		if client.State() == GitStateClosed {
			m.mu.Lock()
			if current := m.clients[key]; current == client {
				delete(m.clients, key)
			}
			m.mu.Unlock()
		}
	}
}
