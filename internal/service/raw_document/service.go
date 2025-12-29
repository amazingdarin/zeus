package raw_document

import (
	"context"

	"zeus/internal/domain"
	"zeus/internal/infra/ingestion"

	"github.com/google/uuid"
)

type RawDocumentService struct{}

func (s *RawDocumentService) CreateFromUpload(
	ctx context.Context,
	input CreateFromUploadInput,
) (*domain.RawDocument, error) {

	obj, err := s.ingestion.Store(ctx, ingestion.StoreInput{
		Namespace:   "raw-documents",
		ObjectKey:   input.ObjectKey,
		Reader:      input.Reader,
		Size:        input.Size,
		ContentType: input.ContentType,
	})
	if err != nil {
		return nil, err
	}

	doc := &domain.RawDocument{
		ID:        uuid.NewString(),
		BatchID:   input.BatchID,
		S3Bucket:  obj.Bucket,
		S3Key:     obj.Key,
		SizeBytes: obj.Size,
		Status:    domain.RawDocumentStatusUploaded,
	}

	if err := s.repo.Insert(ctx, doc); err != nil {
		return nil, err
	}

	return doc, nil
}
