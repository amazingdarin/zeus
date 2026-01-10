package model

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/service"
)

type ScenarioService struct {
	repo         repository.ModelScenarioRepository
	providerRepo repository.ModelProviderRepository
	now          func() time.Time
}

func NewScenarioService(
	repo repository.ModelScenarioRepository,
	providerRepo repository.ModelProviderRepository,
) *ScenarioService {
	return &ScenarioService{
		repo:         repo,
		providerRepo: providerRepo,
		now:          time.Now,
	}
}

func (s *ScenarioService) Configure(
	ctx context.Context,
	input service.ModelScenarioConfigInput,
) (*domain.ModelScenarioConfig, error) {
	if s == nil || s.repo == nil || s.providerRepo == nil {
		return nil, fmt.Errorf("scenario service not initialized")
	}
	scenario := strings.TrimSpace(input.Scenario)
	providerID := strings.TrimSpace(input.ProviderID)
	modelName := strings.TrimSpace(input.ModelName)
	if scenario == "" {
		return nil, fmt.Errorf("scenario is required")
	}
	if providerID == "" {
		return nil, fmt.Errorf("provider_id is required")
	}
	if modelName == "" {
		return nil, fmt.Errorf("model_name is required")
	}

	provider, err := s.providerRepo.FindByID(ctx, providerID)
	if err != nil {
		return nil, fmt.Errorf("find provider: %w", err)
	}
	if provider == nil {
		return nil, fmt.Errorf("provider not found")
	}

	now := s.now()
	existing, err := s.repo.FindByScenario(ctx, scenario)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		config := &domain.ModelScenarioConfig{
			ID:         uuid.NewString(),
			Scenario:   scenario,
			ProviderID: providerID,
			ModelName:  modelName,
			Parameters: input.Parameters,
			IsActive:   input.IsActive,
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		if err := s.repo.Insert(ctx, config); err != nil {
			return nil, err
		}
		return config, nil
	}

	existing.ProviderID = providerID
	existing.ModelName = modelName
	existing.Parameters = input.Parameters
	existing.IsActive = input.IsActive
	existing.UpdatedAt = now
	if err := s.repo.Update(ctx, existing); err != nil {
		return nil, err
	}
	return existing, nil
}

func (s *ScenarioService) List(ctx context.Context) ([]*domain.ModelScenarioConfig, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("scenario service not initialized")
	}
	return s.repo.List(ctx)
}
