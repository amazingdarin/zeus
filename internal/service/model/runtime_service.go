package model

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"zeus/internal/domain"
	"zeus/internal/infra/modelruntime"
	"zeus/internal/repository"
	"zeus/internal/service"
	"zeus/internal/util"
)

type RuntimeService struct {
	repo          repository.ModelRuntimeRepository
	clientFactory modelruntime.ClientFactory
	encryptionKey string
	now           func() time.Time
}

func NewRuntimeService(
	repo repository.ModelRuntimeRepository,
	clientFactory modelruntime.ClientFactory,
	encryptionKey string,
) *RuntimeService {
	if clientFactory == nil {
		clientFactory = modelruntime.DefaultClientFactory
	}
	return &RuntimeService{
		repo:          repo,
		clientFactory: clientFactory,
		encryptionKey: strings.TrimSpace(encryptionKey),
		now:           time.Now,
	}
}

func (s *RuntimeService) Upsert(
	ctx context.Context,
	input service.ModelRuntimeInput,
) (*domain.ModelRuntime, error) {
	scenario := strings.TrimSpace(input.Scenario)
	if scenario == "" {
		return nil, fmt.Errorf("scenario is required")
	}
	if !isValidScenario(scenario) {
		return nil, fmt.Errorf("invalid scenario")
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = defaultScenarioName(scenario)
	}
	modelName := strings.TrimSpace(input.ModelName)
	if modelName == "" {
		return nil, fmt.Errorf("model_name is required")
	}
	baseURL := strings.TrimSpace(input.BaseURL)

	existing, err := s.repo.FindByScenario(ctx, scenario)
	if err != nil {
		return nil, err
	}

	apiKey := strings.TrimSpace(input.APIKey)
	encryptedKey := ""
	if apiKey != "" {
		cipherText, err := util.EncryptString(apiKey, s.encryptionKey)
		if err != nil {
			return nil, fmt.Errorf("encrypt api key: %w", err)
		}
		encryptedKey = cipherText
	} else if existing != nil {
		encryptedKey = existing.APIKey
	}

	now := s.now()
	if existing == nil {
		runtime := &domain.ModelRuntime{
			ID:         uuid.NewString(),
			Scenario:   scenario,
			Name:       name,
			BaseURL:    baseURL,
			APIKey:     encryptedKey,
			ModelName:  modelName,
			Parameters: input.Parameters,
			IsActive:   input.IsActive,
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		if err := s.repo.Insert(ctx, runtime); err != nil {
			return nil, err
		}
		return sanitizeRuntime(runtime), nil
	}

	existing.Name = name
	existing.BaseURL = baseURL
	existing.APIKey = encryptedKey
	existing.ModelName = modelName
	existing.Parameters = input.Parameters
	existing.IsActive = input.IsActive
	existing.UpdatedAt = now
	if err := s.repo.Update(ctx, existing); err != nil {
		return nil, err
	}
	return sanitizeRuntime(existing), nil
}

func (s *RuntimeService) List(ctx context.Context) ([]*domain.ModelRuntime, error) {
	runtimes, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range runtimes {
		runtimes[i] = sanitizeRuntime(runtimes[i])
	}
	return runtimes, nil
}

func (s *RuntimeService) RefreshModels(ctx context.Context, baseURL, apiKey string) ([]string, error) {
	client := s.clientFactory(strings.TrimSpace(baseURL), strings.TrimSpace(apiKey))
	models, err := client.ListModels(ctx)
	if err != nil {
		return nil, err
	}
	return models, nil
}

func (s *RuntimeService) Test(ctx context.Context, input service.ModelRuntimeTestInput) error {
	scenario := strings.TrimSpace(input.Scenario)
	if scenario == "" {
		return fmt.Errorf("scenario is required")
	}
	client := s.clientFactory(strings.TrimSpace(input.BaseURL), strings.TrimSpace(input.APIKey))
	modelName := strings.TrimSpace(input.ModelName)
	if modelName == "" {
		return fmt.Errorf("model_name is required")
	}
	switch scenario {
	case "chat":
		return client.TestChat(ctx, modelName)
	case "embedding":
		return client.TestEmbedding(ctx, modelName)
	case "multimodal":
		return fmt.Errorf("multimodal not supported")
	default:
		return fmt.Errorf("invalid scenario")
	}
}

func sanitizeRuntime(runtime *domain.ModelRuntime) *domain.ModelRuntime {
	if runtime == nil {
		return nil
	}
	clone := *runtime
	clone.APIKey = ""
	return &clone
}

func isValidScenario(scenario string) bool {
	switch scenario {
	case "chat", "embedding", "multimodal":
		return true
	default:
		return false
	}
}

func defaultScenarioName(scenario string) string {
	switch scenario {
	case "chat":
		return "Chat"
	case "embedding":
		return "Embedding"
	case "multimodal":
		return "Multimodal"
	default:
		return "Model"
	}
}
