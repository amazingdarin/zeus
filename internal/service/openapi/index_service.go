package openapi

import (
	"context"
	"fmt"
	"strings"

	"zeus/internal/service"
)

type IndexService interface {
	BuildIndex(ctx context.Context, projectKey string, source string) (Index, error)
}

type Service struct {
	metaStore service.AssetMetaStore
	reader    service.AssetContentReader
}

func NewIndexService(metaStore service.AssetMetaStore, reader service.AssetContentReader) *Service {
	return &Service{
		metaStore: metaStore,
		reader:    reader,
	}
}

func (s *Service) BuildIndex(
	ctx context.Context,
	projectKey string,
	source string,
) (Index, error) {
	if s == nil {
		return Index{}, fmt.Errorf("openapi service not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return Index{}, fmt.Errorf("project key is required")
	}
	assetID, err := parseSource(source)
	if err != nil {
		return Index{}, err
	}
	meta, err := s.metaStore.Load(ctx, projectKey, assetID)
	if err != nil {
		return Index{}, err
	}
	if meta == nil {
		return Index{}, service.ErrAssetNotFound
	}
	raw, err := s.reader.ReadAll(ctx, *meta)
	if err != nil {
		return Index{}, err
	}
	return ParseIndex(raw)
}

func parseSource(source string) (string, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		return "", fmt.Errorf("source is required")
	}
	const prefix = "storage://"
	if !strings.HasPrefix(source, prefix) {
		return "", fmt.Errorf("invalid source")
	}
	assetID := strings.TrimSpace(strings.TrimPrefix(source, prefix))
	if assetID == "" {
		return "", fmt.Errorf("invalid source")
	}
	return assetID, nil
}

var _ IndexService = (*Service)(nil)
