package service

import (
	"context"
	"io"

	"zeus/internal/domain"
)

type CreateFromUploadInput struct {
	// ========= 来源信息（Source） =========

	// 上传批次（用于 UI / UX / 追踪）
	UploadBatchID string

	// 原始来源路径（文件夹内相对路径、或文件名）
	OriginalPath string

	// ========= 文件内容 =========

	// 文件内容流（必须是流式）
	Reader io.Reader

	// 文件大小（字节）
	SizeBytes int64

	// MIME 类型
	MimeType string

	// ========= 存储策略 =========

	// 存储命名空间（raw-documents / dataset / asset）
	StorageNamespace string

	// 由领域决定的 object key（不由 ingestion 自己生成）
	StorageObjectKey string
}

type DocumentService interface {
	CreateFromUpload(ctx context.Context, input CreateFromUploadInput) (*domain.Document, error)
}
