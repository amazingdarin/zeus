package postgres

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/repository/postgres/mapper"
	"zeus/internal/repository/postgres/model"
)

type ProviderCredentialRepository struct {
	db *gorm.DB
}

func NewProviderCredentialRepository(db *gorm.DB) *ProviderCredentialRepository {
	return &ProviderCredentialRepository{db: db}
}

func (r *ProviderCredentialRepository) Insert(ctx context.Context, credential *domain.ProviderCredential) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	modelObj := mapper.ProviderCredentialFromDomain(credential)
	if err := r.db.WithContext(ctx).Create(modelObj).Error; err != nil {
		return fmt.Errorf("insert provider credential: %w", err)
	}
	return nil
}

func (r *ProviderCredentialRepository) Update(ctx context.Context, credential *domain.ProviderCredential) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	modelObj := mapper.ProviderCredentialFromDomain(credential)
	if err := r.db.WithContext(ctx).Save(modelObj).Error; err != nil {
		return fmt.Errorf("update provider credential: %w", err)
	}
	return nil
}

func (r *ProviderCredentialRepository) FindByID(ctx context.Context, id string) (*domain.ProviderCredential, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	if id == "" {
		return nil, fmt.Errorf("id is required")
	}
	var modelObj model.ProviderCredential
	err := r.db.WithContext(ctx).First(&modelObj, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find provider credential: %w", err)
	}
	return mapper.ProviderCredentialToDomain(&modelObj), nil
}

func (r *ProviderCredentialRepository) FindByProvider(ctx context.Context, providerID string) ([]*domain.ProviderCredential, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	if providerID == "" {
		return nil, fmt.Errorf("provider id is required")
	}
	var models []model.ProviderCredential
	if err := r.db.WithContext(ctx).Where("provider_id = ?", providerID).Order("created_at desc").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("list provider credentials: %w", err)
	}
	items := make([]*domain.ProviderCredential, 0, len(models))
	for i := range models {
		items = append(items, mapper.ProviderCredentialToDomain(&models[i]))
	}
	return items, nil
}

var _ repository.ProviderCredentialRepository = (*ProviderCredentialRepository)(nil)
