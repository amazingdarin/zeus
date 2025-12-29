package domain

import (
	"time"
)

type StorageType string

const (
	StorageTypeS3    StorageType = "s3"
	StorageTypeLocal StorageType = "local"
)

type SourceType string

const (
	SourceTypeUpload SourceType = "upload"
	SourceTypeURL    SourceType = "url"
	SourceTypeImport SourceType = "import"
)

type SourceInfo struct {
	Type SourceType
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
	ID string

	Source  SourceInfo
	Storage StorageInfo

	SizeBytes int64
	MimeType  string
	Checksum  string // sha256 / etag

	CreatedAt time.Time
	UpdatedAt time.Time
}
