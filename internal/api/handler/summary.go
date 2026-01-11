package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/service"
)

type DocumentSummaryHandler struct {
	summarySvc service.DocumentSummaryService
	projectSvc service.ProjectService
}

func NewDocumentSummaryHandler(
	summarySvc service.DocumentSummaryService,
	projectSvc service.ProjectService,
) *DocumentSummaryHandler {
	return &DocumentSummaryHandler{
		summarySvc: summarySvc,
		projectSvc: projectSvc,
	}
}

// Get
// @route GET /api/projects/:project_key/documents/:doc_id/summary
func (h *DocumentSummaryHandler) Get(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	docID := strings.TrimSpace(c.Param("doc_id"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	if docID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_DOC_ID",
			Message: "doc_id is required",
		})
		return
	}
	if h.summarySvc == nil || h.projectSvc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "summary service is required",
		})
		return
	}
	project, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "LOAD_PROJECT_FAILED",
			Message: err.Error(),
		})
		return
	}
	summary, ok, err := h.summarySvc.GetDocumentSummary(c.Request.Context(), project.ID, docID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SUMMARY_GET_FAILED",
			Message: err.Error(),
		})
		return
	}
	if !ok || summary == nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{
			Code:    "SUMMARY_NOT_FOUND",
			Message: "summary not found",
		})
		return
	}
	response := types.GetDocumentSummaryResponse{
		Code:    "OK",
		Message: "success",
		Data: types.DocumentSummaryDTO{
			ID:          summary.ID,
			ProjectID:   summary.ProjectID,
			DocID:       summary.DocID,
			SummaryText: summary.SummaryText,
			ContentHash: summary.ContentHash,
			ModelRef:    summary.ModelRef,
			CreatedAt:   formatTime(summary.CreatedAt),
			UpdatedAt:   formatTime(summary.UpdatedAt),
		},
	}
	c.JSON(http.StatusOK, response)
}
