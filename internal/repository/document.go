package repository

import (
	"context"

	"zeus/internal/domain"
)

type DocumentFilter struct {
	ProjectID string
	ParentID  string
	Type      domain.DocumentType
	Status    domain.DocumentStatus
}

type DocumentOption struct {
	PreloadStorageObject bool // 是否预加载存储
	Limit                int
	Offset               int
}

type DocumentRepository interface {
	Insert(ctx context.Context, doc *domain.Document) error
	Save(ctx context.Context, doc *domain.Document) error
	FindByID(ctx context.Context, id string) (*domain.Document, error)
	List(ctx context.Context, filter DocumentFilter, option DocumentOption) ([]*domain.Document, int, error)
}
