package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"gorm.io/gorm"

	"zeus/internal/domain/document"
	"zeus/internal/repository"
)

const saveRawDocumentSQL = `
INSERT INTO raw_document (doc_id, source_type, source_uri, title, metadata)
VALUES ($1, $2, $3, $4, $5)
`

type RawDocumentRepository struct {
	db *gorm.DB
}

func NewRawDocumentRepository(db *gorm.DB) (*RawDocumentRepository, error) {
	if db == nil {
		return nil, fmt.Errorf("db is nil")
	}
	prepared := db.Session(&gorm.Session{PrepareStmt: true})
	return &RawDocumentRepository{db: prepared}, nil
}

func (r *RawDocumentRepository) SaveRawDocument(ctx context.Context, doc *document.RawDocument) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	if doc == nil {
		return fmt.Errorf("raw document is nil")
	}
	metadata, err := json.Marshal(doc.Metadata)
	if err != nil {
		return fmt.Errorf("marshal metadata: %w", err)
	}
	if err := r.db.WithContext(ctx).Exec(
		saveRawDocumentSQL,
		doc.DocID,
		doc.SourceType,
		doc.SourceURI,
		doc.Title,
		metadata,
	).Error; err != nil {
		return fmt.Errorf("save raw document: %w", err)
	}
	return nil
}

func (r *RawDocumentRepository) Close() error {
	if r == nil || r.db == nil {
		return nil
	}
	sqlDB, err := r.db.DB()
	if err != nil {
		return fmt.Errorf("get sql db: %w", err)
	}
	return sqlDB.Close()
}

var _ repository.RawDocumentRepository = (*RawDocumentRepository)(nil)
