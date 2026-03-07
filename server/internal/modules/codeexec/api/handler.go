package api

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	codeexecrepo "zeus/internal/modules/codeexec/repository"
	codeexecsvc "zeus/internal/modules/codeexec/service"
	"zeus/internal/i18n"
)

type Handler struct {
	repo                 codeexecrepo.CodeRunRepository
	runtime              codeexecsvc.RuntimeExecutor
	defaultTimeoutSecond int
	maxOutputBytes       int
}

type HandlerOptions struct {
	DefaultTimeoutSecond int
	MaxOutputBytes       int
}

func NewHandler(
	repo codeexecrepo.CodeRunRepository,
	runtime codeexecsvc.RuntimeExecutor,
	options HandlerOptions,
) *Handler {
	timeout := options.DefaultTimeoutSecond
	if timeout <= 0 {
		timeout = 10
	}
	maxOutputBytes := options.MaxOutputBytes
	if maxOutputBytes <= 0 {
		maxOutputBytes = codeexecsvc.DefaultMaxOutputBytes
	}
	return &Handler{
		repo:                 repo,
		runtime:              runtime,
		defaultTimeoutSecond: timeout,
		maxOutputBytes:       maxOutputBytes,
	}
}

func RegisterInternalRoutes(router gin.IRoutes, token string, handler *Handler) {
	if handler == nil {
		return
	}
	router.POST("/internal/code-exec/execute", tokenGuard(token), handler.Execute)
	router.GET("/internal/code-exec/runs/:runId", tokenGuard(token), handler.GetRun)
	router.GET("/internal/code-exec/runs", tokenGuard(token), handler.ListRuns)
}

func tokenGuard(expectedToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.TrimSpace(expectedToken) == "" {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"code":    "INTERNAL_TOKEN_MISSING",
				"message": i18n.Message(i18n.ResolveLocale(c.Request), "error.internal_token_missing"),
			})
			return
		}
		token := strings.TrimSpace(c.GetHeader("x-code-runner-token"))
		if subtle.ConstantTimeCompare([]byte(token), []byte(expectedToken)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    "UNAUTHORIZED",
				"message": i18n.Message(i18n.ResolveLocale(c.Request), "error.invalid_internal_token"),
			})
			return
		}
		c.Next()
	}
}

func (h *Handler) Execute(c *gin.Context) {
	if h == nil || h.repo == nil || h.runtime == nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "HANDLER_NOT_READY",
			"message": i18n.Message(i18n.ResolveLocale(c.Request), "error.handler_not_ready"),
		})
		return
	}
	var req ExecuteCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_REQUEST",
			"message": err.Error(),
		})
		return
	}
	if strings.TrimSpace(req.OwnerType) == "" || strings.TrimSpace(req.OwnerID) == "" || strings.TrimSpace(req.ProjectKey) == "" || strings.TrimSpace(req.DocID) == "" || strings.TrimSpace(req.BlockID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_SCOPE",
			"message": i18n.Message(i18n.ResolveLocale(c.Request), "error.invalid_scope"),
		})
		return
	}
	timeoutSecond := h.defaultTimeoutSecond
	if req.TimeoutMs > 0 {
		timeoutSecond = req.TimeoutMs / 1000
		if timeoutSecond <= 0 {
			timeoutSecond = 1
		}
	}
	result, err := h.runtime.Execute(c.Request.Context(), codeexecsvc.RuntimeExecuteInput{
		Language:       req.Language,
		Code:           req.Code,
		TimeoutSeconds: timeoutSecond,
		MaxOutputBytes: h.maxOutputBytes,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "EXEC_INTERNAL_ERROR",
			"message": err.Error(),
		})
		return
	}

	runID := uuid.NewString()
	now := time.Now().UTC()
	status := "completed"
	if result.TimedOut {
		status = "timeout"
	} else if result.ExitCode != 0 {
		status = "failed"
	}
	entity := &codeexecrepo.CodeRun{
		RunID:         runID,
		RequestID:     strings.TrimSpace(req.RequestID),
		OwnerType:     strings.TrimSpace(req.OwnerType),
		OwnerID:       strings.TrimSpace(req.OwnerID),
		ProjectKey:    strings.TrimSpace(req.ProjectKey),
		DocID:         strings.TrimSpace(req.DocID),
		BlockID:       strings.TrimSpace(req.BlockID),
		UserID:        strings.TrimSpace(req.UserID),
		Language:      strings.ToLower(strings.TrimSpace(req.Language)),
		ImageRef:      "",
		Status:        status,
		Stdout:        result.Stdout,
		Stderr:        result.Stderr,
		Truncated:     result.Truncated,
		TimedOut:      result.TimedOut,
		ExitCode:      result.ExitCode,
		DurationMs:    result.DurationMs,
		CPULimitMilli: 500,
		MemoryLimitMB: 256,
		TimeoutMs:     timeoutSecond * 1000,
		CodeSHA256:    "",
		StartedAt:     &now,
		FinishedAt:    &now,
	}
	if err := h.repo.Insert(c.Request.Context(), entity); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "EXEC_PERSIST_FAILED",
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code":    "OK",
		"message": "success",
		"locale": i18n.ResolveLocale(c.Request),
		"data": gin.H{
			"runId":  entity.RunID,
			"status": entity.Status,
			"result": gin.H{
				"stdout":     entity.Stdout,
				"stderr":     entity.Stderr,
				"exitCode":   entity.ExitCode,
				"durationMs": entity.DurationMs,
				"truncated":  entity.Truncated,
				"timedOut":   entity.TimedOut,
			},
		},
	})
}

