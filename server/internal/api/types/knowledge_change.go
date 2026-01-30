package types

import "encoding/json"

type KnowledgeChangeProposalRequest struct {
	Meta    *KnowledgeDocumentMetaRequest `json:"meta"`
	Content json.RawMessage               `json:"content"`
}

type KnowledgeChangeProposalDTO struct {
	ID        string `json:"id"`
	DocID     string `json:"doc_id"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type KnowledgeChangeProposalResponse struct {
	Code    string                     `json:"code"`
	Message string                     `json:"message"`
	Data    KnowledgeChangeProposalDTO `json:"data"`
}

type KnowledgeChangeDiffDTO struct {
	TargetDocID  string `json:"target_doc_id"`
	BaseRevision string `json:"base_revision"`
	MetaDiff     string `json:"meta_diff"`
	ContentDiff  string `json:"content_diff"`
}

type KnowledgeChangeDiffResponse struct {
	Code    string                 `json:"code"`
	Message string                 `json:"message"`
	Data    KnowledgeChangeDiffDTO `json:"data"`
}
