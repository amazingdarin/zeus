package types

import "encoding/json"

type ModelProviderCreateRequest struct {
	Name        string          `json:"name"`
	Type        string          `json:"type"`
	BaseURL     string          `json:"base_url"`
	AccessKey   string          `json:"access_key"`
	ExtraConfig json.RawMessage `json:"extra_config"`
	IsEnabled   bool            `json:"is_enabled"`
}

type ModelProviderDTO struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Type        string                 `json:"type"`
	BaseURL     string                 `json:"base_url"`
	ExtraConfig map[string]interface{} `json:"extra_config"`
	IsEnabled   bool                   `json:"is_enabled"`
	CreatedAt   string                 `json:"created_at"`
	UpdatedAt   string                 `json:"updated_at"`
}

type ModelProviderListResponse struct {
	Code    string             `json:"code"`
	Message string             `json:"message"`
	Data    []ModelProviderDTO `json:"data"`
}

type ModelProviderCreateResponse struct {
	Code    string           `json:"code"`
	Message string           `json:"message"`
	Data    ModelProviderDTO `json:"data"`
}

type ModelInfoDTO struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type ModelProviderModelsResponse struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Data    []ModelInfoDTO `json:"data"`
}

type ModelScenarioConfigRequest struct {
	Scenario   string          `json:"scenario"`
	ProviderID string          `json:"provider_id"`
	ModelName  string          `json:"model_name"`
	Parameters json.RawMessage `json:"parameters"`
	IsActive   bool            `json:"is_active"`
}

type ModelScenarioDTO struct {
	ID         string                 `json:"id"`
	Scenario   string                 `json:"scenario"`
	ProviderID string                 `json:"provider_id"`
	ModelName  string                 `json:"model_name"`
	Parameters map[string]interface{} `json:"parameters"`
	IsActive   bool                   `json:"is_active"`
	CreatedAt  string                 `json:"created_at"`
	UpdatedAt  string                 `json:"updated_at"`
}

type ModelScenarioListResponse struct {
	Code    string             `json:"code"`
	Message string             `json:"message"`
	Data    []ModelScenarioDTO `json:"data"`
}

type ModelScenarioCreateResponse struct {
	Code    string           `json:"code"`
	Message string           `json:"message"`
	Data    ModelScenarioDTO `json:"data"`
}
