package repository

import (
	"context"

	"zeus/internal/domain"
)

type ProviderConnectionRepository interface {
	Insert(ctx context.Context, connection *domain.ProviderConnection) error
	Update(ctx context.Context, connection *domain.ProviderConnection) error
	FindByID(ctx context.Context, id string) (*domain.ProviderConnection, error)
	List(ctx context.Context) ([]*domain.ProviderConnection, error)
}
