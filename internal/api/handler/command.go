package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/service"
	"zeus/internal/service/chatstream"
)

type CommandHandler struct {
	router     chatstream.SlashRouter
	projectSvc service.ProjectService
}

type CommandRequest struct {
	Input string `json:"input"`
}

type CommandResponse struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Data    CommandResultData `json:"data"`
}

type CommandResultData struct {
	Command   string                    `json:"command"`
	Mode      string                    `json:"mode"`
	Message   string                    `json:"message"`
	Artifacts []chatstream.ChatArtifact `json:"artifacts,omitempty"`
}

func NewCommandHandler(
	router chatstream.SlashRouter,
	projectSvc service.ProjectService,
) *CommandHandler {
	return &CommandHandler{
		router:     router,
		projectSvc: projectSvc,
	}
}

// Execute
// @route POST /api/projects/:project_key/commands
func (h *CommandHandler) Execute(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.SimpleResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	if h.router == nil || h.projectSvc == nil {
		c.JSON(http.StatusInternalServerError, types.SimpleResponse{
			Code:    "COMMAND_HANDLER_NOT_READY",
			Message: "command handler is not ready",
		})
		return
	}
	var req CommandRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.SimpleResponse{
			Code:    "INVALID_REQUEST",
			Message: "invalid request body",
		})
		return
	}
	input := strings.TrimSpace(req.Input)
	if input == "" {
		c.JSON(http.StatusBadRequest, types.SimpleResponse{
			Code:    "MISSING_INPUT",
			Message: "input is required",
		})
		return
	}
	project, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.SimpleResponse{
			Code:    "LOAD_PROJECT_FAILED",
			Message: err.Error(),
		})
		return
	}
	result, handled, err := h.router.Handle(c.Request.Context(), chatstream.SlashRequest{
		ProjectID:  project.ID,
		ProjectKey: projectKey,
		Input:      input,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.SimpleResponse{
			Code:    "COMMAND_FAILED",
			Message: err.Error(),
		})
		return
	}
	if !handled {
		c.JSON(http.StatusNotFound, types.SimpleResponse{
			Code:    "UNKNOWN_COMMAND",
			Message: "unknown command",
		})
		return
	}
	message := strings.TrimSpace(result.Message)
	if message == "" {
		message = strings.TrimSpace(result.ExpandedPrompt)
	}
	c.JSON(http.StatusOK, CommandResponse{
		Code:    "OK",
		Message: "success",
		Data: CommandResultData{
			Command:   result.Command,
			Mode:      string(result.Mode),
			Message:   message,
			Artifacts: result.Artifacts,
		},
	})
}
