package storageobject

import (
	"context"
	"fmt"
	"strings"
	"time"

	"zeus/internal/infra/ingestion"

	"github.com/google/uuid"

	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/service"
)

type Service struct {
	ingestion ingestion.FileIngestionService
	repo      repository.StorageObjectRepository
}

func NewService(
	ingestionSvc ingestion.FileIngestionService,
	repo repository.StorageObjectRepository,
) *Service {
	return &Service{
		ingestion: ingestionSvc,
		repo:      repo,
	}
}

func (s *Service) Create(ctx context.Context, so *domain.StorageObject, payload service.StoragePayload) error {
	if s == nil || s.repo == nil {
		return fmt.Errorf("storage object service not initialized")
	}
	if so == nil {
		return fmt.Errorf("storage object is required")
	}

	if err := validateStorageObject(so); err != nil {
		return err
	}

	switch so.Storage.Type {
	case domain.StorageTypeS3:
		if s.ingestion == nil {
			return fmt.Errorf("s3 ingestion service is required")
		}
		if payload.Reader == nil {
			return fmt.Errorf("payload reader is required")
		}
		if payload.SizeBytes < 0 {
			return fmt.Errorf("payload size_bytes must be >= 0")
		}
		key := strings.TrimSpace(so.Storage.Key)
		if key == "" {
			return fmt.Errorf("s3 key is required")
		}
		namespace := strings.TrimSpace(payload.Namespace)
		stored, err := s.ingestion.Store(ctx, ingestion.StoreInput{
			Namespace:   namespace,
			ObjectKey:   key,
			Reader:      payload.Reader,
			Size:        payload.SizeBytes,
			ContentType: strings.TrimSpace(payload.MimeType),
		})
		if err != nil {
			return fmt.Errorf("store s3 object: %w", err)
		}
		so.Storage.Bucket = stored.Bucket
		so.Storage.Key = stored.Key
		so.SizeBytes = stored.Size
		so.MimeType = strings.TrimSpace(payload.MimeType)
		so.Checksum = stored.ETag
	case domain.StorageTypeLocal:
		return fmt.Errorf("local storage is not supported yet")
	default:
		return fmt.Errorf("unsupported storage type: %s", so.Storage.Type)
	}

	if strings.TrimSpace(so.ID) == "" {
		so.ID = uuid.NewString()
	}

	now := time.Now()
	so.CreatedAt = now
	so.UpdatedAt = now

	if err := s.repo.Insert(ctx, so); err != nil {
		return fmt.Errorf("insert storage object: %w", err)
	}
	return nil
}

func validateStorageObject(so *domain.StorageObject) error {
	if so == nil {
		return fmt.Errorf("storage object is required")
	}
	if strings.TrimSpace(string(so.Storage.Type)) == "" {
		return fmt.Errorf("storage type is required")
	}
	return nil
}

var _ service.StorageObjectService = (*Service)(nil)
