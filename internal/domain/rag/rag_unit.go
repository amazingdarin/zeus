package rag

// RAGUnit is the smallest retrievable unit in the RAG index.
// It is derived data and can always be rebuilt from Git documents.
type RAGUnit struct {
	UnitID    string       `json:"unit_id"`
	ProjectID string       `json:"project_id"`
	DocID     string       `json:"doc_id"`
	Path      []string     `json:"path"`
	Content   string       `json:"content"`
	Hash      string       `json:"hash"`
	Source    RAGSourceRef `json:"source"`
}

type RAGSourceRef struct {
	DocID      string `json:"doc_id"`
	BlockIndex int    `json:"block_index"`
}
