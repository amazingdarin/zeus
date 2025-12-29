package upload

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"mime/multipart"
	"path"
	"strings"
	"time"

	"zeus/internal/repository"
)

const (
	batchIDPrefix = "batch-"
)

type Service struct {
	storage repository.FileRepository
	now     func() time.Time
}

func NewService(storage repository.FileRepository) (*Service, error) {
	if storage == nil {
		return nil, fmt.Errorf("object storage repository is required")
	}
	return &Service{
		storage: storage,
		now:     time.Now,
	}, nil
}

func (s *Service) CreateBatch(
	ctx context.Context,
	sourceType string,
	description string,
) (string, string, error) {
	if s == nil || s.storage == nil {
		return "", "", fmt.Errorf("upload service not initialized")
	}

	sourceType = strings.TrimSpace(sourceType)
	if sourceType == "" {
		return "", "", fmt.Errorf("source_type is required")
	}
	if err := validateSourceType(sourceType); err != nil {
		return "", "", err
	}

	batchID, err := generateBatchID(s.now())
	if err != nil {
		return "", "", err
	}
	uploadURL := fmt.Sprintf("/api/uploads/%s/files", batchID)

	return batchID, uploadURL, nil
}

func (s *Service) UploadFile(
	ctx context.Context,
	batchID string,
	file *multipart.FileHeader,
	relativePath string,
) error {
	if s == nil || s.storage == nil {
		return fmt.Errorf("upload service not initialized")
	}

	batchID = strings.TrimSpace(batchID)
	if batchID == "" {
		return fmt.Errorf("batch_id is required")
	}
	if !strings.HasPrefix(batchID, batchIDPrefix) {
		return fmt.Errorf("batch_id must start with %s", batchIDPrefix)
	}
	if file == nil {
		return fmt.Errorf("file is required")
	}

	objectKey, err := buildObjectKey(batchID, file.Filename, relativePath)
	if err != nil {
		return err
	}

	reader, err := file.Open()
	if err != nil {
		return fmt.Errorf("open upload file: %w", err)
	}
	defer reader.Close()

	contentType := strings.TrimSpace(file.Header.Get("Content-Type"))
	if _, err := s.storage.Upload(ctx, objectKey, reader, file.Size, contentType); err != nil {
		return fmt.Errorf("upload file: %w", err)
	}
	return nil
}

func validateSourceType(value string) error {
	switch value {
	case "file", "folder", "url":
		return nil
	default:
		return fmt.Errorf("invalid source_type: %s", value)
	}
}

func generateBatchID(now time.Time) (string, error) {
	seq, err := rand.Int(rand.Reader, big.NewInt(1000))
	if err != nil {
		return "", fmt.Errorf("generate batch id: %w", err)
	}
	return fmt.Sprintf("%s%s-%03d", batchIDPrefix, now.Format("20060102"), seq.Int64()), nil
}

func buildObjectKey(batchID, filename, relativePath string) (string, error) {
	cleaned := cleanRelativePath(relativePath)
	if cleaned == "" {
		base := path.Base(strings.TrimSpace(filename))
		if base == "" || base == "." || base == "/" {
			return "", fmt.Errorf("filename is required")
		}
		cleaned = base
	}
	if strings.HasPrefix(cleaned, "..") {
		return "", fmt.Errorf("relative_path must not escape base directory")
	}
	return path.Join(batchID, cleaned), nil
}

func cleanRelativePath(value string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	normalized := strings.ReplaceAll(value, "\\", "/")
	cleaned := path.Clean(normalized)
	cleaned = strings.TrimPrefix(cleaned, "/")
	if cleaned == "." {
		return ""
	}
	return cleaned
}