func (h *Handler) GetRun(c *gin.Context) {
	runID := strings.TrimSpace(c.Param("runId"))
	if runID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "RUN_ID_REQUIRED", "message": i18n.Message(i18n.ResolveLocale(c.Request), "error.run_id_required"), "locale": i18n.ResolveLocale(c.Request)})
		return
	}
	run, err := h.repo.FindByRunID(c.Request.Context(), runID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "RUN_FETCH_FAILED", "message": err.Error()})
		return
	}
	if run == nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "RUN_NOT_FOUND", "message": i18n.Message(i18n.ResolveLocale(c.Request), "error.run_not_found"), "locale": i18n.ResolveLocale(c.Request)})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code":    "OK",
		"message": "success",
		"locale": i18n.ResolveLocale(c.Request),
		"data": gin.H{
			"runId":  run.RunID,
			"status": run.Status,
			"result": gin.H{
				"stdout":     run.Stdout,
				"stderr":     run.Stderr,
				"exitCode":   run.ExitCode,
				"durationMs": run.DurationMs,
				"truncated":  run.Truncated,
				"timedOut":   run.TimedOut,
			},
		},
	})
}

func (h *Handler) ListRuns(c *gin.Context) {
	var query ListCodeRunsQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_QUERY", "message": err.Error()})
		return
	}
	limit := query.Limit
	if limit <= 0 {
		limit = 20
	}
	runs, err := h.repo.ListByDocument(context.Background(), codeexecrepo.CodeRunListFilter{
		OwnerType:  strings.TrimSpace(query.OwnerType),
		OwnerID:    strings.TrimSpace(query.OwnerID),
		ProjectKey: strings.TrimSpace(query.ProjectKey),
		DocID:      strings.TrimSpace(query.DocID),
		BlockID:    strings.TrimSpace(query.BlockID),
		Limit:      limit,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "RUN_LIST_FAILED", "message": err.Error()})
		return
	}
	items := make([]gin.H, 0, len(runs))
	for _, run := range runs {
		items = append(items, gin.H{
			"runId":  run.RunID,
			"status": run.Status,
			"result": gin.H{
				"stdout":     run.Stdout,
				"stderr":     run.Stderr,
				"exitCode":   run.ExitCode,
				"durationMs": run.DurationMs,
				"truncated":  run.Truncated,
				"timedOut":   run.TimedOut,
			},
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"code":    "OK",
		"message": "success",
		"locale": i18n.ResolveLocale(c.Request),
		"data": gin.H{
			"items": items,
		},
	})
}
