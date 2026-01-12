package handler

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"zeus/internal/api/types"
	"zeus/internal/infra/session"
	"zeus/internal/service"
	"zeus/internal/service/chatrun"
)

type ChatRunHandler struct {
	registry   chatrun.RunRegistry
	projectSvc service.ProjectService
}

func NewChatRunHandler(registry chatrun.RunRegistry, projectSvc service.ProjectService) *ChatRunHandler {
	return &ChatRunHandler{registry: registry, projectSvc: projectSvc}
}

// Create
// @route POST /api/projects/:project_key/chat/runs
func (h *ChatRunHandler) Create(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.CreateChatRunResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	if h.registry == nil || h.projectSvc == nil {
		c.JSON(http.StatusInternalServerError, types.CreateChatRunResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "chat run service is required",
		})
		return
	}
	project, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.CreateChatRunResponse{
			Code:    "LOAD_PROJECT_FAILED",
			Message: err.Error(),
		})
		return
	}
	var req types.CreateChatRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.CreateChatRunResponse{
			Code:    "INVALID_REQUEST",
			Message: err.Error(),
		})
		return
	}
	message := strings.TrimSpace(req.Message)
	if message == "" {
		c.JSON(http.StatusBadRequest, types.CreateChatRunResponse{
			Code:    "INVALID_MESSAGE",
			Message: "message is required",
		})
		return
	}
	sessionID := strings.TrimSpace(req.SessionID)
	if sessionID == "" {
		sessionInfo, _ := session.FromContext(c.Request.Context())
		sessionID = strings.TrimSpace(sessionInfo.ID)
	}

	runCtx, cancel := context.WithCancel(context.Background())
	now := time.Now()
	run := &chatrun.ChatRun{
		RunID:     uuid.NewString(),
		ProjectID: project.ID,
		SessionID: sessionID,
		Message:   message,
		Status:    chatrun.StatusPending,
		Context:   runCtx,
		Cancel:    cancel,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := h.registry.Create(run); err != nil {
		c.JSON(http.StatusInternalServerError, types.CreateChatRunResponse{
			Code:    "CREATE_CHAT_RUN_FAILED",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, types.CreateChatRunResponse{
		Code:    "OK",
		Message: "success",
		Data: struct {
			RunID string `json:"run_id"`
		}{
			RunID: run.RunID,
		},
	})
}
