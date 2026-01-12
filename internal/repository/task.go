package repository

import (
	"context"
	"time"

	"zeus/internal/domain"
)

type TaskRepository interface {
	Insert(ctx context.Context, task *domain.Task) error
	FindByID(ctx context.Context, id string) (*domain.Task, error)
	ClaimPending(ctx context.Context, workerID string, limit int, lockDuration time.Duration) ([]*domain.Task, error)
	Complete(ctx context.Context, id string, status domain.TaskStatus, result map[string]interface{}, errorMessage string) error
	Reschedule(ctx context.Context, id string, delay time.Duration) error
}
