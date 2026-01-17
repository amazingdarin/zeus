package repository

import (
	"context"

	"zeus/internal/domain"
)

type ProviderCredentialRepository interface {
	Insert(ctx context.Context, credential *domain.ProviderCredential) error
	Update(ctx context.Context, credential *domain.ProviderCredential) error
	FindByID(ctx context.Context, id string) (*domain.ProviderCredential, error)
	FindByProvider(ctx context.Context, providerID string) ([]*domain.ProviderCredential, error)
}
