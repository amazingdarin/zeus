package rag

import "time"

// DocumentSummary is derived data for a document-level summary.
// It is stored separately from Git so it can be deleted and rebuilt safely.
type DocumentSummary struct {
	ID          string
	ProjectID   string
	DocID       string
	SummaryText string
	ContentHash string
	ModelRef    string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}
