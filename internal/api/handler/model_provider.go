package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/domain"
	"zeus/internal/service"
)

type ModelProviderHandler struct {
	providerSvc service.ModelProviderService
	scenarioSvc service.ModelScenarioService
}

func NewModelProviderHandler(
	providerSvc service.ModelProviderService,
	scenarioSvc service.ModelScenarioService,
) *ModelProviderHandler {
	return &ModelProviderHandler{providerSvc: providerSvc, scenarioSvc: scenarioSvc}
}

// CreateProvider
// @route POST /api/model-providers
func (h *ModelProviderHandler) CreateProvider(c *gin.Context) {
	var req types.ModelProviderCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: err.Error()})
		return
	}

	extra, err := parseRawJSONMap(req.ExtraConfig)
	if err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_EXTRA_CONFIG", Message: err.Error()})
		return
	}

	provider, err := h.providerSvc.Create(c.Request.Context(), service.ModelProviderCreateInput{
		Name:        strings.TrimSpace(req.Name),
		Type:        strings.TrimSpace(req.Type),
		BaseURL:     strings.TrimSpace(req.BaseURL),
		AccessKey:   strings.TrimSpace(req.AccessKey),
		ExtraConfig: extra,
		IsEnabled:   req.IsEnabled,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "CREATE_MODEL_PROVIDER_FAILED", Message: err.Error()})
		return
	}

	c.JSON(http.StatusCreated, types.ModelProviderCreateResponse{
		Code:    "OK",
		Message: "success",
		Data:    mapProviderDTO(provider),
	})
}

// ListProviders
// @route GET /api/model-providers
func (h *ModelProviderHandler) ListProviders(c *gin.Context) {
	providers, err := h.providerSvc.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "LIST_MODEL_PROVIDERS_FAILED", Message: err.Error()})
		return
	}
	items := make([]types.ModelProviderDTO, 0, len(providers))
	for _, provider := range providers {
		items = append(items, mapProviderDTO(provider))
	}
	c.JSON(http.StatusOK, types.ModelProviderListResponse{Code: "OK", Message: "success", Data: items})
}

// ListProviderModels
// @route GET /api/model-providers/:id/models
func (h *ModelProviderHandler) ListProviderModels(c *gin.Context) {
	providerID := strings.TrimSpace(c.Param("id"))
	if providerID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_PROVIDER_ID", Message: "provider id is required"})
		return
	}
	models, err := h.providerSvc.ListModels(c.Request.Context(), providerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "LIST_PROVIDER_MODELS_FAILED", Message: err.Error()})
		return
	}
	items := make([]types.ModelInfoDTO, 0, len(models))
	for _, model := range models {
		items = append(items, types.ModelInfoDTO{ID: model.ID, Name: model.Name})
	}
	c.JSON(http.StatusOK, types.ModelProviderModelsResponse{Code: "OK", Message: "success", Data: items})
}

// ConfigureScenario
// @route POST /api/model-scenarios
func (h *ModelProviderHandler) ConfigureScenario(c *gin.Context) {
	var req types.ModelScenarioConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: err.Error()})
		return
	}
	params, err := parseRawJSONMap(req.Parameters)
	if err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_PARAMETERS", Message: err.Error()})
		return
	}
	config, err := h.scenarioSvc.Configure(c.Request.Context(), service.ModelScenarioConfigInput{
		Scenario:   strings.TrimSpace(req.Scenario),
		ProviderID: strings.TrimSpace(req.ProviderID),
		ModelName:  strings.TrimSpace(req.ModelName),
		Parameters: params,
		IsActive:   req.IsActive,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "CONFIGURE_MODEL_SCENARIO_FAILED", Message: err.Error()})
		return
	}
	c.JSON(http.StatusCreated, types.ModelScenarioCreateResponse{Code: "OK", Message: "success", Data: mapScenarioDTO(config)})
}

// ListScenarios
// @route GET /api/model-scenarios
func (h *ModelProviderHandler) ListScenarios(c *gin.Context) {
	configs, err := h.scenarioSvc.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "LIST_MODEL_SCENARIOS_FAILED", Message: err.Error()})
		return
	}
	items := make([]types.ModelScenarioDTO, 0, len(configs))
	for _, config := range configs {
		items = append(items, mapScenarioDTO(config))
	}
	c.JSON(http.StatusOK, types.ModelScenarioListResponse{Code: "OK", Message: "success", Data: items})
}

func mapProviderDTO(provider *domain.ModelProvider) types.ModelProviderDTO {
	if provider == nil {
		return types.ModelProviderDTO{}
	}
	return types.ModelProviderDTO{
		ID:          provider.ID,
		Name:        provider.Name,
		Type:        provider.Type,
		BaseURL:     provider.BaseURL,
		ExtraConfig: provider.ExtraConfig,
		IsEnabled:   provider.IsEnabled,
		CreatedAt:   formatTime(provider.CreatedAt),
		UpdatedAt:   formatTime(provider.UpdatedAt),
	}
}

func mapScenarioDTO(config *domain.ModelScenarioConfig) types.ModelScenarioDTO {
	if config == nil {
		return types.ModelScenarioDTO{}
	}
	return types.ModelScenarioDTO{
		ID:         config.ID,
		Scenario:   config.Scenario,
		ProviderID: config.ProviderID,
		ModelName:  config.ModelName,
		Parameters: config.Parameters,
		IsActive:   config.IsActive,
		CreatedAt:  formatTime(config.CreatedAt),
		UpdatedAt:  formatTime(config.UpdatedAt),
	}
}

func parseRawJSONMap(raw json.RawMessage) (map[string]interface{}, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("parse json: %w", err)
	}
	return payload, nil
}

func formatTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.Format(time.RFC3339)
}
