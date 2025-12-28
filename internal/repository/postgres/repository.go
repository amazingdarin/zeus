package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"zeus/internal/domain/document"
	"zeus/internal/repository"
)

const saveRawDocumentSQL = `
INSERT INTO raw_document (doc_id, source_type, source_uri, title, metadata)
VALUES ($1, $2, $3, $4, $5)
`

type RawDocumentRepository struct {
	saveStmt *sql.Stmt
}

func NewRawDocumentRepository(db *sql.DB) (*RawDocumentRepository, error) {
	if db == nil {
		return nil, fmt.Errorf("db is nil")
	}
	stmt, err := db.Prepare(saveRawDocumentSQL)
	if err != nil {
		return nil, fmt.Errorf("prepare save raw document: %w", err)
	}
	return &RawDocumentRepository{saveStmt: stmt}, nil
}

func (r *RawDocumentRepository) SaveRawDocument(ctx context.Context, doc *document.RawDocument) error {
	if r == nil || r.saveStmt == nil {
		return fmt.Errorf("repository not initialized")
	}
	if doc == nil {
		return fmt.Errorf("raw document is nil")
	}
	metadata, err := json.Marshal(doc.Metadata)
	if err != nil {
		return fmt.Errorf("marshal metadata: %w", err)
	}
	_, err = r.saveStmt.ExecContext(ctx, doc.DocID, doc.SourceType, doc.SourceURI, doc.Title, metadata)
	if err != nil {
		return fmt.Errorf("save raw document: %w", err)
	}
	return nil
}

func (r *RawDocumentRepository) Close() error {
	if r == nil || r.saveStmt == nil {
		return nil
	}
	return r.saveStmt.Close()
}

var _ repository.RawDocumentRepository = (*RawDocumentRepository)(nil)
