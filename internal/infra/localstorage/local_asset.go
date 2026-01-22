package localstorage

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"zeus/internal/domain"
	"zeus/internal/service"
)

// LocalAssetStorage stores assets as local files under project assets directory.
type LocalAssetStorage struct {
	repoRoot string
}

func NewLocalAssetStorage(repoRoot string) *LocalAssetStorage {
	repoRoot = strings.TrimSpace(repoRoot)
	return &LocalAssetStorage{repoRoot: repoRoot}
}

func (s *LocalAssetStorage) Store(
	ctx context.Context,
	projectKey string,
	assetID string,
	filename string,
	content io.Reader,
) (service.StoredAssetInfo, error) {
	_ = ctx
	_ = filename
	if s == nil {
		return service.StoredAssetInfo{}, fmt.Errorf("asset storage is required")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return service.StoredAssetInfo{}, fmt.Errorf("project key is required")
	}
	assetID = strings.TrimSpace(assetID)
	if assetID == "" {
		return service.StoredAssetInfo{}, fmt.Errorf("asset id is required")
	}
	if assetID != filepath.Base(assetID) {
		return service.StoredAssetInfo{}, fmt.Errorf("invalid asset id")
	}
	if content == nil {
		return service.StoredAssetInfo{}, fmt.Errorf("content is required")
	}
	if s.repoRoot == "" {
		return service.StoredAssetInfo{}, fmt.Errorf("asset root is required")
	}

	baseDir := filepath.Join(s.repoRoot, projectKey, "assets")
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return service.StoredAssetInfo{}, fmt.Errorf("create temp dir: %w", err)
	}

	filePath := filepath.Join(baseDir, assetID)
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return service.StoredAssetInfo{}, fmt.Errorf("create asset file: %w", err)
	}
	defer file.Close()

	sniff := make([]byte, 512)
	n, err := io.ReadFull(content, sniff)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return service.StoredAssetInfo{}, fmt.Errorf("read content: %w", err)
	}
	sniff = sniff[:n]
	mime := http.DetectContentType(sniff)

	size := int64(0)
	if n > 0 {
		wrote, err := file.Write(sniff)
		if err != nil {
			return service.StoredAssetInfo{}, fmt.Errorf("write content: %w", err)
		}
		size += int64(wrote)
	}

	wrote, err := io.Copy(file, content)
	if err != nil {
		return service.StoredAssetInfo{}, fmt.Errorf("write content: %w", err)
	}
	size += wrote

	return service.StoredAssetInfo{
		StorageType: domain.AssetStorageTypeGit,
		Size:        size,
		Mime:        mime,
		GitRepo:     projectKey,
		GitTempPath: filepath.Join("assets", assetID),
	}, nil
}

var _ service.AssetStorageService = (*LocalAssetStorage)(nil)
