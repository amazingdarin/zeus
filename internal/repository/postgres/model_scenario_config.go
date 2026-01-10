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

type ModelScenarioRepository struct {
	db *gorm.DB
}

func NewModelScenarioRepository(db *gorm.DB) *ModelScenarioRepository {
	return &ModelScenarioRepository{db: db}
}

func (r *ModelScenarioRepository) Insert(ctx context.Context, config *domain.ModelScenarioConfig) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	modelObj := mapper.ModelScenarioFromDomain(config)
	if modelObj == nil {
		return fmt.Errorf("scenario config is nil")
	}
	if err := r.db.WithContext(ctx).Create(modelObj).Error; err != nil {
		return fmt.Errorf("insert model scenario config: %w", err)
	}
	return nil
}

func (r *ModelScenarioRepository) Update(ctx context.Context, config *domain.ModelScenarioConfig) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	modelObj := mapper.ModelScenarioFromDomain(config)
	if modelObj == nil {
		return fmt.Errorf("scenario config is nil")
	}
	if err := r.db.WithContext(ctx).Save(modelObj).Error; err != nil {
		return fmt.Errorf("update model scenario config: %w", err)
	}
	return nil
}

func (r *ModelScenarioRepository) FindByScenario(ctx context.Context, scenario string) (*domain.ModelScenarioConfig, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	if scenario == "" {
		return nil, fmt.Errorf("scenario is required")
	}
	var modelObj model.ModelScenarioConfig
	err := r.db.WithContext(ctx).First(&modelObj, "scenario = ?", scenario).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find model scenario config: %w", err)
	}
	return mapper.ModelScenarioToDomain(&modelObj), nil
}

func (r *ModelScenarioRepository) List(ctx context.Context) ([]*domain.ModelScenarioConfig, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	var models []model.ModelScenarioConfig
	if err := r.db.WithContext(ctx).Order("created_at DESC").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("list model scenario configs: %w", err)
	}
	configs := make([]*domain.ModelScenarioConfig, 0, len(models))
	for i := range models {
		configs = append(configs, mapper.ModelScenarioToDomain(&models[i]))
	}
	return configs, nil
}
