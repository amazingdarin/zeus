package provider

import (
	"context"
	"fmt"
	"strings"

	"zeus/internal/core/util"
	"zeus/internal/infra/modelruntime"
	"zeus/internal/repository"
)

var copilotDefaultModels = []string{
	"gpt-4o",
	"gpt-4o-mini",
}

type ConnectionModelsService struct {
	connectionRepo repository.ProviderConnectionRepository
	credentialRepo repository.ProviderCredentialRepository
	clientFactory  modelruntime.ClientFactory
	keyManager     util.KeyManager
}

func NewConnectionModelsService(
	repos repository.Repository,
	clientFactory modelruntime.ClientFactory,
	keyManager util.KeyManager,
) *ConnectionModelsService {
	if clientFactory == nil {
		clientFactory = modelruntime.DefaultClientFactory
	}
	return &ConnectionModelsService{
		connectionRepo: repos.ProviderConnection,
		credentialRepo: repos.ProviderCredential,
		clientFactory:  clientFactory,
		keyManager:     keyManager,
	}
}

func (s *ConnectionModelsService) ListModels(ctx context.Context, connectionID string) ([]string, error) {
	if s == nil || s.connectionRepo == nil || s.credentialRepo == nil || s.keyManager == nil {
		return nil, fmt.Errorf("provider models service not initialized")
	}
	connectionID = strings.TrimSpace(connectionID)
	if connectionID == "" {
		return nil, fmt.Errorf("connection id is required")
	}
	conn, err := s.connectionRepo.FindByID(ctx, connectionID)
	if err != nil {
		return nil, err
	}
	if conn == nil {
		return nil, fmt.Errorf("connection not found")
	}
	if strings.EqualFold(strings.TrimSpace(conn.ProviderID), "copilot") {
		return copilotDefaultModels, nil
	}
	credential, err := s.credentialRepo.FindByID(ctx, strings.TrimSpace(conn.CredentialID))
	if err != nil {
		return nil, err
	}
	if credential == nil {
		return nil, fmt.Errorf("credential not found")
	}
	plaintext, err := util.DecryptEnvelope(util.Envelope{
		Ciphertext:   credential.Ciphertext,
		Nonce:        credential.Nonce,
		EncryptedKey: credential.EncryptedKey,
		KeyID:        credential.KeyID,
		KeyVersion:   credential.KeyVersion,
	}, s.keyManager)
	if err != nil {
		return nil, fmt.Errorf("decrypt credential: %w", err)
	}
	client := s.clientFactory(conn.BaseURL, strings.TrimSpace(string(plaintext)))
	models, err := client.ListModels(ctx)
	if err != nil {
		return nil, err
	}
	return models, nil
}
