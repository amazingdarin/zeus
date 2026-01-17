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

type ProviderConnectionRepository struct {
	db *gorm.DB
}

func NewProviderConnectionRepository(db *gorm.DB) *ProviderConnectionRepository {
	return &ProviderConnectionRepository{db: db}
}

func (r *ProviderConnectionRepository) Insert(ctx context.Context, connection *domain.ProviderConnection) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	modelObj := mapper.ProviderConnectionFromDomain(connection)
	if err := r.db.WithContext(ctx).Create(modelObj).Error; err != nil {
		return fmt.Errorf("insert provider connection: %w", err)
	}
	return nil
}

func (r *ProviderConnectionRepository) Update(ctx context.Context, connection *domain.ProviderConnection) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	modelObj := mapper.ProviderConnectionFromDomain(connection)
	if err := r.db.WithContext(ctx).Save(modelObj).Error; err != nil {
		return fmt.Errorf("update provider connection: %w", err)
	}
	return nil
}

func (r *ProviderConnectionRepository) FindByID(ctx context.Context, id string) (*domain.ProviderConnection, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	if id == "" {
		return nil, fmt.Errorf("id is required")
	}
	var modelObj model.ProviderConnection
	err := r.db.WithContext(ctx).First(&modelObj, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find provider connection: %w", err)
	}
	return mapper.ProviderConnectionToDomain(&modelObj), nil
}

func (r *ProviderConnectionRepository) List(ctx context.Context) ([]*domain.ProviderConnection, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	var models []model.ProviderConnection
	if err := r.db.WithContext(ctx).Order("created_at desc").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("list provider connections: %w", err)
	}
	connections := make([]*domain.ProviderConnection, 0, len(models))
	for i := range models {
		connections = append(connections, mapper.ProviderConnectionToDomain(&models[i]))
	}
	return connections, nil
}

var _ repository.ProviderConnectionRepository = (*ProviderConnectionRepository)(nil)
