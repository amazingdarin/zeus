package task

import (
	"context"
	"fmt"
	"strings"

	log "github.com/sirupsen/logrus"

	"zeus/internal/domain"
	"zeus/internal/service"
)

type RagRebuildProjectHandler struct {
	ragSvc     service.RAGService
	summarySvc service.DocumentSummaryService
}

func NewRagRebuildProjectHandler(
	ragSvc service.RAGService,
	summarySvc service.DocumentSummaryService,
) *RagRebuildProjectHandler {
	return &RagRebuildProjectHandler{
		ragSvc:     ragSvc,
		summarySvc: summarySvc,
	}
}

func (h *RagRebuildProjectHandler) Type() string {
	return domain.TaskTypeRAGRebuildProject
}

func (h *RagRebuildProjectHandler) Handle(
	ctx context.Context,
	task domain.Task,
) (map[string]interface{}, error) {
	if h.ragSvc == nil {
		return nil, fmt.Errorf("rag service is required")
	}
	projectID := strings.TrimSpace(task.ProjectID)
	if projectID == "" {
		return nil, fmt.Errorf("project id is required")
	}
	withSummary := parsePayloadBool(task.Payload, "with_summary")
	log.WithContext(ctx).WithFields(log.Fields{
		"project_id":   projectID,
		"with_summary": withSummary,
	}).Info("rag rebuild project handler start")

	report, err := h.ragSvc.RebuildProject(ctx, projectID)
	if err != nil {
		return nil, err
	}
	result := map[string]interface{}{
		"report": report,
	}
	if withSummary {
		if h.summarySvc == nil {
			return nil, fmt.Errorf("summary service is required")
		}
		count, err := h.summarySvc.GenerateProjectSummaries(ctx, projectID)
		if err != nil {
			return nil, err
		}
		result["summary_count"] = count
	}
	return result, nil
}

func parsePayloadBool(payload map[string]interface{}, key string) bool {
	if payload == nil {
		return false
	}
	value, ok := payload[key]
	if !ok {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true")
	case float64:
		return typed != 0
	default:
		return false
	}
}

var _ Handler = (*RagRebuildProjectHandler)(nil)
