package storageobject

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"

	"zeus/internal/domain"
	"zeus/internal/infra/ingestion"
	"zeus/internal/repository"
	"zeus/internal/service"
)

type Service struct {
	ingestion ingestion.FileIngestionService
	repo      repository.StorageObjectRepository
	presigner *s3.PresignClient
	now       func() time.Time
	expires   time.Duration
}

const accessTypePresignedURL = "PresignedURL"

var (
	ErrStorageObjectNotFound        = errors.New("storage object not found")
	ErrStorageObjectProjectMismatch = errors.New("storage object project mismatch")
	ErrUnsupportedStorageType       = errors.New("unsupported storage type")
)

func NewService(
	ingestionSvc ingestion.FileIngestionService,
	s3Client *s3.Client,
	repos repository.Repository,
) *Service {
	var presigner *s3.PresignClient
	if s3Client != nil {
		presigner = s3.NewPresignClient(s3Client)
	}
	return &Service{
		ingestion: ingestionSvc,
		repo:      repos.StorageObject,
		presigner: presigner,
		now:       time.Now,
		expires:   10 * time.Minute,
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

func (s *Service) GetAccess(
	ctx context.Context,
	projectID string,
	storageObjectID string,
) (*service.StorageObjectAccess, *domain.StorageObject, error) {
	if s == nil || s.repo == nil || s.presigner == nil {
		return nil, nil, fmt.Errorf("storage object service not initialized")
	}
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, nil, fmt.Errorf("project id is required")
	}
	storageObjectID = strings.TrimSpace(storageObjectID)
	if storageObjectID == "" {
		return nil, nil, fmt.Errorf("storage object id is required")
	}

	obj, err := s.repo.FindByID(ctx, storageObjectID)
	if err != nil {
		return nil, nil, fmt.Errorf("find storage object: %w", err)
	}
	if obj == nil {
		return nil, nil, ErrStorageObjectNotFound
	}
	if obj.ProjectID != projectID {
		return nil, nil, ErrStorageObjectProjectMismatch
	}
	if obj.Storage.Type != domain.StorageTypeS3 {
		return nil, nil, ErrUnsupportedStorageType
	}

	bucket := strings.TrimSpace(obj.Storage.Bucket)
	if bucket == "" {
		return nil, nil, fmt.Errorf("bucket is required")
	}
	key := strings.TrimSpace(obj.Storage.Key)
	if key == "" {
		return nil, nil, fmt.Errorf("key is required")
	}

	presigned, err := s.presigner.PresignGetObject(
		ctx,
		&s3.GetObjectInput{
			Bucket: aws.String(bucket),
			Key:    aws.String(key),
		},
		s3.WithPresignExpires(s.expires),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("presign get object: %w", err)
	}

	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	access := &service.StorageObjectAccess{
		Type:      accessTypePresignedURL,
		URL:       presigned.URL,
		ExpiresAt: now.Add(s.expires),
	}
	return access, obj, nil
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
