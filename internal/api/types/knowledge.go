package types

import "encoding/json"

type KnowledgeDocumentMetaRequest struct {
	ID      string   `json:"id"`
	Slug    string   `json:"slug"`
	Title   string   `json:"title"`
	Parent  string   `json:"parent"`
	Path    string   `json:"path"`
	Status  string   `json:"status"`
	DocType string   `json:"doc_type"`
	Tags    []string `json:"tags"`
}

type KnowledgeDocumentCreateRequest struct {
	Meta    KnowledgeDocumentMetaRequest `json:"meta" binding:"required"`
	Content json.RawMessage              `json:"content" binding:"required"`
}

type KnowledgeDocumentUpdateRequest struct {
	Meta    *KnowledgeDocumentMetaRequest `json:"meta"`
	Content json.RawMessage               `json:"content"`
}

type KnowledgeDocumentMetaDTO struct {
	ID        string   `json:"id"`
	Slug      string   `json:"slug"`
	Title     string   `json:"title"`
	Parent    string   `json:"parent"`
	Path      string   `json:"path"`
	Status    string   `json:"status"`
	DocType   string   `json:"doc_type"`
	Tags      []string `json:"tags"`
	CreatedAt string   `json:"created_at"`
	UpdatedAt string   `json:"updated_at"`
}

type KnowledgeDocumentContentDTO struct {
	Meta    map[string]interface{} `json:"meta"`
	Content map[string]interface{} `json:"content"`
}

type KnowledgeDocumentDTO struct {
	Meta    KnowledgeDocumentMetaDTO    `json:"meta"`
	Content KnowledgeDocumentContentDTO `json:"content"`
}

type KnowledgeListResponse struct {
	Code    string                     `json:"code"`
	Message string                     `json:"message"`
	Data    []KnowledgeDocumentMetaDTO `json:"data"`
}

type KnowledgeDocumentResponse struct {
	Code    string               `json:"code"`
	Message string               `json:"message"`
	Data    KnowledgeDocumentDTO `json:"data"`
}
