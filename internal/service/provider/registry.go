package provider

import (
	"context"
	"fmt"
	"strings"

	"zeus/internal/domain"
)

type Registry struct {
	providers map[string]domain.ProviderDefinition
}

func NewRegistry() *Registry {
	providers := map[string]domain.ProviderDefinition{
		"openai": {
			ID:                 "openai",
			Name:               "OpenAI",
			AuthType:           domain.ProviderAuthAPI,
			DefaultBaseURL:     "https://api.openai.com",
			Capabilities:       []domain.ProviderCapability{domain.ProviderCapabilityChat, domain.ProviderCapabilityEmbeddings, domain.ProviderCapabilityResponses},
			ChatEndpoint:       "/v1/chat/completions",
			ResponsesEndpoint:  "/v1/responses",
			EmbeddingsEndpoint: "/v1/embeddings",
		},
		"copilot": {
			ID:                 "copilot",
			Name:               "GitHub Copilot",
			AuthType:           domain.ProviderAuthDevice,
			DefaultBaseURL:     "https://api.githubcopilot.com",
			Capabilities:       []domain.ProviderCapability{domain.ProviderCapabilityChat, domain.ProviderCapabilityEmbeddings},
			ChatEndpoint:       "/v1/chat/completions",
			EmbeddingsEndpoint: "/v1/embeddings",
		},
	}
	return &Registry{providers: providers}
}

func (r *Registry) List(ctx context.Context) ([]domain.ProviderDefinition, error) {
	if r == nil {
		return nil, fmt.Errorf("provider registry not initialized")
	}
	items := make([]domain.ProviderDefinition, 0, len(r.providers))
	for _, provider := range r.providers {
		items = append(items, provider)
	}
	return items, nil
}

func (r *Registry) Get(ctx context.Context, providerID string) (domain.ProviderDefinition, error) {
	if r == nil {
		return domain.ProviderDefinition{}, fmt.Errorf("provider registry not initialized")
	}
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return domain.ProviderDefinition{}, fmt.Errorf("provider id is required")
	}
	provider, ok := r.providers[providerID]
	if !ok {
		return domain.ProviderDefinition{}, fmt.Errorf("provider not found")
	}
	return provider, nil
}
