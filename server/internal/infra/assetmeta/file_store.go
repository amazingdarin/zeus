package assetmeta

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	documentservice "zeus/internal/modules/document/service"
)

const DefaultMetaRoot = "/var/lib/zeus/assets"

type FileStore struct {
	root string
}

func NewFileStore(root string) *FileStore {
	root = strings.TrimSpace(root)
	if root == "" {
		root = DefaultMetaRoot
	}
	return &FileStore{root: root}
}

func (s *FileStore) Save(ctx context.Context, meta documentservice.AssetMeta) error {
	_ = ctx
	if s == nil {
		return fmt.Errorf("asset meta store is required")
	}
	if strings.TrimSpace(meta.ProjectKey) == "" {
		return fmt.Errorf("project key is required")
	}
	if strings.TrimSpace(meta.AssetID) == "" {
		return fmt.Errorf("asset id is required")
	}
	baseDir := filepath.Join(s.root, meta.ProjectKey)
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return fmt.Errorf("create meta dir: %w", err)
	}
	path := filepath.Join(baseDir, meta.AssetID+".json")
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal meta: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write meta: %w", err)
	}
	return nil
}

func (s *FileStore) Load(
	ctx context.Context,
	projectKey string,
	assetID string,
) (*documentservice.AssetMeta, error) {
	_ = ctx
	if s == nil {
		return nil, fmt.Errorf("asset meta store is required")
	}
	projectKey = strings.TrimSpace(projectKey)
	assetID = strings.TrimSpace(assetID)
	if projectKey == "" {
		return nil, fmt.Errorf("project key is required")
	}
	if assetID == "" {
		return nil, fmt.Errorf("asset id is required")
	}
	path := filepath.Join(s.root, projectKey, assetID+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, documentservice.ErrAssetNotFound
		}
		return nil, fmt.Errorf("read meta: %w", err)
	}
	var meta documentservice.AssetMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, fmt.Errorf("parse meta: %w", err)
	}
	return &meta, nil
}

var _ documentservice.AssetMetaStore = (*FileStore)(nil)
