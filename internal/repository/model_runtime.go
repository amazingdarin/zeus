package repository

import (
	"context"

	"zeus/internal/domain"
)

type ModelRuntimeRepository interface {
	Insert(ctx context.Context, runtime *domain.ModelRuntime) error
	Update(ctx context.Context, runtime *domain.ModelRuntime) error
	FindByScenario(ctx context.Context, scenario string) (*domain.ModelRuntime, error)
	List(ctx context.Context) ([]*domain.ModelRuntime, error)
}
