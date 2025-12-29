package document

import (
	"context"
	"fmt"
	"path"
	"strings"
	"time"

	"zeus/internal/domain"
	"zeus/internal/infra/ingestion"
	"zeus/internal/repository"
	"zeus/internal/service"

	"github.com/google/uuid"
)

type RawDocumentService struct {
	ingestion ingestion.FileIngestionService
	repo      repository.DocumentRepository
	now       func() time.Time
}

func (s *RawDocumentService) CreateFromUpload(ctx context.Context, input service.CreateFromUploadInput) (*domain.Document, error) {
	if s == nil || s.ingestion == nil || s.repo == nil {
		return nil, fmt.Errorf("raw document service not initialized")
	}
	if input.Reader == nil {
		return nil, fmt.Errorf("reader is required")
	}
	if input.SizeBytes < 0 {
		return nil, fmt.Errorf("size_bytes must be >= 0")
	}
	storageKey := strings.TrimSpace(input.StorageObjectKey)
	if storageKey == "" {
		return nil, fmt.Errorf("storage_object_key is required")
	}
	storageNamespace := strings.TrimSpace(input.StorageNamespace)
	if storageNamespace == "" {
		storageNamespace = "raw-documents"
	}

	obj, err := s.ingestion.Store(ctx, ingestion.StoreInput{
		Namespace:   storageNamespace,
		ObjectKey:   storageKey,
		Reader:      input.Reader,
		Size:        input.SizeBytes,
		ContentType: strings.TrimSpace(input.MimeType),
	})
	if err != nil {
		return nil, fmt.Errorf("store upload: %w", err)
	}

	now := time.Now()
	if s.now != nil {
		now = s.now()
	}

	storage := &domain.StorageObject{
		ID: uuid.NewString(),
		Source: domain.SourceInfo{
			Type:          domain.SourceTypeUpload,
			UploadBatchID: strings.TrimSpace(input.UploadBatchID),
			ImportedFrom:  strings.TrimSpace(input.OriginalPath),
		},
		Storage: domain.StorageInfo{
			Type:   domain.StorageTypeS3,
			Bucket: obj.Bucket,
			Key:    obj.Key,
		},
		SizeBytes: obj.Size,
		MimeType:  strings.TrimSpace(input.MimeType),
		Checksum:  obj.ETag,
		CreatedAt: now,
		UpdatedAt: now,
	}

	doc := &domain.Document{
		ID:            uuid.NewString(),
		Type:          domain.DocumentTypeRaw,
		Title:         documentTitle(input.OriginalPath, obj.Key),
		Status:        domain.DocumentStatusActive,
		StorageObject: storage,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	if err := s.repo.Insert(ctx, doc); err != nil {
		return nil, fmt.Errorf("insert document: %w", err)
	}

	return doc, nil
}

func documentTitle(originalPath, objectKey string) string {
	originalPath = strings.TrimSpace(originalPath)
	if originalPath != "" {
		return path.Base(normalizePath(originalPath))
	}
	objectKey = strings.TrimSpace(objectKey)
	if objectKey != "" {
		return path.Base(normalizePath(objectKey))
	}
	return ""
}

func normalizePath(value string) string {
	normalized := strings.ReplaceAll(value, "\\", "/")
	cleaned := path.Clean(normalized)
	if cleaned == "." {
		return ""
	}
	return cleaned
}
