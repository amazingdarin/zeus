package project

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
	repo repository.ProjectRepository
}

func NewService(repo repository.ProjectRepository) *Service {
	return &Service{
		repo: repo,
	}
}

func (s *Service) Create(ctx context.Context, project *domain.Project) error {
	if s == nil || s.repo == nil {
		return fmt.Errorf("project service not initialized")
	}
	if project == nil {
		return fmt.Errorf("project is required")
	}
	if strings.TrimSpace(project.ID) == "" {
		project.ID = uuid.NewString()
	}

	now := time.Now()
	project.CreatedAt = now
	project.UpdatedAt = now

	if err := project.Validate(); err != nil {
		return err
	}

	if err := s.repo.Insert(ctx, project); err != nil {
		return fmt.Errorf("insert project: %w", err)
	}
	return nil
}

func (s *Service) List(ctx context.Context) ([]*domain.Project, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("project service not initialized")
	}
	projects, _, err := s.repo.List(ctx, repository.ProjectFilter{}, repository.ProjectOption{})
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	return projects, nil
}

var _ service.ProjectService = (*Service)(nil)
