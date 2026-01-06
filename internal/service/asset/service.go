package asset

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/google/uuid"

	"zeus/internal/ingestion"
	"zeus/internal/service"
	"zeus/internal/service/openapi"
)

type Service struct {
	policy        ingestion.IngestionPolicy
	gitStorage    service.AssetStorageService
	objectStorage service.AssetStorageService
	metaStore     service.AssetMetaStore
	reader        service.AssetContentReader
}

func NewService(
	policy ingestion.IngestionPolicy,
	gitStorage service.AssetStorageService,
	objectStorage service.AssetStorageService,
	metaStore service.AssetMetaStore,
	reader service.AssetContentReader,
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
	if metaStore == nil {
		return nil, fmt.Errorf("asset meta store is required")
	}
	if reader == nil {
		return nil, fmt.Errorf("asset content reader is required")
	}
	return &Service{
		policy:        policy,
		gitStorage:    gitStorage,
		objectStorage: objectStorage,
		metaStore:     metaStore,
		reader:        reader,
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
	stored, err := storage.Store(ctx, projectKey, assetID, filename, content)
	if err != nil {
		return "", err
	}
	storedSize := stored.Size
	if storedSize == 0 {
		storedSize = size
	}
	storedMime := strings.TrimSpace(stored.Mime)
	if storedMime == "" {
		storedMime = strings.TrimSpace(mime)
	}
	if err := s.metaStore.Save(ctx, service.AssetMeta{
		AssetID:     assetID,
		ProjectKey:  projectKey,
		Filename:    strings.TrimSpace(filename),
		Size:        storedSize,
		Mime:        storedMime,
		StorageType: stored.StorageType,
		GitTempPath: stored.GitTempPath,
		Bucket:      stored.Bucket,
		ObjectKey:   stored.ObjectKey,
	}); err != nil {
		return "", err
	}
	return assetID, nil
}

func (s *Service) GetKind(
	ctx context.Context,
	projectKey string,
	assetID string,
) (service.AssetKindResult, error) {
	if s == nil {
		return service.AssetKindResult{}, fmt.Errorf("asset service not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return service.AssetKindResult{}, fmt.Errorf("project key is required")
	}
	assetID = strings.TrimSpace(assetID)
	if assetID == "" {
		return service.AssetKindResult{}, fmt.Errorf("asset id is required")
	}
	if s.metaStore == nil || s.reader == nil {
		return service.AssetKindResult{}, fmt.Errorf("asset dependencies are required")
	}

	meta, err := s.metaStore.Load(ctx, projectKey, assetID)
	if err != nil {
		return service.AssetKindResult{}, err
	}
	if meta == nil {
		return service.AssetKindResult{}, service.ErrAssetNotFound
	}

	const maxBytes = 64 * 1024
	head, err := s.reader.ReadHead(ctx, *meta, maxBytes)
	if err != nil {
		return service.AssetKindResult{}, err
	}
	ok, version := openapi.DetectOpenAPI(meta.Filename, head)
	if ok {
		return service.AssetKindResult{
			Kind:           service.AssetKindOpenAPI,
			OpenAPIVersion: normalizeOpenAPIVersion(version),
		}, nil
	}
	return service.AssetKindResult{Kind: service.AssetKindGeneric}, nil
}

func (s *Service) GetContent(
	ctx context.Context,
	projectKey string,
	assetID string,
) (service.AssetMeta, []byte, error) {
	if s == nil {
		return service.AssetMeta{}, nil, fmt.Errorf("asset service not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return service.AssetMeta{}, nil, fmt.Errorf("project key is required")
	}
	assetID = strings.TrimSpace(assetID)
	if assetID == "" {
		return service.AssetMeta{}, nil, fmt.Errorf("asset id is required")
	}
	if s.metaStore == nil || s.reader == nil {
		return service.AssetMeta{}, nil, fmt.Errorf("asset dependencies are required")
	}

	meta, err := s.metaStore.Load(ctx, projectKey, assetID)
	if err != nil {
		return service.AssetMeta{}, nil, err
	}
	if meta == nil || meta.ProjectKey != projectKey {
		return service.AssetMeta{}, nil, service.ErrAssetNotFound
	}

	data, err := s.reader.ReadAll(ctx, *meta)
	if err != nil {
		return service.AssetMeta{}, nil, err
	}
	return *meta, data, nil
}

func normalizeOpenAPIVersion(version string) string {
	version = strings.TrimSpace(strings.ToLower(version))
	if version == "" {
		return ""
	}
	if strings.HasPrefix(version, "3.") || version == "3.x" {
		return "3.0"
	}
	if strings.HasPrefix(version, "2.") {
		return "2.0"
	}
	return ""
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
