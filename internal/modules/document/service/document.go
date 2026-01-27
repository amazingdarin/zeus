package service

import (
	"context"

	"zeus/internal/domain/docstore"
)

// DocumentService defines the document management operations.
type DocumentService interface {
	Get(ctx context.Context, projectKey, docID string) (*docstore.Document, error)
	Save(ctx context.Context, projectKey string, doc *docstore.Document) error
	Delete(ctx context.Context, projectKey, docID string) error
	Move(ctx context.Context, projectKey, docID, targetParentID, beforeDocID, afterDocID string) error
	GetChildren(ctx context.Context, projectKey, parentID string) ([]docstore.TreeItem, error)
	GetHierarchy(ctx context.Context, projectKey, docID string) ([]docstore.DocumentMeta, error)
	GetBlockByID(ctx context.Context, projectKey, docID, blockID string) (*docstore.Document, error)
	RegisterHooks(hooks docstore.Hooks)
}
