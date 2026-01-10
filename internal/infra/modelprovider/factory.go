package modelprovider

import (
	"fmt"
	"strings"

	"zeus/internal/domain"
)

type AdapterFactory func(provider *domain.ModelProvider) (ModelProvider, error)

func DefaultAdapterFactory(provider *domain.ModelProvider) (ModelProvider, error) {
	if provider == nil {
		return nil, fmt.Errorf("provider is required")
	}
	providerType := strings.ToLower(strings.TrimSpace(provider.Type))
	switch providerType {
	case "openai":
		return NewOpenAIProvider(provider.BaseURL, provider.AccessKey), nil
	default:
		return nil, fmt.Errorf("unsupported provider type: %s", provider.Type)
	}
}
