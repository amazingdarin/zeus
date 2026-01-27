package provider

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"zeus/internal/core/util"
	"zeus/internal/domain"
	"zeus/internal/infra/modelruntime"
	"zeus/internal/repository"
	"zeus/internal/service"
)

type ConnectionService struct {
	repo           repository.ProviderConnectionRepository
	credentialRepo repository.ProviderCredentialRepository
	registry       *Registry
	clientFactory  modelruntime.ClientFactory
	keyManager     util.KeyManager
	clock          func() time.Time
}

func NewConnectionService(
	repos repository.Repository,
	registry *Registry,
	clientFactory modelruntime.ClientFactory,
	keyManager util.KeyManager,
) *ConnectionService {
	if clientFactory == nil {
		clientFactory = modelruntime.DefaultClientFactory
	}
	return &ConnectionService{
		repo:           repos.ProviderConnection,
		credentialRepo: repos.ProviderCredential,
		registry:       registry,
		clientFactory:  clientFactory,
		keyManager:     keyManager,
		clock:          time.Now,
	}
}

func (s *ConnectionService) Upsert(ctx context.Context, input service.ProviderConnectionInput) (*domain.ProviderConnection, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("provider connection service not initialized")
	}
	providerID := strings.TrimSpace(input.ProviderID)
	if providerID == "" {
		return nil, fmt.Errorf("provider id is required")
	}
	modelName := strings.TrimSpace(input.ModelName)
	credentialID := strings.TrimSpace(input.CredentialID)
	if credentialID == "" {
		return nil, fmt.Errorf("credential id is required")
	}
	if s.registry == nil {
		return nil, fmt.Errorf("provider registry is required")
	}
	provider, err := s.registry.Get(ctx, providerID)
	if err != nil {
		return nil, err
	}
	baseURL := strings.TrimSpace(input.BaseURL)
	if baseURL == "" {
		baseURL = strings.TrimSpace(provider.DefaultBaseURL)
	}
	now := s.clock()
	id := strings.TrimSpace(input.ID)
	if id == "" {
		connection := &domain.ProviderConnection{
			ID:           uuid.NewString(),
			ProviderID:   providerID,
			DisplayName:  strings.TrimSpace(input.DisplayName),
			BaseURL:      baseURL,
			ModelName:    modelName,
			CredentialID: credentialID,
			Status:       domain.ProviderConnectionActive,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if connection.DisplayName == "" {
			connection.DisplayName = connection.ProviderID + "-" + connection.ID
		}
		if err := s.repo.Insert(ctx, connection); err != nil {
			return nil, err
		}
		return connection, nil
	}
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, fmt.Errorf("connection not found")
	}
	existing.ProviderID = providerID
	existing.ModelName = modelName
	existing.BaseURL = baseURL
	existing.CredentialID = credentialID
	existing.UpdatedAt = now
	if strings.TrimSpace(input.DisplayName) != "" {
		existing.DisplayName = strings.TrimSpace(input.DisplayName)
	}
	if err := s.repo.Update(ctx, existing); err != nil {
		return nil, err
	}
	return existing, nil
}

func (s *ConnectionService) List(ctx context.Context) ([]*domain.ProviderConnection, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("provider connection service not initialized")
	}
	return s.repo.List(ctx)
}

func (s *ConnectionService) Test(ctx context.Context, input service.ProviderTestInput) error {
	if s == nil || s.repo == nil || s.credentialRepo == nil || s.keyManager == nil {
		return fmt.Errorf("provider connection service not initialized")
	}
	connectionID := strings.TrimSpace(input.ConnectionID)
	if connectionID == "" {
		return fmt.Errorf("connection id is required")
	}
	conn, err := s.repo.FindByID(ctx, connectionID)
	if err != nil {
		return err
	}
	if conn == nil {
		return fmt.Errorf("connection not found")
	}
	credential, err := s.credentialRepo.FindByID(ctx, strings.TrimSpace(conn.CredentialID))
	if err != nil {
		return err
	}
	if credential == nil {
		return fmt.Errorf("credential not found")
	}
	plaintext, err := util.DecryptEnvelope(util.Envelope{
		Ciphertext:   credential.Ciphertext,
		Nonce:        credential.Nonce,
		EncryptedKey: credential.EncryptedKey,
		KeyID:        credential.KeyID,
		KeyVersion:   credential.KeyVersion,
	}, s.keyManager)
	if err != nil {
		return s.updateStatus(ctx, conn, domain.ProviderConnectionInvalid, err)
	}
	client := s.clientFactory(conn.BaseURL, strings.TrimSpace(string(plaintext)))
	modelName := strings.TrimSpace(conn.ModelName)
	if modelName == "" {
		return s.updateStatus(ctx, conn, domain.ProviderConnectionInvalid, fmt.Errorf("model_name is required"))
	}
	scenario := strings.TrimSpace(input.Scenario)
	if scenario == "" {
		scenario = "chat"
	}
	if scenario == "chat" {
		if err := client.TestChat(ctx, modelName); err != nil {
			return s.updateStatus(ctx, conn, domain.ProviderConnectionInvalid, err)
		}
		return s.updateStatus(ctx, conn, domain.ProviderConnectionActive, nil)
	}
	if scenario == "embedding" {
		if err := client.TestEmbedding(ctx, modelName); err != nil {
			return s.updateStatus(ctx, conn, domain.ProviderConnectionInvalid, err)
		}
		return s.updateStatus(ctx, conn, domain.ProviderConnectionActive, nil)
	}
	return fmt.Errorf("invalid scenario")
}

func (s *ConnectionService) updateStatus(ctx context.Context, conn *domain.ProviderConnection, status domain.ProviderConnectionStatus, err error) error {
	if conn == nil {
		if err != nil {
			return err
		}
		return nil
	}
	now := s.clock()
	conn.Status = status
	conn.LastUsedAt = &now
	conn.UpdatedAt = now
	if err != nil {
		conn.LastError = err.Error()
	} else {
		conn.LastError = ""
	}
	if updateErr := s.repo.Update(ctx, conn); updateErr != nil {
		return updateErr
	}
	return err
}

func (s *ConnectionService) ListModels(ctx context.Context, connectionID string) ([]string, error) {
	if s == nil {
		return nil, fmt.Errorf("provider connection service not initialized")
	}
	modelsSvc := NewConnectionModelsService(
		repository.Repository{
			ProviderConnection: s.repo,
			ProviderCredential: s.credentialRepo,
		},
		s.clientFactory,
		s.keyManager,
	)
	return modelsSvc.ListModels(ctx, connectionID)
}

var _ service.ProviderConnectionService = (*ConnectionService)(nil)
