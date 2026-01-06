package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/service"
	svcopenapi "zeus/internal/service/openapi"
)

type OpenAPIHandler struct {
	svc svcopenapi.IndexService
}

func NewOpenAPIHandler(svc svcopenapi.IndexService) *OpenAPIHandler {
	return &OpenAPIHandler{svc: svc}
}

// Index
// @route GET /api/projects/:project_key/openapi/index
func (h *OpenAPIHandler) Index(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	source := strings.TrimSpace(c.Query("source"))
	if source == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_SOURCE",
			Message: "source is required",
		})
		return
	}
	if h.svc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "openapi service is required",
		})
		return
	}

	index, err := h.svc.BuildIndex(c.Request.Context(), projectKey, source)
	if err != nil {
		status := http.StatusInternalServerError
		code := "OPENAPI_INDEX_FAILED"
		if errors.Is(err, service.ErrAssetNotFound) {
			status = http.StatusNotFound
			code = "ASSET_NOT_FOUND"
		}
		c.JSON(status, types.ErrorResponse{
			Code:    code,
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, types.OpenAPIIndexResponse{
		Code:    "OK",
		Message: "success",
		Data:    mapIndexDTO(index),
	})
}

func mapIndexDTO(index svcopenapi.Index) types.OpenAPIIndexDTO {
	tags := make([]types.OpenAPITagDTO, 0, len(index.Tags))
	for _, tag := range index.Tags {
		tags = append(tags, types.OpenAPITagDTO{
			Name:        tag.Name,
			Description: tag.Description,
		})
	}
	endpoints := make([]types.OpenAPIEndpointDTO, 0, len(index.Endpoints))
	for _, endpoint := range index.Endpoints {
		endpoints = append(endpoints, types.OpenAPIEndpointDTO{
			Path:        endpoint.Path,
			Method:      endpoint.Method,
			Summary:     endpoint.Summary,
			Tags:        endpoint.Tags,
			OperationID: endpoint.OperationID,
		})
	}
	return types.OpenAPIIndexDTO{
		Title:     index.Title,
		Version:   index.Version,
		Tags:      tags,
		Endpoints: endpoints,
	}
}
