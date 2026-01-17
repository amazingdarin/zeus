package service

import (
	"context"

	"zeus/internal/domain"
)

type ModelRuntimeInput struct {
	Scenario             string
	Name                 string
	BaseURL              string
	APIKey               string
	ModelName            string
	Parameters           map[string]interface{}
	ProviderConnectionID string
	IsActive             bool
}

type ModelRuntimeTestInput struct {
	Scenario  string
	BaseURL   string
	APIKey    string
	ModelName string
}

type ModelRuntimeService interface {
	Upsert(ctx context.Context, input ModelRuntimeInput) (*domain.ModelRuntime, error)
	List(ctx context.Context) ([]*domain.ModelRuntime, error)
	RefreshModels(ctx context.Context, baseURL, apiKey string) ([]string, error)
	Test(ctx context.Context, input ModelRuntimeTestInput) error
}
