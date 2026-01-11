package ragsummary

import (
	"context"

	domainrag "zeus/internal/domain/rag"
)

type DocumentSummaryRepository interface {
	Get(ctx context.Context, projectID, docID string) (*domainrag.DocumentSummary, bool, error)
	Upsert(ctx context.Context, summary *domainrag.DocumentSummary) error
	DeleteByProject(ctx context.Context, projectID string) error
	DeleteByDoc(ctx context.Context, projectID, docID string) error
}
