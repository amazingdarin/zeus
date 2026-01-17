package domain

import "time"

// ModelRuntime represents a scenario-scoped runtime configuration.
// It is pure domain data without IO or vendor-specific logic.
type ModelRuntime struct {
	ID                   string                 `json:"id"`
	Scenario             string                 `json:"scenario"`
	Name                 string                 `json:"name"`
	BaseURL              string                 `json:"base_url"`
	APIKey               string                 `json:"api_key"`
	ModelName            string                 `json:"model_name"`
	Parameters           map[string]interface{} `json:"parameters"`
	ProviderConnectionID string                 `json:"provider_connection_id"`
	IsActive             bool                   `json:"is_active"`
	CreatedAt            time.Time              `json:"created_at"`
	UpdatedAt            time.Time              `json:"updated_at"`
}
