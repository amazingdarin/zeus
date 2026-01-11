package rag

type RAGQuery struct {
	ProjectID string         `json:"project_id"`
	Text      string         `json:"text"`
	TopK      int            `json:"top_k"`
	Filters   RAGQueryFilter `json:"filters"`
}

type RAGQueryFilter struct {
	DocIDPrefix string   `json:"doc_id_prefix"`
	PathPrefix  []string `json:"path_prefix"`
}
