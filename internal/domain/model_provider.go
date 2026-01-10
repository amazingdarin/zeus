package domain

import "time"

type ModelProvider struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Type        string                 `json:"type"`
	BaseURL     string                 `json:"base_url"`
	AccessKey   string                 `json:"access_key"`
	ExtraConfig map[string]interface{} `json:"extra_config"`
	IsEnabled   bool                   `json:"is_enabled"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
}
