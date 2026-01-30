package service

import (
	"context"
	"io"
	"time"

	"zeus/internal/domain"
)

type StoragePayload struct {
	Reader    io.Reader
	SizeBytes int64
	MimeType  string
	Namespace string
}

type StorageObjectAccess struct {
	Type      string
	URL       string
	ExpiresAt time.Time
}

type StorageObjectService interface {
	Create(ctx context.Context, so *domain.StorageObject, payload StoragePayload) error
	GetAccess(
		ctx context.Context,
		projectID string,
		storageObjectID string,
	) (*StorageObjectAccess, *domain.StorageObject, error)
}
