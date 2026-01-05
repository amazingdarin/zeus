package repository

import (
	"context"
	"errors"

	"zeus/internal/domain"
)

var ErrDocumentNotFound = errors.New("document not found")

type KnowledgeRepository interface {
	ListDocuments(ctx context.Context, projectKey string) ([]domain.DocumentMeta, error)
	ReadDocument(ctx context.Context, projectKey, docID string) (domain.DocumentMeta, domain.DocumentContent, error)
	CreateDocument(ctx context.Context, projectKey string, meta domain.DocumentMeta, content domain.DocumentContent) error
	UpdateDocument(
		ctx context.Context,
		projectKey, docID string,
		metaPatch *domain.DocumentMeta,
		contentPatch *domain.DocumentContent,
	) error
}
