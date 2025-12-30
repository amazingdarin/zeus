package service

import (
	"context"

	"zeus/internal/domain"
)

type ProjectService interface {
	Create(ctx context.Context, project *domain.Project) error
	List(ctx context.Context) ([]*domain.Project, error)
	GetByKey(ctx context.Context, key string) (*domain.Project, error)
	ListDocuments(ctx context.Context, projectKey string, parentID string) ([]*domain.Document, error)
}
