package task

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/service"
)

type Service struct {
	repo repository.TaskRepository
}

func NewService(repo repository.TaskRepository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Create(ctx context.Context, input service.TaskInput) (*domain.Task, error) {
	if s.repo == nil {
		return nil, fmt.Errorf("task repository is required")
	}
	taskType := strings.TrimSpace(input.Type)
	if taskType == "" {
		return nil, fmt.Errorf("task type is required")
	}
	projectID := strings.TrimSpace(input.ProjectID)
	if projectID == "" {
		return nil, fmt.Errorf("project id is required")
	}
	now := time.Now().UTC()
	maxAttempts := input.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 3
	}
	scheduledAt := input.ScheduledAt
	if scheduledAt == nil {
		scheduledAt = &now
	}
	task := &domain.Task{
		ID:             uuid.NewString(),
		Type:           taskType,
		ProjectID:      projectID,
		Payload:        input.Payload,
		Status:         domain.TaskStatusPending,
		Attempts:       0,
		MaxAttempts:    maxAttempts,
		ScheduledAt:    scheduledAt,
		CallbackURL:    strings.TrimSpace(input.CallbackURL),
		CallbackSecret: strings.TrimSpace(input.CallbackSecret),
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := s.repo.Insert(ctx, task); err != nil {
		return nil, err
	}
	return task, nil
}

func (s *Service) Get(ctx context.Context, id string) (*domain.Task, bool, error) {
	if s.repo == nil {
		return nil, false, fmt.Errorf("task repository is required")
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, false, fmt.Errorf("task id is required")
	}
	task, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, false, err
	}
	if task == nil {
		return nil, false, nil
	}
	return task, true, nil
}

var _ service.TaskService = (*Service)(nil)
