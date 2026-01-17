package model

import (
	"context"
	"fmt"
	"strings"

	"zeus/internal/domain"
	"zeus/internal/infra/embedding"
	"zeus/internal/repository"
	"zeus/internal/util"
)

type RuntimeResolver struct {
	runtimeRepo    repository.ModelRuntimeRepository
	connectionRepo repository.ProviderConnectionRepository
	credentialRepo repository.ProviderCredentialRepository
	keyManager     util.KeyManager
	legacyKey      string
}

func NewRuntimeResolver(
	runtimeRepo repository.ModelRuntimeRepository,
	connectionRepo repository.ProviderConnectionRepository,
	credentialRepo repository.ProviderCredentialRepository,
	keyManager util.KeyManager,
	legacyKey string,
) *RuntimeResolver {
	return &RuntimeResolver{
		runtimeRepo:    runtimeRepo,
		connectionRepo: connectionRepo,
		credentialRepo: credentialRepo,
		keyManager:     keyManager,
		legacyKey:      strings.TrimSpace(legacyKey),
	}
}

func (r *RuntimeResolver) Resolve(ctx context.Context, scenario string) (embedding.ModelRuntime, error) {
	scenario = strings.TrimSpace(scenario)
	if scenario == "" {
		return embedding.ModelRuntime{}, fmt.Errorf("scenario is required")
	}
	runtime, err := r.runtimeRepo.FindByScenario(ctx, scenario)
	if err != nil {
		return embedding.ModelRuntime{}, err
	}
	if runtime == nil {
		return embedding.ModelRuntime{}, fmt.Errorf("runtime not found")
	}
	if !runtime.IsActive {
		return embedding.ModelRuntime{}, fmt.Errorf("runtime inactive")
	}

	connectionID := strings.TrimSpace(runtime.ProviderConnectionID)
	if connectionID != "" && r.connectionRepo != nil && r.credentialRepo != nil && r.keyManager != nil {
		return r.resolveConnection(ctx, runtime.ID, connectionID)
	}
	return r.resolveLegacy(runtime)
}

func (r *RuntimeResolver) resolveConnection(ctx context.Context, runtimeID string, connectionID string) (embedding.ModelRuntime, error) {
	if r.connectionRepo == nil || r.credentialRepo == nil || r.keyManager == nil {
		return embedding.ModelRuntime{}, fmt.Errorf("provider repositories not initialized")
	}
	connection, err := r.connectionRepo.FindByID(ctx, connectionID)
	if err != nil {
		return embedding.ModelRuntime{}, err
	}
	if connection == nil {
		return embedding.ModelRuntime{}, fmt.Errorf("connection not found")
	}
	credential, err := r.credentialRepo.FindByID(ctx, connection.CredentialID)
	if err != nil {
		return embedding.ModelRuntime{}, err
	}
	if credential == nil {
		return embedding.ModelRuntime{}, fmt.Errorf("credential not found")
	}
	plaintext, err := util.DecryptEnvelope(util.Envelope{
		Ciphertext:   credential.Ciphertext,
		Nonce:        credential.Nonce,
		EncryptedKey: credential.EncryptedKey,
		KeyID:        credential.KeyID,
		KeyVersion:   credential.KeyVersion,
	}, r.keyManager)
	if err != nil {
		return embedding.ModelRuntime{}, fmt.Errorf("decrypt credential: %w", err)
	}
	apiKey := strings.TrimSpace(string(plaintext))
	baseURL := strings.TrimSpace(connection.BaseURL)
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	return embedding.ModelRuntime{
		ID:        runtimeID,
		BaseURL:   baseURL,
		APIKey:    apiKey,
		ModelName: strings.TrimSpace(connection.ModelName),
	}, nil
}

func (r *RuntimeResolver) resolveLegacy(runtime *domain.ModelRuntime) (embedding.ModelRuntime, error) {
	apiKey := runtime.APIKey
	if strings.TrimSpace(apiKey) != "" {
		decoded, err := util.DecryptString(apiKey, r.legacyKey)
		if err != nil {
			return embedding.ModelRuntime{}, fmt.Errorf("decrypt api key: %w", err)
		}
		apiKey = decoded
	}
	return embedding.ModelRuntime{
		ID:        runtime.ID,
		BaseURL:   runtime.BaseURL,
		APIKey:    apiKey,
		ModelName: runtime.ModelName,
	}, nil
}

var _ embedding.ModelRuntimeResolver = (*RuntimeResolver)(nil)
