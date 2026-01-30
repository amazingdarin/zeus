package service

import (
	"context"
	"errors"
	"io"

	"zeus/internal/domain"
)

var ErrAssetNotFound = errors.New("asset not found")

type AssetKind string

const (
	AssetKindGeneric AssetKind = "generic"
	AssetKindOpenAPI AssetKind = "openapi"
)

type AssetKindResult struct {
	Kind           AssetKind
	OpenAPIVersion string
}

type AssetMeta struct {
	AssetID     string                  `json:"asset_id"`
	ProjectKey  string                  `json:"project_key"`
	Filename    string                  `json:"filename"`
	Size        int64                   `json:"size"`
	Mime        string                  `json:"mime"`
	StorageType domain.AssetStorageType `json:"storage_type"`
	GitRepo     string                  `json:"git_repo,omitempty"`
	GitTempPath string                  `json:"git_temp_path,omitempty"`
	Bucket      string                  `json:"bucket,omitempty"`
	ObjectKey   string                  `json:"object_key,omitempty"`
}

type AssetMetaStore interface {
	Save(ctx context.Context, meta AssetMeta) error
	Load(ctx context.Context, projectKey, assetID string) (*AssetMeta, error)
}

type AssetContentReader interface {
	ReadHead(ctx context.Context, meta AssetMeta, maxBytes int64) ([]byte, error)
	ReadAll(ctx context.Context, meta AssetMeta) ([]byte, error)
}

type AssetService interface {
	ImportFile(
		ctx context.Context,
		projectKey string,
		filename string,
		mime string,
		size int64,
		content io.Reader,
	) (assetID string, err error)

	GetKind(
		ctx context.Context,
		projectKey string,
		assetID string,
	) (AssetKindResult, error)

	GetContent(
		ctx context.Context,
		projectKey string,
		assetID string,
	) (AssetMeta, []byte, error)
}
