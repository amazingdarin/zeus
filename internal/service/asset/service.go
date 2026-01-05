package asset

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/google/uuid"

	"zeus/internal/ingestion"
	"zeus/internal/service"
)

type Service struct {
	policy        ingestion.IngestionPolicy
	gitStorage    service.AssetStorageService
	objectStorage service.AssetStorageService
}

func NewService(
	policy ingestion.IngestionPolicy,
	gitStorage service.AssetStorageService,
	objectStorage service.AssetStorageService,
) (*Service, error) {
	if policy == nil {
		return nil, fmt.Errorf("ingestion policy is required")
	}
	if gitStorage == nil {
		return nil, fmt.Errorf("git asset storage is required")
	}
	if objectStorage == nil {
		return nil, fmt.Errorf("object asset storage is required")
	}
	return &Service{
		policy:        policy,
		gitStorage:    gitStorage,
		objectStorage: objectStorage,
	}, nil
}

func (s *Service) ImportFile(
	ctx context.Context,
	projectKey string,
	filename string,
	mime string,
	size int64,
	content io.Reader,
) (string, error) {
	if s == nil {
		return "", fmt.Errorf("asset service not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return "", fmt.Errorf("project key is required")
	}
	if content == nil {
		return "", fmt.Errorf("content is required")
	}

	target := s.policy.Decide(size, mime)
	storage, err := s.selectStorage(target)
	if err != nil {
		return "", err
	}

	assetID := uuid.NewString()
	if _, err := storage.Store(ctx, projectKey, assetID, filename, content); err != nil {
		return "", err
	}
	return assetID, nil
}

func (s *Service) selectStorage(target ingestion.StorageType) (service.AssetStorageService, error) {
	switch target {
	case ingestion.StorageTypeGit:
		if s.gitStorage == nil {
			return nil, fmt.Errorf("git asset storage is required")
		}
		return s.gitStorage, nil
	case ingestion.StorageTypeObject:
		if s.objectStorage == nil {
			return nil, fmt.Errorf("object asset storage is required")
		}
		return s.objectStorage, nil
	default:
		return nil, fmt.Errorf("unsupported storage type: %s", target)
	}
}

var _ service.AssetService = (*Service)(nil)
