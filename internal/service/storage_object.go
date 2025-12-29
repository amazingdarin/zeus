package service

import (
	"context"
	"io"

	"zeus/internal/domain"
)

type StoragePayload struct {
	Reader    io.Reader
	SizeBytes int64
	MimeType  string
	Namespace string
}

type StorageObjectService interface {
	Create(ctx context.Context, so *domain.StorageObject, payload StoragePayload) error
}
