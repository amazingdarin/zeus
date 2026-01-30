package types

import "encoding/json"

type ModelRuntimeRequest struct {
	Scenario             string          `json:"scenario"`
	Name                 string          `json:"name"`
	BaseURL              string          `json:"base_url"`
	APIKey               string          `json:"api_key"`
	ModelName            string          `json:"model_name"`
	Parameters           json.RawMessage `json:"parameters"`
	ProviderConnectionID string          `json:"provider_connection_id"`
	IsActive             bool            `json:"is_active"`
}

type ModelRuntimeDTO struct {
	ID                   string                 `json:"id"`
	Scenario             string                 `json:"scenario"`
	Name                 string                 `json:"name"`
	BaseURL              string                 `json:"base_url"`
	ModelName            string                 `json:"model_name"`
	Parameters           map[string]interface{} `json:"parameters"`
	ProviderConnectionID string                 `json:"provider_connection_id"`
	IsActive             bool                   `json:"is_active"`
	CreatedAt            string                 `json:"created_at"`
	UpdatedAt            string                 `json:"updated_at"`
}

type ModelRuntimeListResponse struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Data    []ModelRuntimeDTO `json:"data"`
}

type ModelRuntimeUpsertResponse struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Data    ModelRuntimeDTO `json:"data"`
}

type ModelRuntimeRefreshRequest struct {
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
}

type ModelRuntimeRefreshResponse struct {
	Code    string   `json:"code"`
	Message string   `json:"message"`
	Data    []string `json:"data"`
}

type ModelRuntimeTestRequest struct {
	Scenario  string `json:"scenario"`
	BaseURL   string `json:"base_url"`
	APIKey    string `json:"api_key"`
	ModelName string `json:"model_name"`
}

type ModelRuntimeTestResponse struct {
	Code    string                 `json:"code"`
	Message string                 `json:"message"`
	Data    ModelRuntimeTestResult `json:"data"`
}

type ModelRuntimeTestResult struct {
	Success bool `json:"success"`
}
