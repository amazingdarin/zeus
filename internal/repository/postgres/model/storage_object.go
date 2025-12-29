package model

import "time"

type StorageObject struct {
	ID string `gorm:"column:id;primaryKey"`

	SourceType          string `gorm:"column:source_type;not null"`
	SourceUploadBatchID string `gorm:"column:source_upload_batch_id"`
	SourceURL           string `gorm:"column:source_url"`
	SourceImportedFrom  string `gorm:"column:source_imported_from"`

	StorageType   string `gorm:"column:storage_type;not null"`
	S3Bucket      string `gorm:"column:s3_bucket"`
	S3Key         string `gorm:"column:s3_key"`
	LocalBasePath string `gorm:"column:local_base_path"`
	LocalFilePath string `gorm:"column:local_file_path"`

	SizeBytes int64  `gorm:"column:size_bytes"`
	MimeType  string `gorm:"column:mime_type"`
	Checksum  string `gorm:"column:checksum"`

	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (StorageObject) TableName() string {
	return "storage_object"
}
