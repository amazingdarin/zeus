package fulltext

import (
	"context"
	"strings"

	"zeus/internal/domain"
	knowledgeservice "zeus/internal/modules/knowledge/service"
)

func (s *Service) DocumentHooks() domain.Hooks {
	return domain.Hooks{
		AfterSave: []func(ctx domain.HookContext, doc *domain.Document) error{
			func(ctx domain.HookContext, doc *domain.Document) error {
				if s == nil || doc == nil {
					return nil
				}
				projectKey := strings.TrimSpace(ctx.ProjectID)
				if projectKey == "" {
					return nil
				}
				index := knowledgeservice.IndexSpec{Kind: knowledgeservice.IndexFulltext, Name: projectKey}
				go s.upsertAsync(context.Background(), projectKey, index, doc)
				return nil
			},
		},
		AfterDelete: []func(ctx domain.HookContext, docID string) error{
			func(ctx domain.HookContext, docID string) error {
				if s == nil {
					return nil
				}
				projectKey := strings.TrimSpace(ctx.ProjectID)
				if projectKey == "" {
					return nil
				}
				docID = strings.TrimSpace(docID)
				if docID == "" {
					return nil
				}
				index := knowledgeservice.IndexSpec{Kind: knowledgeservice.IndexFulltext, Name: projectKey}
				go s.removeAsync(context.Background(), projectKey, index, docID)
				return nil
			},
		},
		AfterMove: []func(ctx domain.HookContext, docID, targetParentID string) error{
			func(ctx domain.HookContext, docID, targetParentID string) error {
				if s == nil {
					return nil
				}
				projectKey := strings.TrimSpace(ctx.ProjectID)
				if projectKey == "" {
					return nil
				}
				docID = strings.TrimSpace(docID)
				if docID == "" {
					return nil
				}
				go s.upsertByIDAsync(context.Background(), projectKey, docID)
				return nil
			},
		},
	}
}
