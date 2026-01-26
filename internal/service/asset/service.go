package asset

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/google/uuid"

	"zeus/internal/repository"
	"zeus/internal/service"
	"zeus/internal/service/openapi"
)

type Service struct {
	localFileStorage service.AssetStorageService
	metaStore        service.AssetMetaStore
	reader           service.AssetContentReader
	projectRepo      repository.ProjectRepository
}

func NewService(
	localFileStorage service.AssetStorageService,
	metaStore service.AssetMetaStore,
	reader service.AssetContentReader,
	repos repository.Repository,
) *Service {
	return &Service{
		localFileStorage: localFileStorage,
		metaStore:        metaStore,
		reader:           reader,
		projectRepo:      repos.Project,
	}
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

	if s.projectRepo == nil {
		return "", fmt.Errorf("project repository is required")
	}
	project, err := s.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return "", fmt.Errorf("find project: %w", err)
	}
	if project == nil {
		return "", fmt.Errorf("project not found")
	}

	if s.localFileStorage == nil {
		return "", fmt.Errorf("local file storage is required")
	}

	assetID := uuid.NewString()
	stored, err := s.localFileStorage.Store(ctx, projectKey, assetID, filename, content)
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
		GitRepo:     projectKey,
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

var _ service.AssetService = (*Service)(nil)
