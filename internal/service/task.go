package service

import (
	"context"
	"time"

	"zeus/internal/domain"
)

type TaskInput struct {
	Type           string
	ProjectID      string
	Payload        map[string]interface{}
	MaxAttempts    int
	ScheduledAt    *time.Time
	CallbackURL    string
	CallbackSecret string
}

type TaskService interface {
	Create(ctx context.Context, input TaskInput) (*domain.Task, error)
	Get(ctx context.Context, id string) (*domain.Task, bool, error)
}
