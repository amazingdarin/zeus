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
	"zeus/internal/infra/session"
	"zeus/internal/service"
)

// GitTempAssetStorage stores small assets as temporary files under repo __tmp_assets.
// It does not perform any git operations.
type GitTempAssetStorage struct {
	repoRoot string
}

func NewGitTempAssetStorage(repoRoot string) *GitTempAssetStorage {
	repoRoot = strings.TrimSpace(repoRoot)
	return &GitTempAssetStorage{repoRoot: repoRoot}
}

func (s *GitTempAssetStorage) Store(
	ctx context.Context,
	repo string,
	assetID string,
	filename string,
	content io.Reader,
) (service.StoredAssetInfo, error) {
	_ = ctx
	_ = filename
	if s == nil {
		return service.StoredAssetInfo{}, fmt.Errorf("git temp storage is required")
	}
	repo = strings.TrimSpace(repo)
	if repo == "" {
		return service.StoredAssetInfo{}, fmt.Errorf("repo is required")
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

	sessionInfo, ok := session.FromContext(ctx)
	if !ok || sessionInfo == nil {
		return service.StoredAssetInfo{}, fmt.Errorf("session is required")
	}
	sessionID := strings.TrimSpace(sessionInfo.ID)
	if sessionID == "" {
		return service.StoredAssetInfo{}, fmt.Errorf("session id is required")
	}
	gitKey := gitclient.GenGitKeyFromSession(sessionID, repo)

	baseDir := filepath.Join(s.repoRoot, string(gitKey), "__tmp_assets")
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
		GitRepo:     repo,
		GitTempPath: filepath.Join("__tmp_assets", assetID),
	}, nil
}

var _ service.AssetStorageService = (*GitTempAssetStorage)(nil)
