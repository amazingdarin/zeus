package service

import (
	"context"

	"zeus/internal/domain"
)

type KnowledgeCreateRequest struct {
	Meta    domain.DocumentMeta
	Content domain.DocumentContent
}

type KnowledgeUpdateRequest struct {
	Meta    *domain.DocumentMeta
	Content *domain.DocumentContent
}

type KnowledgeService interface {
	ListDocuments(ctx context.Context, projectKey string) ([]domain.DocumentMeta, error)
	GetDocument(ctx context.Context, projectKey, docID string) (domain.DocumentMeta, domain.DocumentContent, error)
	CreateDocument(ctx context.Context, projectKey string, req KnowledgeCreateRequest) (domain.DocumentMeta, domain.DocumentContent, error)
	UpdateDocument(ctx context.Context, projectKey, docID string, req KnowledgeUpdateRequest) (domain.DocumentMeta, domain.DocumentContent, error)
}
