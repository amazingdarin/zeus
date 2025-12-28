package repository

import (
	"context"

	"zeus/internal/domain/document"
)

type RawDocumentRepository interface {
	SaveRawDocument(ctx context.Context, doc *document.RawDocument) error
}

type ObjectStorageRepository interface {
	Upload(ctx context.Context, objectKey string, content []byte) (string, error)
}
