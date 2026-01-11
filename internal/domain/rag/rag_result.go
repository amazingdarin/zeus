package rag

import "time"

type RAGMatch struct {
	Unit  RAGUnit `json:"unit"`
	Score float64 `json:"score"`
}

type RAGSearchResult struct {
	Matches []RAGMatch `json:"matches"`
}

type RAGContextItem struct {
	UnitID  string       `json:"unit_id"`
	DocID   string       `json:"doc_id"`
	Path    []string     `json:"path"`
	Content string       `json:"content"`
	Source  RAGSourceRef `json:"source"`
}

type RAGContextBundle struct {
	Query RAGQuery         `json:"query"`
	Items []RAGContextItem `json:"items"`
	Debug map[string]any   `json:"debug,omitempty"`
}

type RAGRebuildReport struct {
	ProjectID    string        `json:"project_id"`
	DocID        string        `json:"doc_id"`
	TotalDocs    int           `json:"total_docs"`
	IndexedUnits int           `json:"indexed_units"`
	FailedDocs   int           `json:"failed_docs"`
	Errors       []string      `json:"errors"`
	Duration     time.Duration `json:"duration"`
}
