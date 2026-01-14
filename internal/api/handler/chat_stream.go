package handler

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"

	"zeus/internal/api/types"
	"zeus/internal/service"
	"zeus/internal/service/chatrun"
	"zeus/internal/service/chatstream"
)

type ChatStreamHandler struct {
	registry   chatrun.RunRegistry
	streamer   ChatStreamRunner
	projectSvc service.ProjectService
}

type ChatStreamRunner interface {
	Run(
		ctx context.Context,
		run *chatrun.ChatRun,
		request chatstream.ChatRequest,
		emit func(chatstream.ChatEvent) error,
	) error
}

func NewChatStreamHandler(
	registry chatrun.RunRegistry,
	streamer ChatStreamRunner,
	projectSvc service.ProjectService,
) *ChatStreamHandler {
	return &ChatStreamHandler{
		registry:   registry,
		streamer:   streamer,
		projectSvc: projectSvc,
	}
}

// Stream
// @route GET /api/projects/:project_key/chat/runs/:run_id/stream
func (h *ChatStreamHandler) Stream(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.SimpleResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	if h.registry == nil || h.streamer == nil || h.projectSvc == nil {
		c.JSON(http.StatusInternalServerError, types.SimpleResponse{
			Code:    "CHAT_STREAM_HANDLER_MISSING",
			Message: "chat stream handler is not ready",
		})
		return
	}
	runID := strings.TrimSpace(c.Param("run_id"))
	if runID == "" {
		c.JSON(http.StatusBadRequest, types.SimpleResponse{
			Code:    "INVALID_REQUEST",
			Message: "run_id is required",
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
	run, ok := h.registry.Get(runID)
	if !ok || run == nil || strings.TrimSpace(run.ProjectID) != project.ID {
		c.JSON(http.StatusNotFound, types.SimpleResponse{
			Code:    "CHAT_RUN_NOT_FOUND",
			Message: "chat run not found",
		})
		return
	}

	PrepareSSE(c.Writer)
	c.Status(http.StatusOK)

	if err := h.registry.UpdateStatus(runID, chatrun.StatusRunning); err != nil {
		log.WithContext(c.Request.Context()).WithField("error", err).Warn("update chat run status failed")
	}

	mutex := &sync.Mutex{}
	writer := &lockedResponseWriter{ResponseWriter: c.Writer, mu: mutex}

	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		err := h.streamer.Run(ctx, run, chatstream.ChatRequest{
			ProjectID:  project.ID,
			ProjectKey: projectKey,
			Query:      strings.TrimSpace(run.Message),
		}, func(event chatstream.ChatEvent) error {
			return WriteEvent(writer, event)
		})
		done <- err
	}()

	heartbeatDone := make(chan struct{})
	go func() {
		_ = Heartbeat(ctx, writer, 15*time.Second)
		close(heartbeatDone)
	}()

	finalize := func(status chatrun.Status) {
		if run.Cancel != nil {
			run.Cancel()
		}
		_ = h.registry.UpdateStatus(runID, status)
		_ = h.registry.Remove(runID)
	}

	select {
	case <-ctx.Done():
		finalize(chatrun.StatusCanceled)
	case err := <-done:
		if err != nil {
			log.WithContext(c.Request.Context()).WithFields(log.Fields{
				"run_id":     runID,
				"project_id": project.ID,
				"error":      err,
			}).Warn("chat stream failed")
			finalize(chatrun.StatusFailed)
		} else {
			finalize(chatrun.StatusCompleted)
		}
	}
	cancel()

	<-heartbeatDone
}

type lockedResponseWriter struct {
	http.ResponseWriter
	mu *sync.Mutex
}

func (w *lockedResponseWriter) WriteHeader(statusCode int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *lockedResponseWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.ResponseWriter.Write(data)
}

func (w *lockedResponseWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}
