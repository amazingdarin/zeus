package provider

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"zeus/internal/domain"
	"zeus/internal/infra/provider"
	"zeus/internal/repository"
	"zeus/internal/service"
	"zeus/internal/util"
)

type CredentialService struct {
	repo       repository.ProviderCredentialRepository
	keyManager util.KeyManager
	copilot    *provider.CopilotDeviceClient
	clock      func() time.Time
}

func NewCredentialService(repo repository.ProviderCredentialRepository, keyManager util.KeyManager, copilot *provider.CopilotDeviceClient) *CredentialService {
	return &CredentialService{repo: repo, keyManager: keyManager, copilot: copilot, clock: time.Now}
}

func (s *CredentialService) StoreAPIKey(ctx context.Context, input service.ProviderAuthInput) (*domain.ProviderCredential, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("provider credential service not initialized")
	}
	providerID := strings.TrimSpace(input.ProviderID)
	if providerID == "" {
		return nil, fmt.Errorf("provider id is required")
	}
	apiKey := strings.TrimSpace(input.APIKey)
	if apiKey == "" {
		return nil, fmt.Errorf("api key is required")
	}
	payload := []byte(apiKey)
	env, err := util.EncryptEnvelope(payload, s.keyManager)
	if err != nil {
		return nil, fmt.Errorf("encrypt credential: %w", err)
	}
	now := s.clock()
	credential := &domain.ProviderCredential{
		ID:           uuid.NewString(),
		ProviderID:   providerID,
		ScopeType:    domain.ProviderCredentialScope(strings.TrimSpace(input.ScopeType)),
		ScopeID:      strings.TrimSpace(input.ScopeID),
		Type:         domain.ProviderCredentialAPI,
		Ciphertext:   env.Ciphertext,
		Nonce:        env.Nonce,
		EncryptedKey: env.EncryptedKey,
		KeyID:        env.KeyID,
		KeyVersion:   env.KeyVersion,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if credential.ScopeType == "" {
		credential.ScopeType = domain.ProviderCredentialScopeGlobal
	}
	if err := s.repo.Insert(ctx, credential); err != nil {
		return nil, err
	}
	return credential, nil
}

func (s *CredentialService) StartDeviceCode(ctx context.Context, input service.ProviderDeviceStart) (*domain.ProviderDeviceCode, error) {
	if s == nil || s.copilot == nil {
		return nil, fmt.Errorf("provider credential service not initialized")
	}
	providerID := strings.TrimSpace(input.ProviderID)
	if providerID == "" {
		return nil, fmt.Errorf("provider id is required")
	}
	if providerID != "copilot" {
		return nil, fmt.Errorf("device code only supported for copilot")
	}
	resp, err := s.copilot.Start(ctx)
	if err != nil {
		return nil, err
	}
	expiresAt := s.clock().Add(time.Duration(resp.ExpiresIn) * time.Second)
	if resp.ExpiresIn <= 0 {
		expiresAt = time.Time{}
	}
	return &domain.ProviderDeviceCode{
		DeviceCode:      resp.DeviceCode,
		UserCode:        resp.UserCode,
		VerificationURI: resp.VerificationURI,
		Interval:        resp.Interval,
		ExpiresAt:       expiresAt,
	}, nil
}

func (s *CredentialService) PollDeviceCode(ctx context.Context, input service.ProviderDevicePoll) (*domain.ProviderCredential, error) {
	if s == nil || s.repo == nil || s.keyManager == nil || s.copilot == nil {
		return nil, fmt.Errorf("provider credential service not initialized")
	}
	providerID := strings.TrimSpace(input.ProviderID)
	if providerID == "" {
		return nil, fmt.Errorf("provider id is required")
	}
	if providerID != "copilot" {
		return nil, fmt.Errorf("device code only supported for copilot")
	}
	deviceCode := strings.TrimSpace(input.DeviceCode)
	if deviceCode == "" {
		return nil, fmt.Errorf("device code is required")
	}
	resp, err := s.copilot.Poll(ctx, deviceCode)
	if err != nil {
		return nil, err
	}
	if resp.Error != "" {
		return nil, domain.ProviderDevicePollError{
			Status:      domain.ProviderDevicePollStatus(resp.Error),
			Description: strings.TrimSpace(resp.ErrorDesc),
		}
	}
	if resp.AccessToken == "" {
		return nil, fmt.Errorf("access token missing")
	}
	env, err := util.EncryptEnvelope([]byte(resp.AccessToken), s.keyManager)
	if err != nil {
		return nil, fmt.Errorf("encrypt credential: %w", err)
	}
	expiresAt := s.clock().Add(time.Duration(resp.ExpiresIn) * time.Second)
	if resp.ExpiresIn <= 0 {
		expiresAt = time.Time{}
	}
	now := s.clock()
	credential := &domain.ProviderCredential{
		ID:           uuid.NewString(),
		ProviderID:   providerID,
		ScopeType:    domain.ProviderCredentialScope(strings.TrimSpace(input.ScopeType)),
		ScopeID:      strings.TrimSpace(input.ScopeID),
		Type:         domain.ProviderCredentialDevice,
		Ciphertext:   env.Ciphertext,
		Nonce:        env.Nonce,
		EncryptedKey: env.EncryptedKey,
		KeyID:        env.KeyID,
		KeyVersion:   env.KeyVersion,
		ExpiresAt:    &expiresAt,
		Scopes:       strings.TrimSpace(resp.Scope),
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if credential.ScopeType == "" {
		credential.ScopeType = domain.ProviderCredentialScopeGlobal
	}
	if err := s.repo.Insert(ctx, credential); err != nil {
		return nil, err
	}
	return credential, nil
}

var _ service.ProviderCredentialService = (*CredentialService)(nil)
