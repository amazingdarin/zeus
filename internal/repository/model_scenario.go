package repository

import (
	"context"

	"zeus/internal/domain"
)

type ModelScenarioRepository interface {
	Insert(ctx context.Context, config *domain.ModelScenarioConfig) error
	Update(ctx context.Context, config *domain.ModelScenarioConfig) error
	FindByScenario(ctx context.Context, scenario string) (*domain.ModelScenarioConfig, error)
	List(ctx context.Context) ([]*domain.ModelScenarioConfig, error)
}
