package domain

import "time"

type ProviderConnectionStatus string

const (
	ProviderConnectionActive  ProviderConnectionStatus = "active"
	ProviderConnectionInvalid ProviderConnectionStatus = "invalid"
	ProviderConnectionExpired ProviderConnectionStatus = "expired"
	ProviderConnectionRevoked ProviderConnectionStatus = "revoked"
)

type ProviderConnection struct {
	ID           string
	ProviderID   string
	DisplayName  string
	BaseURL      string
	ModelName    string
	CredentialID string
	Status       ProviderConnectionStatus
	LastError    string
	LastUsedAt   *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
	CreatedBy    string
	UpdatedBy    string
}
