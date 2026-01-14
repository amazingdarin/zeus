package chatstream

import (
	"context"
	"fmt"

	"zeus/internal/service"
)

type KnowledgeToolInvoker struct {
	knowledgeSvc service.KnowledgeService
}

func NewKnowledgeToolInvoker(knowledgeSvc service.KnowledgeService) *KnowledgeToolInvoker {
	return &KnowledgeToolInvoker{knowledgeSvc: knowledgeSvc}
}

func (i *KnowledgeToolInvoker) Invoke(
	ctx context.Context,
	projectKey string,
	command string,
	args string,
) (SlashToolResult, error) {
	switch command {
	case "docs":
		if i.knowledgeSvc == nil {
			return SlashToolResult{}, fmt.Errorf("knowledge service is required")
		}
		metas, err := i.knowledgeSvc.ListDocuments(ctx, projectKey)
		if err != nil {
			return SlashToolResult{}, err
		}
		items := make([]map[string]string, 0, len(metas))
		for _, meta := range metas {
			if meta.ID == "" {
				continue
			}
			items = append(items, map[string]string{
				"id":    meta.ID,
				"title": meta.Title,
				"type":  meta.DocType,
			})
		}
		artifact := ChatArtifact{
			Type:  "document.list",
			Title: "Documents",
			Data: map[string]any{
				"items": items,
			},
		}
		return SlashToolResult{
			Message:   fmt.Sprintf("Found %d documents.", len(items)),
			Artifacts: []ChatArtifact{artifact},
		}, nil
	default:
		return SlashToolResult{}, fmt.Errorf("unknown slash command: %s", command)
	}
}
