package repository

import "context"

type DocumentRef struct {
	DocID string
}

type Document struct {
	ProjectID   string
	DocID       string
	Path        []string
	ContentJSON []byte
}

type DocumentReader interface {
	ListDocuments(ctx context.Context, projectID string) ([]DocumentRef, error)
	ReadDocument(ctx context.Context, projectID, docID string) (Document, error)
}
