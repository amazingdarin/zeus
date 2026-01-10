package mapper

import (
	"zeus/internal/domain"
	"zeus/internal/repository/postgres/model"
)

func ModelProviderFromDomain(provider *domain.ModelProvider) *model.ModelProvider {
	if provider == nil {
		return nil
	}
	return &model.ModelProvider{
		ID:          provider.ID,
		Name:        provider.Name,
		Type:        provider.Type,
		BaseURL:     provider.BaseURL,
		AccessKey:   provider.AccessKey,
		ExtraConfig: encodeJSON(provider.ExtraConfig),
		IsEnabled:   provider.IsEnabled,
		CreatedAt:   provider.CreatedAt,
		UpdatedAt:   provider.UpdatedAt,
	}
}

func ModelProviderToDomain(provider *model.ModelProvider) *domain.ModelProvider {
	if provider == nil {
		return nil
	}
	return &domain.ModelProvider{
		ID:          provider.ID,
		Name:        provider.Name,
		Type:        provider.Type,
		BaseURL:     provider.BaseURL,
		AccessKey:   provider.AccessKey,
		ExtraConfig: decodeJSON(provider.ExtraConfig),
		IsEnabled:   provider.IsEnabled,
		CreatedAt:   provider.CreatedAt,
		UpdatedAt:   provider.UpdatedAt,
	}
}
