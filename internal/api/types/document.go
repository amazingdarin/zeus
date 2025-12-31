package types

import "time"

type CreateDocumentRequest struct {
	ProjectID       string `json:"project_id" form:"project_id"`
	Title           string `json:"title" form:"title" binding:"required"`
	Description     string `json:"description" form:"description"`
	ParentID        string `json:"parent_id" form:"parent_id" binding:"required"`
	StorageObjectID string `json:"storage_object_id" form:"storage_object_id" binding:"required"`
}

type CreateDocumentResponse struct {
	Code    string              `json:"code"`
	Message string              `json:"message"`
	Data    *ProjectDocumentDTO `json:"data,omitempty"`
}

// RawDocumentDTO API 返回用文档结构
type RawDocumentDTO struct {
	ID           string    `json:"id"`
	BatchID      string    `json:"batch_id"`
	Title        string    `json:"title"`
	SourceType   string    `json:"source_type"`
	OriginalPath string    `json:"original_path"`
	SizeBytes    int64     `json:"size_bytes"`
	MimeType     string    `json:"mime_type"`
	CreatedAt    time.Time `json:"created_at"`
}

// ListRawDocumentsRequest 查询原始文档列表
type ListRawDocumentsRequest struct {
	BatchID string `form:"batch_id,omitempty"`
	Limit   int    `form:"limit,default=20"`
	Offset  int    `form:"offset,default=0"`
}

// ListRawDocumentsResponse 返回原始文档列表
type ListRawDocumentsResponse struct {
	Data  []RawDocumentDTO `json:"data"`
	Total int              `json:"total"`
}

// GetRawDocumentResponse 返回单个文档详情
type GetRawDocumentResponse struct {
	Data RawDocumentDTO `json:"data"`
}
