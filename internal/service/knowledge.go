package service

import (
	"context"

	"zeus/internal/domain"
)

type KnowledgeCreateRequest struct {
	Meta    domain.DocumentMeta
	Content *domain.DocumentContent
	OpenAPI *KnowledgeOpenAPI
}

type KnowledgeUpdateRequest struct {
	Meta    *domain.DocumentMeta
	Content *domain.DocumentContent
}

type KnowledgeOpenAPI struct {
	Source   string
	Renderer string
}

type KnowledgeDocumentListItem struct {
	Meta     domain.DocumentMeta
	HasChild bool
}

type KnowledgeDocumentHierarchyItem struct {
	ID   string
	Name string
}

type KnowledgeMoveRequest struct {
	NewParentID string
	BeforeID    string
	AfterID     string
}

type KnowledgeService interface {
	ListDocuments(ctx context.Context, projectKey string) ([]domain.DocumentMeta, error)
	ListDocumentsByParent(
		ctx context.Context,
		projectKey string,
		parentID string,
	) ([]KnowledgeDocumentListItem, error)
	GetDocument(ctx context.Context, projectKey, docID string) (domain.DocumentMeta, domain.DocumentContent, error)
	GetDocumentHierarchy(
		ctx context.Context,
		projectKey string,
		docID string,
	) ([]KnowledgeDocumentHierarchyItem, error)
	CreateDocument(ctx context.Context, projectKey string, req KnowledgeCreateRequest) (domain.DocumentMeta, domain.DocumentContent, error)
	UpdateDocument(ctx context.Context, projectKey, docID string, req KnowledgeUpdateRequest) (domain.DocumentMeta, domain.DocumentContent, error)
	MoveDocument(ctx context.Context, projectKey, docID string, req KnowledgeMoveRequest) (domain.DocumentMeta, error)
}
