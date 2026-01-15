package chatstream

import (
	"context"
	"fmt"
	"strings"

	"zeus/internal/service"
)

type KnowledgeToolInvoker struct {
	knowledgeSvc service.KnowledgeService
	searchSvc    service.SearchService
}

func NewKnowledgeToolInvoker(
	knowledgeSvc service.KnowledgeService,
	searchSvc service.SearchService,
) *KnowledgeToolInvoker {
	return &KnowledgeToolInvoker{
		knowledgeSvc: knowledgeSvc,
		searchSvc:    searchSvc,
	}
}

func (i *KnowledgeToolInvoker) Invoke(
	ctx context.Context,
	projectKey string,
	command string,
	args string,
) (SlashToolResult, error) {
	switch command {
	case "docs", "docs.list":
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
	case "docs/search", "docs.search":
		if i.searchSvc == nil {
			return SlashToolResult{}, fmt.Errorf("search service is required")
		}
		query := strings.TrimSpace(args)
		if query == "" {
			return SlashToolResult{}, fmt.Errorf("search query is required")
		}
		results, err := i.searchSvc.Search(ctx, projectKey, query)
		if err != nil {
			return SlashToolResult{}, err
		}
		items := make([]map[string]string, 0, len(results))
		for _, result := range results {
			if result.DocID == "" {
				continue
			}
			items = append(items, map[string]string{
				"id":      result.DocID,
				"title":   result.Title,
				"snippet": result.Snippet,
			})
		}
		artifact := ChatArtifact{
			Type:  "document.list",
			Title: "Search Results",
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
