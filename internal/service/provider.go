package service

import (
	"context"

	"zeus/internal/domain"
)

type ProviderAuthInput struct {
	ProviderID string
	APIKey     string
	ScopeType  string
	ScopeID    string
}

type ProviderDeviceStart struct {
	ProviderID string
	ScopeType  string
	ScopeID    string
}

type ProviderDevicePoll struct {
	ProviderID string
	DeviceCode string
	ScopeType  string
	ScopeID    string
}

type ProviderConnectionInput struct {
	ID           string
	ProviderID   string
	DisplayName  string
	BaseURL      string
	ModelName    string
	CredentialID string
}

type ProviderTestInput struct {
	ConnectionID string
	Scenario     string
}

type ProviderRegistry interface {
	List(ctx context.Context) ([]domain.ProviderDefinition, error)
	Get(ctx context.Context, providerID string) (domain.ProviderDefinition, error)
}

type ProviderCredentialService interface {
	StoreAPIKey(ctx context.Context, input ProviderAuthInput) (*domain.ProviderCredential, error)
	StartDeviceCode(ctx context.Context, input ProviderDeviceStart) (*domain.ProviderDeviceCode, error)
	PollDeviceCode(ctx context.Context, input ProviderDevicePoll) (*domain.ProviderCredential, error)
}

type ProviderConnectionService interface {
	Upsert(ctx context.Context, input ProviderConnectionInput) (*domain.ProviderConnection, error)
	List(ctx context.Context) ([]*domain.ProviderConnection, error)
	Test(ctx context.Context, input ProviderTestInput) error
	ListModels(ctx context.Context, connectionID string) ([]string, error)
}
