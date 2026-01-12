package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/domain"
	"zeus/internal/service"
)

type RAGHandler struct {
	ragSvc     service.RAGService
	summarySvc service.DocumentSummaryService
	projectSvc service.ProjectService
	taskSvc    service.TaskService
}

func NewRAGHandler(
	ragSvc service.RAGService,
	summarySvc service.DocumentSummaryService,
	projectSvc service.ProjectService,
	taskSvc service.TaskService,
) *RAGHandler {
	return &RAGHandler{
		ragSvc:     ragSvc,
		summarySvc: summarySvc,
		projectSvc: projectSvc,
		taskSvc:    taskSvc,
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
	if h.taskSvc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "task service is required",
		})
		return
	}
	var req struct {
		WithSummary    *bool  `json:"with_summary"`
		CallbackURL    string `json:"callback_url"`
		CallbackSecret string `json:"callback_secret"`
	}
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "INVALID_REQUEST",
			Message: err.Error(),
		})
		return
	}
	withSummary := parseWithSummary(c, req.WithSummary)
	task, err := h.taskSvc.Create(c.Request.Context(), service.TaskInput{
		Type:           domain.TaskTypeRAGRebuildProject,
		ProjectID:      projectID,
		Payload:        map[string]interface{}{"with_summary": withSummary},
		MaxAttempts:    3,
		CallbackURL:    req.CallbackURL,
		CallbackSecret: req.CallbackSecret,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "TASK_CREATE_FAILED",
			Message: err.Error(),
		})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{
		"code":    "OK",
		"message": "task created",
		"data": gin.H{
			"task_id": task.ID,
			"status":  task.Status,
		},
	})
}

// RebuildProjectByKey
// @route POST /api/projects/:project_key/rag/rebuild
func (h *RAGHandler) RebuildProjectByKey(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	if h.ragSvc == nil || h.projectSvc == nil || h.taskSvc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "rag service is required",
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
	var req struct {
		WithSummary    *bool  `json:"with_summary"`
		CallbackURL    string `json:"callback_url"`
		CallbackSecret string `json:"callback_secret"`
	}
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "INVALID_REQUEST",
			Message: err.Error(),
		})
		return
	}
	withSummary := parseWithSummary(c, req.WithSummary)
	task, err := h.taskSvc.Create(c.Request.Context(), service.TaskInput{
		Type:           domain.TaskTypeRAGRebuildProject,
		ProjectID:      project.ID,
		Payload:        map[string]interface{}{"with_summary": withSummary},
		MaxAttempts:    3,
		CallbackURL:    req.CallbackURL,
		CallbackSecret: req.CallbackSecret,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "TASK_CREATE_FAILED",
			Message: err.Error(),
		})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{
		"code":    "OK",
		"message": "task created",
		"data": gin.H{
			"task_id": task.ID,
			"status":  task.Status,
		},
	})
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

func parseWithSummary(c *gin.Context, bodyValue *bool) bool {
	queryValue := strings.TrimSpace(c.Query("with_summary"))
	if queryValue != "" {
		withSummary, _ := strconv.ParseBool(queryValue)
		return withSummary
	}
	if bodyValue != nil {
		return *bodyValue
	}
	return false
}
