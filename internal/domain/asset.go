package domain

import "time"

// Asset represents a stored resource reference in the domain layer.
// It contains only logical identity and metadata; no IO or storage access.
// Asset ID is a logical identity and must not embed storage implementation details.
type Asset struct {
	ID          string
	ProjectKey  string
	StorageType AssetStorageType
	Size        int64
	Mime        string
	CreatedAt   time.Time

	// Optional storage metadata.
	GitTempPath string
	Bucket      string
	ObjectKey   string
}

type AssetStorageType string

const (
	AssetStorageTypeGit    AssetStorageType = "git"
	AssetStorageTypeObject AssetStorageType = "object"
)
