package mapper

import (
	"zeus/internal/domain"
	"zeus/internal/repository/postgres/model"
)

func ModelRuntimeFromDomain(runtime *domain.ModelRuntime) *model.ModelRuntime {
	if runtime == nil {
		return nil
	}
	return &model.ModelRuntime{
		ID:                   runtime.ID,
		Scenario:             runtime.Scenario,
		Name:                 runtime.Name,
		BaseURL:              runtime.BaseURL,
		APIKey:               runtime.APIKey,
		ModelName:            runtime.ModelName,
		Parameters:           encodeJSON(runtime.Parameters),
		ProviderConnectionID: runtime.ProviderConnectionID,
		IsActive:             runtime.IsActive,
		CreatedAt:            runtime.CreatedAt,
		UpdatedAt:            runtime.UpdatedAt,
	}
}

func ModelRuntimeToDomain(runtime *model.ModelRuntime) *domain.ModelRuntime {
	if runtime == nil {
		return nil
	}
	return &domain.ModelRuntime{
		ID:                   runtime.ID,
		Scenario:             runtime.Scenario,
		Name:                 runtime.Name,
		BaseURL:              runtime.BaseURL,
		APIKey:               runtime.APIKey,
		ModelName:            runtime.ModelName,
		Parameters:           decodeJSON(runtime.Parameters),
		ProviderConnectionID: runtime.ProviderConnectionID,
		IsActive:             runtime.IsActive,
		CreatedAt:            runtime.CreatedAt,
		UpdatedAt:            runtime.UpdatedAt,
	}
}
