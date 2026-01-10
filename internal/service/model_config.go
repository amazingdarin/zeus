package service

import (
	"context"

	"zeus/internal/domain"
)

type ModelProviderCreateInput struct {
	Name        string
	Type        string
	BaseURL     string
	AccessKey   string
	ExtraConfig map[string]interface{}
	IsEnabled   bool
}

type ModelScenarioConfigInput struct {
	Scenario   string
	ProviderID string
	ModelName  string
	Parameters map[string]interface{}
	IsActive   bool
}

type ModelInfo struct {
	ID   string
	Name string
}

type ModelProviderService interface {
	Create(ctx context.Context, input ModelProviderCreateInput) (*domain.ModelProvider, error)
	List(ctx context.Context) ([]*domain.ModelProvider, error)
	ListModels(ctx context.Context, id string) ([]ModelInfo, error)
}

type ModelScenarioService interface {
	Configure(ctx context.Context, input ModelScenarioConfigInput) (*domain.ModelScenarioConfig, error)
	List(ctx context.Context) ([]*domain.ModelScenarioConfig, error)
}
