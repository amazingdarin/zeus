package mapper

import (
	"zeus/internal/domain"
	"zeus/internal/repository/postgres/model"
)

func ModelScenarioFromDomain(config *domain.ModelScenarioConfig) *model.ModelScenarioConfig {
	if config == nil {
		return nil
	}
	return &model.ModelScenarioConfig{
		ID:         config.ID,
		Scenario:   config.Scenario,
		ProviderID: config.ProviderID,
		ModelName:  config.ModelName,
		Parameters: encodeJSON(config.Parameters),
		IsActive:   config.IsActive,
		CreatedAt:  config.CreatedAt,
		UpdatedAt:  config.UpdatedAt,
	}
}

func ModelScenarioToDomain(config *model.ModelScenarioConfig) *domain.ModelScenarioConfig {
	if config == nil {
		return nil
	}
	return &domain.ModelScenarioConfig{
		ID:         config.ID,
		Scenario:   config.Scenario,
		ProviderID: config.ProviderID,
		ModelName:  config.ModelName,
		Parameters: decodeJSON(config.Parameters),
		IsActive:   config.IsActive,
		CreatedAt:  config.CreatedAt,
		UpdatedAt:  config.UpdatedAt,
	}
}
