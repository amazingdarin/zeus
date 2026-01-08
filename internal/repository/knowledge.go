package repository

import (
	"context"
	"errors"

	"zeus/internal/domain"
)

var ErrDocumentNotFound = errors.New("document not found")

type KnowledgeRepository interface {
	ListDocuments(ctx context.Context, repo string) ([]domain.DocumentMeta, error)
	ReadDocument(ctx context.Context, repo, docID string) (domain.DocumentMeta, domain.DocumentContent, error)
	CreateDocument(ctx context.Context, repo string, meta domain.DocumentMeta, content domain.DocumentContent) error
	UpdateDocument(
		ctx context.Context,
		repo, docID string,
		metaPatch *domain.DocumentMeta,
		contentPatch *domain.DocumentContent,
	) error
}
