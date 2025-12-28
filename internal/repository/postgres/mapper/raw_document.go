package mapper

import (
	"encoding/json"
	"fmt"

	"zeus/internal/domain"
	"zeus/internal/repository/postgres/model"
)

func RawDocumentFromDomain(doc *domain.RawDocument) (*model.RawDocument, error) {
	if doc == nil {
		return nil, fmt.Errorf("raw document is nil")
	}
	metadata, err := json.Marshal(doc.Metadata)
	if err != nil {
		return nil, fmt.Errorf("marshal metadata: %w", err)
	}
	return &model.RawDocument{
		DocID:      doc.DocID,
		SourceType: string(doc.SourceType),
		SourceURI:  doc.SourceURI,
		Title:      doc.Title,
		Metadata:   metadata,
	}, nil
}

func RawDocumentToDomain(model *model.RawDocument) (*domain.RawDocument, error) {
	var metadata domain.DocumentMetadata
	if len(model.Metadata) > 0 {
		if err := json.Unmarshal(model.Metadata, &metadata); err != nil {
			return nil, fmt.Errorf("unmarshal metadata: %w", err)
		}
	}
	return &domain.RawDocument{
		DocID:      model.DocID,
		SourceType: domain.SourceType(model.SourceType),
		SourceURI:  model.SourceURI,
		Title:      model.Title,
		Metadata:   metadata,
	}, nil
}
