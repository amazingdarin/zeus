package repository

import (
	"context"
	"time"
)

type CodeRun struct {
	ID            string
	RunID         string
	RequestID     string
	OwnerType     string
	OwnerID       string
	ProjectKey    string
	DocID         string
	BlockID       string
	UserID        string
	Language      string
	ImageRef      string
	Status        string
	Stdout        string
	Stderr        string
	Truncated     bool
	TimedOut      bool
	ExitCode      int
	DurationMs    int64
	CPULimitMilli int
	MemoryLimitMB int
	TimeoutMs     int
	CodeSHA256    string
	CreatedAt     time.Time
	StartedAt     *time.Time
	FinishedAt    *time.Time
}

type CodeRunListFilter struct {
	OwnerType  string
	OwnerID    string
	ProjectKey string
	DocID      string
	BlockID    string
	Limit      int
}

type CodeRunRepository interface {
	Insert(ctx context.Context, run *CodeRun) error
	FindByRunID(ctx context.Context, runID string) (*CodeRun, error)
	ListByDocument(ctx context.Context, filter CodeRunListFilter) ([]*CodeRun, error)
}
