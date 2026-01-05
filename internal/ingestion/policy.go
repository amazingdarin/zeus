package ingestion

import "strings"

// StorageType indicates where an asset should be stored (git or object).
type StorageType string

const (
	StorageTypeGit    StorageType = "git"
	StorageTypeObject StorageType = "object"
)

// IngestionPolicy decides the storage target based on file metadata.
// It is pure logic and must not perform IO or external calls.
type IngestionPolicy interface {
	Decide(size int64, mime string) StorageType
}

// DefaultPolicy implements the default storage decision rules.
type DefaultPolicy struct{}

func (DefaultPolicy) Decide(size int64, mime string) StorageType {
	mime = strings.ToLower(strings.TrimSpace(mime))
	if size > 1024*1024 {
		return StorageTypeObject
	}
	if strings.HasPrefix(mime, "video/") || strings.HasPrefix(mime, "audio/") {
		return StorageTypeObject
	}
	switch mime {
	case "application/pdf", "application/octet-stream":
		return StorageTypeObject
	default:
		return StorageTypeGit
	}
}
