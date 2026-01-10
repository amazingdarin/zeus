package postgres

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"zeus/internal/domain"
	"zeus/internal/repository/postgres/mapper"
	"zeus/internal/repository/postgres/model"
)

type ModelProviderRepository struct {
	db *gorm.DB
}

func NewModelProviderRepository(db *gorm.DB) *ModelProviderRepository {
	return &ModelProviderRepository{db: db}
}

func (r *ModelProviderRepository) Insert(ctx context.Context, provider *domain.ModelProvider) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	modelObj := mapper.ModelProviderFromDomain(provider)
	if modelObj == nil {
		return fmt.Errorf("provider is nil")
	}
	if err := r.db.WithContext(ctx).Create(modelObj).Error; err != nil {
		return fmt.Errorf("insert model provider: %w", err)
	}
	return nil
}

func (r *ModelProviderRepository) Update(ctx context.Context, provider *domain.ModelProvider) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	modelObj := mapper.ModelProviderFromDomain(provider)
	if modelObj == nil {
		return fmt.Errorf("provider is nil")
	}
	if err := r.db.WithContext(ctx).Save(modelObj).Error; err != nil {
		return fmt.Errorf("update model provider: %w", err)
	}
	return nil
}

func (r *ModelProviderRepository) FindByID(ctx context.Context, id string) (*domain.ModelProvider, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	if id == "" {
		return nil, fmt.Errorf("id is required")
	}
	var modelObj model.ModelProvider
	err := r.db.WithContext(ctx).First(&modelObj, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find model provider: %w", err)
	}
	return mapper.ModelProviderToDomain(&modelObj), nil
}

func (r *ModelProviderRepository) List(ctx context.Context) ([]*domain.ModelProvider, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	var models []model.ModelProvider
	if err := r.db.WithContext(ctx).Order("created_at DESC").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("list model providers: %w", err)
	}
	providers := make([]*domain.ModelProvider, 0, len(models))
	for i := range models {
		providers = append(providers, mapper.ModelProviderToDomain(&models[i]))
	}
	return providers, nil
}
