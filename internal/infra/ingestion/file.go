package ingestion

import (
	"context"
	"io"
)

// FileIngestionService
// 负责：
// - 接收文件流
// - 存储原始内容（S3 / FS / OSS）
// - 返回一个“已存储对象的句柄”
// ❌ 不包含任何业务语义
type FileIngestionService interface {
	Store(
		ctx context.Context,
		input StoreInput,
	) (*StoredObject, error)

	CreateDirectory(
		ctx context.Context,
		input DirectoryInput,
	) (*StoredObject, error)
}

type StoreInput struct {
	// Namespace 用于逻辑隔离（document / dataset / model / asset）
	Namespace string

	// ObjectKey 由上层决定（可以是 batch_id/path 等）
	ObjectKey string

	// 数据流（必须是流式）
	Reader io.Reader

	// 可选元信息
	Size        int64
	ContentType string
}

type DirectoryInput struct {
	// Namespace 用于逻辑隔离（document / dataset / model / asset）
	Namespace string

	// Path 由上层决定（可以是 batch_id/path 等）
	Path string
}

type StoredObject struct {
	Bucket string
	Key    string
	Size   int64
	ETag   string
}
