package model

import (
	"context"
	"fmt"
	"strings"

	"zeus/internal/infra/embedding"
	"zeus/internal/repository"
	"zeus/internal/util"
)

type RuntimeResolver struct {
	repo          repository.ModelRuntimeRepository
	encryptionKey string
}

func NewRuntimeResolver(repo repository.ModelRuntimeRepository, encryptionKey string) *RuntimeResolver {
	return &RuntimeResolver{repo: repo, encryptionKey: strings.TrimSpace(encryptionKey)}
}

func (r *RuntimeResolver) Resolve(ctx context.Context, scenario string) (embedding.ModelRuntime, error) {
	scenario = strings.TrimSpace(scenario)
	if scenario == "" {
		return embedding.ModelRuntime{}, fmt.Errorf("scenario is required")
	}
	runtime, err := r.repo.FindByScenario(ctx, scenario)
	if err != nil {
		return embedding.ModelRuntime{}, err
	}
	if runtime == nil {
		return embedding.ModelRuntime{}, fmt.Errorf("runtime not found")
	}
	if !runtime.IsActive {
		return embedding.ModelRuntime{}, fmt.Errorf("runtime inactive")
	}
	apiKey := runtime.APIKey
	if strings.TrimSpace(apiKey) != "" {
		decoded, err := util.DecryptString(apiKey, r.encryptionKey)
		if err != nil {
			return embedding.ModelRuntime{}, fmt.Errorf("decrypt api key: %w", err)
		}
		apiKey = decoded
	}
	return embedding.ModelRuntime{
		BaseURL:   runtime.BaseURL,
		APIKey:    apiKey,
		ModelName: runtime.ModelName,
	}, nil
}

var _ embedding.ModelRuntimeResolver = (*RuntimeResolver)(nil)
