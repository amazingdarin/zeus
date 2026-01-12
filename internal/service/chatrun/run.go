package chatrun

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type Status string

const (
	StatusPending   Status = "pending"
	StatusRunning   Status = "running"
	StatusPaused    Status = "paused"
	StatusCompleted Status = "completed"
	StatusCanceled  Status = "canceled"
	StatusFailed    Status = "failed"
)

// ChatRun represents one generation process, not a chat turn.
// It holds a cancelable context for the lifetime of the run.
type ChatRun struct {
	RunID     string
	ProjectID string
	SessionID string
	Message   string
	Status    Status
	Context   context.Context
	Cancel    context.CancelFunc
	CreatedAt time.Time
	UpdatedAt time.Time
}

type RunRegistry interface {
	Create(run *ChatRun) error
	Get(runID string) (*ChatRun, bool)
	UpdateStatus(runID string, status Status) error
	Remove(runID string) error
}

type MemoryRunRegistry struct {
	mu   sync.RWMutex
	runs map[string]*ChatRun
}

func NewMemoryRunRegistry() *MemoryRunRegistry {
	return &MemoryRunRegistry{
		runs: make(map[string]*ChatRun),
	}
}

func (r *MemoryRunRegistry) Create(run *ChatRun) error {
	if run == nil {
		return fmt.Errorf("run is required")
	}
	runID := run.RunID
	if runID == "" {
		return fmt.Errorf("run id is required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.runs[runID]; exists {
		return fmt.Errorf("run %s already exists", runID)
	}
	ensureRunContext(run)
	now := time.Now()
	if run.CreatedAt.IsZero() {
		run.CreatedAt = now
	}
	run.UpdatedAt = now
	r.runs[runID] = run
	return nil
}

func (r *MemoryRunRegistry) Get(runID string) (*ChatRun, bool) {
	if runID == "" {
		return nil, false
	}
	r.mu.RLock()
	run, ok := r.runs[runID]
	r.mu.RUnlock()
	if !ok || run == nil {
		return nil, false
	}
	return run, true
}

func (r *MemoryRunRegistry) UpdateStatus(runID string, status Status) error {
	if runID == "" {
		return fmt.Errorf("run id is required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	run, ok := r.runs[runID]
	if !ok || run == nil {
		return fmt.Errorf("run %s not found", runID)
	}
	run.Status = status
	run.UpdatedAt = time.Now()
	if status == StatusCanceled && run.Cancel != nil {
		run.Cancel()
	}
	return nil
}

func (r *MemoryRunRegistry) Remove(runID string) error {
	if runID == "" {
		return fmt.Errorf("run id is required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.runs, runID)
	return nil
}

func ensureRunContext(run *ChatRun) {
	if run.Context == nil && run.Cancel == nil {
		run.Context, run.Cancel = context.WithCancel(context.Background())
		return
	}
	if run.Context == nil {
		run.Context = context.Background()
	}
	if run.Cancel == nil {
		run.Context, run.Cancel = context.WithCancel(run.Context)
	}
}

func copyRun(run *ChatRun) *ChatRun {
	if run == nil {
		return nil
	}
	return &ChatRun{
		RunID:     run.RunID,
		ProjectID: run.ProjectID,
		SessionID: run.SessionID,
		Message:   run.Message,
		Status:    run.Status,
		Context:   run.Context,
		Cancel:    run.Cancel,
		CreatedAt: run.CreatedAt,
		UpdatedAt: run.UpdatedAt,
	}
}

var _ RunRegistry = (*MemoryRunRegistry)(nil)
