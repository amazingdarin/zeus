package model

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"zeus/internal/domain"
	"zeus/internal/infra/modelprovider"
	"zeus/internal/repository"
	"zeus/internal/service"
	"zeus/internal/util"
)

type ProviderService struct {
	repo           repository.ModelProviderRepository
	adapterFactory modelprovider.AdapterFactory
	encryptionKey  string
	now            func() time.Time
}

func NewProviderService(
	repo repository.ModelProviderRepository,
	adapterFactory modelprovider.AdapterFactory,
	encryptionKey string,
) *ProviderService {
	if adapterFactory == nil {
		adapterFactory = modelprovider.DefaultAdapterFactory
	}
	return &ProviderService{
		repo:           repo,
		adapterFactory: adapterFactory,
		encryptionKey:  strings.TrimSpace(encryptionKey),
		now:            time.Now,
	}
}

func (s *ProviderService) Create(
	ctx context.Context,
	input service.ModelProviderCreateInput,
) (*domain.ModelProvider, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("provider service not initialized")
	}
	name := strings.TrimSpace(input.Name)
	providerType := strings.TrimSpace(input.Type)
	accessKey := strings.TrimSpace(input.AccessKey)
	if name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if providerType == "" {
		return nil, fmt.Errorf("type is required")
	}
	if accessKey == "" {
		return nil, fmt.Errorf("access key is required")
	}

	encrypted, err := util.EncryptString(accessKey, s.encryptionKey)
	if err != nil {
		return nil, fmt.Errorf("encrypt access key: %w", err)
	}

	now := s.now()
	provider := &domain.ModelProvider{
		ID:          uuid.NewString(),
		Name:        name,
		Type:        providerType,
		BaseURL:     strings.TrimSpace(input.BaseURL),
		AccessKey:   encrypted,
		ExtraConfig: input.ExtraConfig,
		IsEnabled:   input.IsEnabled,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.repo.Insert(ctx, provider); err != nil {
		return nil, err
	}
	return sanitizeProvider(provider), nil
}

func (s *ProviderService) List(ctx context.Context) ([]*domain.ModelProvider, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("provider service not initialized")
	}
	providers, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range providers {
		providers[i] = sanitizeProvider(providers[i])
	}
	return providers, nil
}

func (s *ProviderService) ListModels(ctx context.Context, id string) ([]service.ModelInfo, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("provider service not initialized")
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("id is required")
	}
	provider, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if provider == nil {
		return nil, fmt.Errorf("provider not found")
	}
	if !provider.IsEnabled {
		return nil, fmt.Errorf("provider is disabled")
	}
	decrypted, err := util.DecryptString(provider.AccessKey, s.encryptionKey)
	if err != nil {
		return nil, fmt.Errorf("decrypt access key: %w", err)
	}

	clone := *provider
	clone.AccessKey = decrypted
	adapter, err := s.adapterFactory(&clone)
	if err != nil {
		return nil, err
	}
	models, err := adapter.ListModels(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]service.ModelInfo, 0, len(models))
	for _, model := range models {
		items = append(items, service.ModelInfo{ID: model.ID, Name: model.Name})
	}
	return items, nil
}

func sanitizeProvider(provider *domain.ModelProvider) *domain.ModelProvider {
	if provider == nil {
		return nil
	}
	clone := *provider
	clone.AccessKey = ""
	return &clone
}
