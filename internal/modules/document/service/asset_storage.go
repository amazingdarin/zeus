package service

import (
	"context"
	"io"

	"zeus/internal/domain"
)

// StoredAssetInfo captures the storage result without exposing backend details.
type StoredAssetInfo struct {
	StorageType domain.AssetStorageType
	Size        int64
	Mime        string

	// Optional location hints for downstream services.
	GitRepo     string
	GitTempPath string
	Bucket      string
	ObjectKey   string
}

// AssetStorageService defines a unified asset storage abstraction.
// Implementations decide where to store but must not leak storage specifics here.
type AssetStorageService interface {
	Store(
		ctx context.Context,
		repo string,
		assetID string,
		filename string,
		content io.Reader,
	) (StoredAssetInfo, error)
}
