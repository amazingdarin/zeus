package domain

import (
	"time"
)

type StorageType string

const (
	StorageTypeS3    StorageType = "s3"
	StorageTypeLocal StorageType = "local"
)

type StorageObjectSourceType string

const (
	StorageObjectSourceTypeSystem StorageObjectSourceType = "system"
	StorageObjectSourceTypeUpload StorageObjectSourceType = "upload"
	StorageObjectSourceTypeURL    StorageObjectSourceType = "url"
	StorageObjectSourceTypeImport StorageObjectSourceType = "import"
)

type SourceInfo struct {
	Type StorageObjectSourceType
	// Upload
	UploadBatchID string
	// URL
	URL string
	// Import / External
	ImportedFrom string
}

type StorageInfo struct {
	Type StorageType

	// S3
	Bucket string
	Key    string

	// Local FS
	BasePath string
	FilePath string
}

type StorageObject struct {
	ID        string
	ProjectID string

	Source  SourceInfo
	Storage StorageInfo

	SizeBytes int64
	MimeType  string
	Checksum  string // sha256 / etag

	CreatedAt time.Time
	UpdatedAt time.Time
}
