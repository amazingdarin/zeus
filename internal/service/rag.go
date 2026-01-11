package service

import (
	"context"

	domainrag "zeus/internal/domain/rag"
)

type RAGService interface {
	RebuildProject(ctx context.Context, projectID string) (domainrag.RAGRebuildReport, error)
	RebuildDocument(ctx context.Context, projectID, docID string) (domainrag.RAGRebuildReport, error)
	Search(ctx context.Context, query domainrag.RAGQuery) (domainrag.RAGSearchResult, error)
	BuildContext(ctx context.Context, query domainrag.RAGQuery) (domainrag.RAGContextBundle, error)
}
