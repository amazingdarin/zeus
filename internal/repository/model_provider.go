package repository

import (
	"context"

	"zeus/internal/domain"
)

type ModelProviderRepository interface {
	Insert(ctx context.Context, provider *domain.ModelProvider) error
	Update(ctx context.Context, provider *domain.ModelProvider) error
	FindByID(ctx context.Context, id string) (*domain.ModelProvider, error)
	List(ctx context.Context) ([]*domain.ModelProvider, error)
}
