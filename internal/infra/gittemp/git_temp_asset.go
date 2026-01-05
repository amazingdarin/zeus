package gittemp

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"zeus/internal/domain"
	"zeus/internal/infra/gitclient"
	"zeus/internal/service"
)

// GitTempAssetStorage stores small assets as temporary files under repo __tmp_assets.
// It does not perform any git operations.
type GitTempAssetStorage struct {
	repoRoot string
}

func NewGitTempAssetStorage(repoRoot string) *GitTempAssetStorage {
	repoRoot = strings.TrimSpace(repoRoot)
	if repoRoot == "" {
		repoRoot = gitclient.RepoRoot
	}
	return &GitTempAssetStorage{repoRoot: repoRoot}
}

func (s *GitTempAssetStorage) Store(
	ctx context.Context,
	projectKey string,
	assetID string,
	filename string,
	content io.Reader,
) (service.StoredAssetInfo, error) {
	_ = ctx
	_ = filename
	if s == nil {
		return service.StoredAssetInfo{}, fmt.Errorf("git temp storage is required")
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
		return service.StoredAssetInfo{}, fmt.Errorf("repo root is required")
	}

	baseDir := filepath.Join(s.repoRoot, projectKey, "__tmp_assets")
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
		GitTempPath: filePath,
	}, nil
}

var _ service.AssetStorageService = (*GitTempAssetStorage)(nil)
