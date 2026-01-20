package types

import (
	"zeus/internal/domain/docstore"
)

// DocumentDTO uses the unified domain model
type DocumentDTO struct {
	Meta docstore.DocumentMeta `json:"meta"`
	Body docstore.DocumentBody `json:"body,omitempty"`
}

type GetDocumentResponse struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Data    DocumentDTO `json:"data"`
}

type ListDocumentsResponse struct {
	Code    string              `json:"code"`
	Message string              `json:"message"`
	Data    []docstore.TreeItem `json:"data"`
}

type CreateDocumentRequest struct {
	Meta docstore.DocumentMeta `json:"meta"`
	Body docstore.DocumentBody `json:"body"`
}

type CreateDocumentResponse struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Data    DocumentDTO `json:"data"`
}

type MoveDocumentRequest struct {
	TargetParentID string `json:"target_parent_id"`
	Index          int    `json:"index"`
}

type MoveDocumentResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
