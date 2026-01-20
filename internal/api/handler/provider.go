package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/domain"
	"zeus/internal/service"
)

type ProviderHandler struct {
	registry      service.ProviderRegistry
	credentialSvc service.ProviderCredentialService
	connectionSvc service.ProviderConnectionService
}

func NewProviderHandler(registry service.ProviderRegistry, credentialSvc service.ProviderCredentialService, connectionSvc service.ProviderConnectionService) *ProviderHandler {
	return &ProviderHandler{registry: registry, credentialSvc: credentialSvc, connectionSvc: connectionSvc}
}

func (h *ProviderHandler) ListProviders(c *gin.Context) {
	providers, err := h.registry.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "LIST_PROVIDERS_FAILED", Message: err.Error()})
		return
	}
	items := make([]types.ProviderDTO, 0, len(providers))
	for _, provider := range providers {
		caps := make([]string, 0, len(provider.Capabilities))
		for _, cap := range provider.Capabilities {
			caps = append(caps, string(cap))
		}
		items = append(items, types.ProviderDTO{
			ID:           provider.ID,
			Name:         provider.Name,
			AuthType:     string(provider.AuthType),
			Capabilities: caps,
		})
	}
	c.JSON(http.StatusOK, types.ProviderListResponse{Code: "OK", Message: "success", Data: items})
}

func (h *ProviderHandler) ListConnections(c *gin.Context) {
	connections, err := h.connectionSvc.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "LIST_PROVIDER_CONNECTIONS_FAILED", Message: err.Error()})
		return
	}
	items := make([]types.ProviderConnectionDTO, 0, len(connections))
	for _, conn := range connections {
		items = append(items, mapProviderConnection(conn))
	}
	c.JSON(http.StatusOK, types.ProviderConnectionListResponse{Code: "OK", Message: "success", Data: items})
}

func (h *ProviderHandler) UpsertConnection(c *gin.Context) {
	var req types.ProviderConnectionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: err.Error()})
		return
	}
	conn, err := h.connectionSvc.Upsert(c.Request.Context(), service.ProviderConnectionInput{
		ID:           strings.TrimSpace(req.ID),
		ProviderID:   strings.TrimSpace(req.ProviderID),
		DisplayName:  strings.TrimSpace(req.DisplayName),
		BaseURL:      strings.TrimSpace(req.BaseURL),
		ModelName:    strings.TrimSpace(req.ModelName),
		CredentialID: strings.TrimSpace(req.CredentialID),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "UPSERT_PROVIDER_CONNECTION_FAILED", Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, types.ProviderConnectionUpsertResponse{Code: "OK", Message: "success", Data: mapProviderConnection(conn)})
}

func (h *ProviderHandler) StoreAPIKey(c *gin.Context) {
	providerID := strings.TrimSpace(c.Param("id"))
	var req types.ProviderAPIAuthRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: err.Error()})
		return
	}
	credential, err := h.credentialSvc.StoreAPIKey(c.Request.Context(), service.ProviderAuthInput{
		ProviderID: providerID,
		APIKey:     strings.TrimSpace(req.APIKey),
		ScopeType:  strings.TrimSpace(req.ScopeType),
		ScopeID:    strings.TrimSpace(req.ScopeID),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "STORE_PROVIDER_CREDENTIAL_FAILED", Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, types.ProviderCredentialResponse{Code: "OK", Message: "success", Data: mapProviderCredential(credential)})
}

func (h *ProviderHandler) StartDeviceCode(c *gin.Context) {
	providerID := strings.TrimSpace(c.Param("id"))
	var req types.ProviderDeviceStartRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: err.Error()})
		return
	}
	deviceCode, err := h.credentialSvc.StartDeviceCode(c.Request.Context(), service.ProviderDeviceStart{
		ProviderID: providerID,
		ScopeType:  strings.TrimSpace(req.ScopeType),
		ScopeID:    strings.TrimSpace(req.ScopeID),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "START_DEVICE_CODE_FAILED", Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, types.ProviderDeviceCodeResponse{Code: "OK", Message: "success", Data: mapProviderDeviceCode(deviceCode)})
}

