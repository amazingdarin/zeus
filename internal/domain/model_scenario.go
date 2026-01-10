package domain

import "time"

type ModelScenarioConfig struct {
	ID         string                 `json:"id"`
	Scenario   string                 `json:"scenario"`
	ProviderID string                 `json:"provider_id"`
	ModelName  string                 `json:"model_name"`
	Parameters map[string]interface{} `json:"parameters"`
	IsActive   bool                   `json:"is_active"`
	CreatedAt  time.Time              `json:"created_at"`
	UpdatedAt  time.Time              `json:"updated_at"`
}
