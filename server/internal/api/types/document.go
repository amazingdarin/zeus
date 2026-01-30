package types

import (
	"zeus/internal/domain"
)

// DocumentDTO uses the unified domain model
type DocumentDTO struct {
	Meta domain.DocumentMeta `json:"meta"`
	Body domain.DocumentBody `json:"body"`
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

type FetchURLRequest struct {
	URL string `json:"url"`
}

type FetchURLData struct {
	URL       string `json:"url"`
	HTML      string `json:"html"`
	FetchedAt string `json:"fetched_at"`
}

type FetchURLResponse struct {
	Code    string       `json:"code"`
	Message string       `json:"message"`
	Data    FetchURLData `json:"data"`
}

type ImportGitRequest struct {
	RepoURL  string `json:"repo_url"`
	Branch   string `json:"branch"`
	Subdir   string `json:"subdir"`
	ParentID string `json:"parent_id"`
}

type ImportGitResult struct {
	Directories int `json:"directories"`
	Files       int `json:"files"`
	Skipped     int `json:"skipped"`
}

type ImportGitResponse struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Data    ImportGitResult `json:"data"`
}
