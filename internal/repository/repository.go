package repository

import (
	"context"

	"zeus/internal/domain"
)

type RawDocumentFilter struct {
	BatchID         string
	Category        domain.DocumentCategory
	CandidateModule string
	Status          domain.DocumentStatus
}

type RawDocumentRepository interface {
	Save(ctx context.Context, doc *domain.RawDocument) error
	List(ctx context.Context, filter RawDocumentFilter, limit, offset int) ([]domain.RawDocument, int, error)
}
