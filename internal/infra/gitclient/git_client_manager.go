package gitclient

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type ClientFactory func(key GitKey, remoteURL string) *GitClient

type GitClientManager struct {
	mu      sync.Mutex
	clients map[GitKey]*GitClient
	factory ClientFactory
}

func NewGitClientManager(factory ClientFactory) *GitClientManager {
	if factory == nil {
		factory = func(key GitKey, remoteURL string) *GitClient {
			return NewGitClient(key)
		}
	}
	return &GitClientManager{
		clients: make(map[GitKey]*GitClient),
		factory: factory,
	}
}

// Get returns a managed client with an acquired reference.
// The caller must Close() the returned handle.
func (m *GitClientManager) Get(key GitKey, remoteURL string) (*ManagedClient, error) {
	if m == nil {
		return nil, fmt.Errorf("git client manager is required")
	}
	if key == "" {
		return nil, fmt.Errorf("git key is required")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	client := m.clients[key]
	if client == nil || client.State() == GitStateClosed {
		if client != nil && client.State() == GitStateClosed {
			delete(m.clients, key)
		}
		client = m.factory(key, remoteURL)
		m.clients[key] = client
	}
	if err := client.acquire(); err != nil {
		if err == ErrClientClosed {
			delete(m.clients, key)
			client = m.factory(key, remoteURL)
			m.clients[key] = client
			if err := client.acquire(); err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}
	}
	return &ManagedClient{client: client}, nil
}

// StartGC launches the background collector that closes idle clients.
func (m *GitClientManager) StartGC(ctx context.Context, interval time.Duration, ttl time.Duration) {
	if m == nil || interval <= 0 || ttl <= 0 {
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
				m.collect(ctx, ttl)
			}
		}
	}()
}

func (m *GitClientManager) collect(ctx context.Context, ttl time.Duration) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, client := range m.clients {
		if client == nil {
			delete(m.clients, key)
			continue
		}
		if client.State() == GitStateClosed {
			delete(m.clients, key)
			continue
		}
		if client.RefCount() > 0 {
			continue
		}
		lastUsed := client.LastUsed()
		if !lastUsed.IsZero() && now.Sub(lastUsed) <= ttl {
			continue
		}
		if err := client.close(ctx); err == nil {
			delete(m.clients, key)
		}
	}
}

type ManagedClient struct {
	client *GitClient
	once   sync.Once
}

func (m *ManagedClient) Client() *GitClient {
	if m == nil {
		return nil
	}
	return m.client
}

func (m *ManagedClient) Close() {
	if m == nil || m.client == nil {
		return
	}
	m.once.Do(func() {
		m.client.release()
	})
}
