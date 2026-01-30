package types

type ProviderDTO struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	AuthType     string   `json:"auth_type"`
	Capabilities []string `json:"capabilities"`
}

type ProviderListResponse struct {
	Code    string        `json:"code"`
	Message string        `json:"message"`
	Data    []ProviderDTO `json:"data"`
}

type ProviderConnectionRequest struct {
	ID           string `json:"id"`
	ProviderID   string `json:"provider_id"`
	DisplayName  string `json:"display_name"`
	BaseURL      string `json:"base_url"`
	ModelName    string `json:"model_name"`
	CredentialID string `json:"credential_id"`
}

type ProviderConnectionModelsResponse struct {
	Code    string   `json:"code"`
	Message string   `json:"message"`
	Data    []string `json:"data"`
}

type ProviderConnectionDTO struct {
	ID           string `json:"id"`
	ProviderID   string `json:"provider_id"`
	DisplayName  string `json:"display_name"`
	BaseURL      string `json:"base_url"`
	ModelName    string `json:"model_name"`
	CredentialID string `json:"credential_id"`
	Status       string `json:"status"`
	LastError    string `json:"last_error"`
	LastUsedAt   string `json:"last_used_at"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

type ProviderConnectionListResponse struct {
	Code    string                  `json:"code"`
	Message string                  `json:"message"`
	Data    []ProviderConnectionDTO `json:"data"`
}

type ProviderConnectionUpsertResponse struct {
	Code    string                `json:"code"`
	Message string                `json:"message"`
	Data    ProviderConnectionDTO `json:"data"`
}

type ProviderAPIAuthRequest struct {
	ProviderID string `json:"provider_id"`
	APIKey     string `json:"api_key"`
	ScopeType  string `json:"scope_type"`
	ScopeID    string `json:"scope_id"`
}

type ProviderDeviceStartRequest struct {
	ProviderID string `json:"provider_id"`
	ScopeType  string `json:"scope_type"`
	ScopeID    string `json:"scope_id"`
}

type ProviderDevicePollRequest struct {
	ProviderID string `json:"provider_id"`
	DeviceCode string `json:"device_code"`
	ScopeType  string `json:"scope_type"`
	ScopeID    string `json:"scope_id"`
}

type ProviderDevicePollErrorDTO struct {
	Status      string `json:"status"`
	Description string `json:"description"`
}

type ProviderDevicePollErrorResponse struct {
	Code    string                     `json:"code"`
	Message string                     `json:"message"`
	Data    ProviderDevicePollErrorDTO `json:"data"`
}

type ProviderCredentialDTO struct {
	ID         string `json:"id"`
	ProviderID string `json:"provider_id"`
	Type       string `json:"type"`
	ExpiresAt  string `json:"expires_at"`
}

type ProviderCredentialResponse struct {
	Code    string                `json:"code"`
	Message string                `json:"message"`
	Data    ProviderCredentialDTO `json:"data"`
}

type ProviderDeviceCodeDTO struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	Interval        int    `json:"interval"`
	ExpiresAt       string `json:"expires_at"`
}

type ProviderDeviceCodeResponse struct {
	Code    string                `json:"code"`
	Message string                `json:"message"`
	Data    ProviderDeviceCodeDTO `json:"data"`
}

type ProviderTestRequest struct {
	ConnectionID string `json:"connection_id"`
	Scenario     string `json:"scenario"`
}

type ProviderTestResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Data    struct {
		Success bool `json:"success"`
	} `json:"data"`
}
