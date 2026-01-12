package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/service"
)

type TaskHandler struct {
	taskSvc service.TaskService
}

func NewTaskHandler(taskSvc service.TaskService) *TaskHandler {
	return &TaskHandler{taskSvc: taskSvc}
}

// Get
// @route GET /api/tasks/:id
func (h *TaskHandler) Get(c *gin.Context) {
	taskID := strings.TrimSpace(c.Param("id"))
	if taskID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_TASK_ID",
			Message: "task id is required",
		})
		return
	}
	if h.taskSvc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "task service is required",
		})
		return
	}
	task, ok, err := h.taskSvc.Get(c.Request.Context(), taskID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "TASK_GET_FAILED",
			Message: err.Error(),
		})
		return
	}
	if !ok || task == nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{
			Code:    "TASK_NOT_FOUND",
			Message: "task not found",
		})
		return
	}
	response := types.GetTaskResponse{
		Code:    "OK",
		Message: "success",
		Data: types.TaskDTO{
			ID:           task.ID,
			Type:         task.Type,
			ProjectID:    task.ProjectID,
			Status:       string(task.Status),
			Attempts:     task.Attempts,
			MaxAttempts:  task.MaxAttempts,
			ScheduledAt:  formatTime(task.ScheduledAt),
			StartedAt:    formatTime(task.StartedAt),
			FinishedAt:   formatTime(task.FinishedAt),
			Result:       task.Result,
			ErrorMessage: task.ErrorMessage,
			CreatedAt:    formatTime(&task.CreatedAt),
			UpdatedAt:    formatTime(&task.UpdatedAt),
		},
	}
	c.JSON(http.StatusOK, response)
}

func formatTime(value *time.Time) string {
	if value == nil || value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}
