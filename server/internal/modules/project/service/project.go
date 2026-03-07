package service

import (
	"context"

	"zeus/internal/domain"
)

type ProjectService interface {
	Create(ctx context.Context, project *domain.Project) error
	List(ctx context.Context) ([]*domain.Project, error)
	// ListForUser returns projects accessible to the given user
	ListForUser(ctx context.Context, userID string, teamIDs []string) ([]*domain.Project, error)
	GetByKey(ctx context.Context, key string) (*domain.Project, error)
}