func (h *ProviderHandler) PollDeviceCode(c *gin.Context) {
	providerID := strings.TrimSpace(c.Param("id"))
	var req types.ProviderDevicePollRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: err.Error()})
		return
	}
	credential, err := h.credentialSvc.PollDeviceCode(c.Request.Context(), service.ProviderDevicePoll{
		ProviderID: providerID,
		DeviceCode: strings.TrimSpace(req.DeviceCode),
		ScopeType:  strings.TrimSpace(req.ScopeType),
		ScopeID:    strings.TrimSpace(req.ScopeID),
	})
	if err != nil {
		if pollErr, ok := err.(domain.ProviderDevicePollError); ok {
			c.JSON(http.StatusAccepted, types.ProviderDevicePollErrorResponse{
				Code:    "DEVICE_POLL_PENDING",
				Message: pollErr.Error(),
				Data: types.ProviderDevicePollErrorDTO{
					Status:      string(pollErr.Status),
					Description: pollErr.Description,
				},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "POLL_DEVICE_CODE_FAILED", Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, types.ProviderCredentialResponse{Code: "OK", Message: "success", Data: mapProviderCredential(credential)})
}

func (h *ProviderHandler) TestProvider(c *gin.Context) {
	var req types.ProviderTestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: err.Error()})
		return
	}
	err := h.connectionSvc.Test(c.Request.Context(), service.ProviderTestInput{
		ConnectionID: strings.TrimSpace(req.ConnectionID),
		Scenario:     strings.TrimSpace(req.Scenario),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "TEST_PROVIDER_FAILED", Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, types.ProviderTestResponse{Code: "OK", Message: "success", Data: struct {
		Success bool `json:"success"`
	}{Success: true}})
}

func (h *ProviderHandler) ListConnectionModels(c *gin.Context) {
	connectionID := strings.TrimSpace(c.Param("id"))
	models, err := h.connectionSvc.ListModels(c.Request.Context(), connectionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "LIST_PROVIDER_MODELS_FAILED", Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, types.ProviderConnectionModelsResponse{Code: "OK", Message: "success", Data: models})
}

func mapProviderConnection(conn *domain.ProviderConnection) types.ProviderConnectionDTO {
	if conn == nil {
		return types.ProviderConnectionDTO{}
	}
	return types.ProviderConnectionDTO{
		ID:           conn.ID,
		ProviderID:   conn.ProviderID,
		DisplayName:  conn.DisplayName,
		BaseURL:      conn.BaseURL,
		ModelName:    conn.ModelName,
		CredentialID: conn.CredentialID,
		Status:       string(conn.Status),
		LastError:    conn.LastError,
		LastUsedAt:   formatTimePtr(conn.LastUsedAt),
		CreatedAt:    formatTime(conn.CreatedAt),
		UpdatedAt:    formatTime(conn.UpdatedAt),
	}
}

func mapProviderCredential(cred *domain.ProviderCredential) types.ProviderCredentialDTO {
	if cred == nil {
		return types.ProviderCredentialDTO{}
	}
	return types.ProviderCredentialDTO{
		ID:         cred.ID,
		ProviderID: cred.ProviderID,
		Type:       string(cred.Type),
		ExpiresAt:  formatTimePtr(cred.ExpiresAt),
	}
}

func mapProviderDeviceCode(code *domain.ProviderDeviceCode) types.ProviderDeviceCodeDTO {
	if code == nil {
		return types.ProviderDeviceCodeDTO{}
	}
	return types.ProviderDeviceCodeDTO{
		DeviceCode:      code.DeviceCode,
		UserCode:        code.UserCode,
		VerificationURI: code.VerificationURI,
		Interval:        code.Interval,
		ExpiresAt:       formatTime(code.ExpiresAt),
	}
}
