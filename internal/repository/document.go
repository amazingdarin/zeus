package repository

import (
	"context"

	"zeus/internal/domain"
)

type DocumentFilter struct {
	Type                 domain.DocumentType
	Status               domain.DocumentStatus
	PreloadStorageObject bool // 是否预加载存储
}

type DocumentRepository interface {
	Insert(ctx context.Context, doc *domain.Document) error
	Save(ctx context.Context, doc *domain.Document) error
	List(ctx context.Context, filter DocumentFilter, limit, offset int) ([]domain.Document, int, error)
}
