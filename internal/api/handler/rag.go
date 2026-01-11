package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/service"
)

type RAGHandler struct {
	ragSvc     service.RAGService
	summarySvc service.DocumentSummaryService
	projectSvc service.ProjectService
}

func NewRAGHandler(
	ragSvc service.RAGService,
	summarySvc service.DocumentSummaryService,
	projectSvc service.ProjectService,
) *RAGHandler {
	return &RAGHandler{
		ragSvc:     ragSvc,
		summarySvc: summarySvc,
		projectSvc: projectSvc,
	}
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
// @route POST /api/projects/:project_key/rag/rebuild/documents/:doc_id
func (h *RAGHandler) RebuildDocument(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	docID := strings.TrimSpace(c.Param("doc_id"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_PROJECT_KEY", Message: "project_key is required"})
		return
	}
	if docID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_DOC_ID", Message: "doc_id is required"})
		return
	}
	if h.ragSvc == nil || h.projectSvc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "SERVICE_NOT_READY", Message: "rag service is required"})
		return
	}
	project, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "LOAD_PROJECT_FAILED", Message: err.Error()})
		return
	}
	report, err := h.ragSvc.RebuildDocument(c.Request.Context(), project.ID, docID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "RAG_REBUILD_DOC_FAILED", Message: err.Error()})
		return
	}

	withSummary, _ := strconv.ParseBool(strings.TrimSpace(c.Query("with_summary")))
	var summary interface{}
	if withSummary {
		if h.summarySvc == nil {
			c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "SERVICE_NOT_READY", Message: "summary service is required"})
			return
		}
		created, err := h.summarySvc.GenerateDocumentSummary(c.Request.Context(), project.ID, docID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "RAG_SUMMARY_FAILED", Message: err.Error()})
			return
		}
		summary = created
	}

	response := gin.H{
		"code":    "OK",
		"message": "rebuild done",
		"report":  report,
	}
	if summary != nil {
		response["summary"] = summary
	}
	c.JSON(http.StatusOK, response)
}
