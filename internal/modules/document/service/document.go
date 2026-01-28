package service

import (
	"context"

	"zeus/internal/domain"
)

// DocumentService defines the document management operations.
type DocumentService interface {
	Get(ctx context.Context, projectKey, docID string) (*domain.Document, error)
	Save(ctx context.Context, projectKey string, doc *domain.Document) error
	Delete(ctx context.Context, projectKey, docID string) error
	Move(ctx context.Context, projectKey, docID, targetParentID, beforeDocID, afterDocID string) error
	GetChildren(ctx context.Context, projectKey, parentID string) ([]domain.TreeItem, error)
	GetHierarchy(ctx context.Context, projectKey, docID string) ([]domain.DocumentMeta, error)
	GetBlockByID(ctx context.Context, projectKey, docID, blockID string) (*domain.Document, error)
	RegisterHooks(hooks domain.Hooks)
}
