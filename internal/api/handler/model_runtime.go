package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/domain"
	"zeus/internal/service"
)

type ModelRuntimeHandler struct {
	runtimeSvc service.ModelRuntimeService
}

func NewModelRuntimeHandler(runtimeSvc service.ModelRuntimeService) *ModelRuntimeHandler {
	return &ModelRuntimeHandler{runtimeSvc: runtimeSvc}
}

// ListRuntimes
// @route GET /api/model-runtimes
func (h *ModelRuntimeHandler) ListRuntimes(c *gin.Context) {
	runtimes, err := h.runtimeSvc.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "LIST_MODEL_RUNTIMES_FAILED", Message: err.Error()})
		return
	}
	items := make([]types.ModelRuntimeDTO, 0, len(runtimes))
	for _, runtime := range runtimes {
		items = append(items, mapRuntimeDTO(runtime))
	}
	c.JSON(http.StatusOK, types.ModelRuntimeListResponse{Code: "OK", Message: "success", Data: items})
}

// UpsertRuntime
// @route POST /api/model-runtimes
func (h *ModelRuntimeHandler) UpsertRuntime(c *gin.Context) {
	var req types.ModelRuntimeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: err.Error()})
		return
	}
	params, err := parseRawJSONMap(req.Parameters)
	if err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_PARAMETERS", Message: err.Error()})
		return
	}

	runtime, err := h.runtimeSvc.Upsert(c.Request.Context(), service.ModelRuntimeInput{
		Scenario:   strings.TrimSpace(req.Scenario),
		Name:       strings.TrimSpace(req.Name),
		BaseURL:    strings.TrimSpace(req.BaseURL),
		APIKey:     strings.TrimSpace(req.APIKey),
		ModelName:  strings.TrimSpace(req.ModelName),
		Parameters: params,
		IsActive:   req.IsActive,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "UPSERT_MODEL_RUNTIME_FAILED", Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, types.ModelRuntimeUpsertResponse{Code: "OK", Message: "success", Data: mapRuntimeDTO(runtime)})
}

// RefreshModels
// @route POST /api/model-runtimes/models:refresh
func (h *ModelRuntimeHandler) RefreshModels(c *gin.Context) {
	var req types.ModelRuntimeRefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: err.Error()})
		return
	}
	models, err := h.runtimeSvc.RefreshModels(
		c.Request.Context(),
		strings.TrimSpace(req.BaseURL),
		strings.TrimSpace(req.APIKey),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "REFRESH_MODEL_LIST_FAILED", Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, types.ModelRuntimeRefreshResponse{Code: "OK", Message: "success", Data: models})
}

// TestRuntime
// @route POST /api/model-runtimes/test
func (h *ModelRuntimeHandler) TestRuntime(c *gin.Context) {
	var req types.ModelRuntimeTestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: err.Error()})
		return
	}
	err := h.runtimeSvc.Test(c.Request.Context(), service.ModelRuntimeTestInput{
		Scenario:  strings.TrimSpace(req.Scenario),
		BaseURL:   strings.TrimSpace(req.BaseURL),
		APIKey:    strings.TrimSpace(req.APIKey),
		ModelName: strings.TrimSpace(req.ModelName),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "TEST_MODEL_RUNTIME_FAILED", Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, types.ModelRuntimeTestResponse{Code: "OK", Message: "success", Data: types.ModelRuntimeTestResult{Success: true}})
}

func mapRuntimeDTO(runtime *domain.ModelRuntime) types.ModelRuntimeDTO {
	if runtime == nil {
		return types.ModelRuntimeDTO{}
	}
	return types.ModelRuntimeDTO{
		ID:         runtime.ID,
		Scenario:   runtime.Scenario,
		Name:       runtime.Name,
		BaseURL:    runtime.BaseURL,
		ModelName:  runtime.ModelName,
		Parameters: runtime.Parameters,
		IsActive:   runtime.IsActive,
		CreatedAt:  formatTime(runtime.CreatedAt),
		UpdatedAt:  formatTime(runtime.UpdatedAt),
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
