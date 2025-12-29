package types

type CreateStorageObjectRequest struct {
	// source
	SourceType          string `json:"source_type" form:"source_type" binding:"required"`
	SourceUploadBatchID string `json:"source_upload_batch_id,omitempty" form:"source_upload_batch_id,omitempty"`
	SourceURL           string `json:"source_url,omitempty" form:"source_url,omitempty"`
	SourceImportedFrom  string `json:"source_imported_from,omitempty" form:"source_imported_from,omitempty"`

	// storage
	StorageType string `json:"storage_type" form:"storage_type" binding:"required"`

	// s3
	Bucket    string `json:"bucket,omitempty" form:"bucket,omitempty"`
	ObjectKey string `json:"object_key,omitempty" form:"object_key,omitempty"`

	// local
	BasePath string `json:"base_path,omitempty" form:"base_path,omitempty"`
	FilePath string `json:"file_path,omitempty" form:"file_path,omitempty"`

	// file meta
	Namespace string `json:"namespace,omitempty" form:"namespace,omitempty"`
	MimeType  string `json:"mime_type,omitempty" form:"mime_type,omitempty"`
}

type CreateStorageObjectResponse struct {
	ID        string `json:"id"`
	CreatedAt string `json:"created_at"`
}
