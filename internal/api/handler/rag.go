package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/service"
)

type RAGHandler struct {
	ragSvc service.RAGService
}

func NewRAGHandler(ragSvc service.RAGService) *RAGHandler {
	return &RAGHandler{ragSvc: ragSvc}
}

// RebuildProject
// @route POST /api/rag/rebuild/project/:project_id
func (h *RAGHandler) RebuildProject(c *gin.Context) {
	projectID := strings.TrimSpace(c.Param("project_id"))
	if projectID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_PROJECT_ID", Message: "project_id is required"})
		return
	}
	report, err := h.ragSvc.RebuildProject(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "RAG_REBUILD_PROJECT_FAILED", Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, report)
}

// RebuildDocument
// @route POST /api/rag/rebuild/document/:doc_id
func (h *RAGHandler) RebuildDocument(c *gin.Context) {
	projectID := strings.TrimSpace(c.Query("project_id"))
	docID := strings.TrimSpace(c.Param("doc_id"))
	if projectID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_PROJECT_ID", Message: "project_id is required"})
		return
	}
	if docID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_DOC_ID", Message: "doc_id is required"})
		return
	}
	report, err := h.ragSvc.RebuildDocument(c.Request.Context(), projectID, docID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "RAG_REBUILD_DOC_FAILED", Message: err.Error()})
		return
	}
	c.JSON(http.StatusOK, report)
}
