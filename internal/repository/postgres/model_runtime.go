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

type ModelRuntimeRepository struct {
	db *gorm.DB
}

func NewModelRuntimeRepository(db *gorm.DB) *ModelRuntimeRepository {
	return &ModelRuntimeRepository{db: db}
}

func (r *ModelRuntimeRepository) Insert(ctx context.Context, runtime *domain.ModelRuntime) error {
	modelObj := mapper.ModelRuntimeFromDomain(runtime)
	if modelObj == nil {
		return fmt.Errorf("runtime is nil")
	}
	if err := r.db.WithContext(ctx).Create(modelObj).Error; err != nil {
		return fmt.Errorf("insert model runtime: %w", err)
	}
	return nil
}

func (r *ModelRuntimeRepository) Update(ctx context.Context, runtime *domain.ModelRuntime) error {
	modelObj := mapper.ModelRuntimeFromDomain(runtime)
	if modelObj == nil {
		return fmt.Errorf("runtime is nil")
	}
	if err := r.db.WithContext(ctx).Save(modelObj).Error; err != nil {
		return fmt.Errorf("update model runtime: %w", err)
	}
	return nil
}

func (r *ModelRuntimeRepository) FindByScenario(ctx context.Context, scenario string) (*domain.ModelRuntime, error) {
	var modelObj model.ModelRuntime
	err := r.db.WithContext(ctx).First(&modelObj, "scenario = ?", scenario).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find model runtime: %w", err)
	}
	return mapper.ModelRuntimeToDomain(&modelObj), nil
}

func (r *ModelRuntimeRepository) List(ctx context.Context) ([]*domain.ModelRuntime, error) {
	var models []model.ModelRuntime
	if err := r.db.WithContext(ctx).Order("created_at DESC").Find(&models).Error; err != nil {
		return nil, fmt.Errorf("list model runtimes: %w", err)
	}
	runtimes := make([]*domain.ModelRuntime, 0, len(models))
	for i := range models {
		runtimes = append(runtimes, mapper.ModelRuntimeToDomain(&models[i]))
	}
	return runtimes, nil
}
