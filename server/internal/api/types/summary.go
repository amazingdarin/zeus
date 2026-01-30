package types

type DocumentSummaryDTO struct {
	ID          string `json:"id"`
	ProjectID   string `json:"project_id"`
	DocID       string `json:"doc_id"`
	SummaryText string `json:"summary_text"`
	ContentHash string `json:"content_hash"`
	ModelRef    string `json:"model_runtime"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type GetDocumentSummaryResponse struct {
	Code    string             `json:"code"`
	Message string             `json:"message"`
	Data    DocumentSummaryDTO `json:"data"`
}
