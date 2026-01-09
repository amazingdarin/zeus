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
	Content json.RawMessage              `json:"content"`
	OpenAPI *KnowledgeOpenAPIRequest     `json:"openapi"`
}

type KnowledgeDocumentUpdateRequest struct {
	Meta    *KnowledgeDocumentMetaRequest `json:"meta"`
	Content json.RawMessage               `json:"content"`
}

type KnowledgeDocumentMoveRequest struct {
	NewParentID string `json:"new_parent_id"`
	BeforeID    string `json:"before_id"`
	AfterID     string `json:"after_id"`
}

type KnowledgeOpenAPIRequest struct {
	Source   string `json:"source"`
	Renderer string `json:"renderer"`
}

type KnowledgeDocumentMetaDTO struct {
	ID        string   `json:"id"`
	Slug      string   `json:"slug"`
	Title     string   `json:"title"`
	Parent    string   `json:"parent"`
	Path      string   `json:"path"`
	Status    string   `json:"status"`
	DocType   string   `json:"doc_type"`
	HasChild  bool     `json:"has_child,omitempty"`
	Tags      []string `json:"tags"`
	CreatedAt string   `json:"created_at"`
	UpdatedAt string   `json:"updated_at"`
}

type KnowledgeDocumentHierarchyDTO struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type KnowledgeDocumentContentDTO struct {
	Meta    map[string]interface{} `json:"meta"`
	Content map[string]interface{} `json:"content"`
}

type KnowledgeDocumentDTO struct {
	Meta      KnowledgeDocumentMetaDTO        `json:"meta"`
	Content   KnowledgeDocumentContentDTO     `json:"content"`
	Hierarchy []KnowledgeDocumentHierarchyDTO `json:"hierarchy,omitempty"`
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

type KnowledgeDocumentMoveResponse struct {
	Code    string                   `json:"code"`
	Message string                   `json:"message"`
	Data    KnowledgeDocumentMetaDTO `json:"data"`
}
