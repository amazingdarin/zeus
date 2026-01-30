package embedding

import (
	"context"
	"fmt"
	"strings"

	"zeus/internal/config"
)

type ConfigRuntimeResolver struct{}

func NewConfigRuntimeResolver() *ConfigRuntimeResolver {
	return &ConfigRuntimeResolver{}
}

func (r *ConfigRuntimeResolver) Resolve(ctx context.Context, scenario string) (ModelRuntime, error) {
	_ = ctx
	if strings.TrimSpace(scenario) != "embedding" {
		return ModelRuntime{}, fmt.Errorf("unsupported scenario: %s", scenario)
	}
	if config.AppConfig == nil {
		return ModelRuntime{}, fmt.Errorf("config not initialized")
	}
	return ModelRuntime{
		BaseURL:   strings.TrimSpace(config.AppConfig.Embedding.BaseURL),
		APIKey:    strings.TrimSpace(config.AppConfig.Embedding.APIKey),
		ModelName: strings.TrimSpace(config.AppConfig.Embedding.ModelName),
	}, nil
}
