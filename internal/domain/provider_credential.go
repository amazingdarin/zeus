package domain

import "time"

type ProviderCredentialType string

type ProviderCredentialScope string

const (
	ProviderCredentialAPI    ProviderCredentialType = "api"
	ProviderCredentialDevice ProviderCredentialType = "device"
	ProviderCredentialOAuth  ProviderCredentialType = "oauth"
)

const (
	ProviderCredentialScopeGlobal  ProviderCredentialScope = "global"
	ProviderCredentialScopeProject ProviderCredentialScope = "project"
	ProviderCredentialScopeUser    ProviderCredentialScope = "user"
)

type ProviderCredential struct {
	ID           string
	ProviderID   string
	ScopeType    ProviderCredentialScope
	ScopeID      string
	Type         ProviderCredentialType
	Ciphertext   string
	Nonce        string
	EncryptedKey string
	KeyID        string
	KeyVersion   int
	ExpiresAt    *time.Time
	Scopes       string
	Metadata     map[string]interface{}
	CreatedAt    time.Time
	UpdatedAt    time.Time
	CreatedBy    string
	UpdatedBy    string
	LastUsedAt   *time.Time
	LastUsedBy   string
}
