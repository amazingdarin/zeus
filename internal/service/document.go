package service

import (
	"context"
	"io"

	"zeus/internal/domain"
)

type FilePayload struct {
	Reader    io.Reader
	SizeBytes int64
	MimeType  string

	OriginalPath string
	SourceType   domain.SourceType
	SourceRef    string
}

type DocumentService interface {

	// CreateRaw 创建原始文档
	CreateRaw(
		ctx context.Context,
		doc *domain.Document,
		file FilePayload,
	) (*domain.Document, error)

	// Create 创建普通文档（manual / derived）
	Create(
		ctx context.Context,
		doc *domain.Document,
		content string,
	) (*domain.Document, error)

	// 查询
	Get(ctx context.Context, id string) (*domain.Document, error)
	ListByParent(ctx context.Context, parentID *string) ([]*domain.Document, error)
	GetSubtree(ctx context.Context, rootID string) ([]*domain.Document, error)
	SimplifiedTree(ctx context.Context, projectID string) ([]*domain.Document, error)

	// 结构操作
	Move(ctx context.Context, id string, newParentID *string) error
	Reorder(ctx context.Context, id string, newOrder int) error

	// 生命周期
	UpdateContent(ctx context.Context, id string, content string) error
	Archive(ctx context.Context, id string) error
}
