package types

import (
	"zeus/internal/domain"
)

// DocumentDTO uses the unified domain model
type DocumentDTO struct {
	Meta domain.DocumentMeta `json:"meta"`
	Body domain.DocumentBody `json:"body,omitempty"`
}

type GetDocumentResponse struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Data    DocumentDTO `json:"data"`
}

type DocumentHierarchyItem struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	ParentID string `json:"parent_id"`
}

type DocumentHierarchyResponse struct {
	Code    string                  `json:"code"`
	Message string                  `json:"message"`
	Data    []DocumentHierarchyItem `json:"data"`
}

type ListDocumentsResponse struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Data    []domain.TreeItem `json:"data"`
}

type CreateDocumentRequest struct {
	Meta domain.DocumentMeta `json:"meta"`
	Body domain.DocumentBody `json:"body"`
}

type CreateDocumentResponse struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Data    DocumentDTO `json:"data"`
}

type MoveDocumentRequest struct {
	TargetParentID string `json:"target_parent_id"`
	BeforeDocID    string `json:"before_doc_id"`
	AfterDocID     string `json:"after_doc_id"`
}

type MoveDocumentResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
