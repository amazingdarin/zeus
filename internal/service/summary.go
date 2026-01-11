package service

import (
	"context"

	domainrag "zeus/internal/domain/rag"
)

type DocumentSummaryService interface {
	GenerateDocumentSummary(ctx context.Context, projectID, docID string) (*domainrag.DocumentSummary, error)
	GetDocumentSummary(ctx context.Context, projectID, docID string) (*domainrag.DocumentSummary, bool, error)
}
