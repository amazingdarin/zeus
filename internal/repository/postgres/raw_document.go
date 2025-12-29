package postgres

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/repository/postgres/mapper"
	"zeus/internal/repository/postgres/model"
)

type RawDocumentRepository struct {
	db *gorm.DB
}

func NewRawDocumentRepository(db *gorm.DB) (*RawDocumentRepository, error) {
	if db == nil {
		return nil, fmt.Errorf("db is nil")
	}
	return &RawDocumentRepository{db: db}, nil
}

func (r *RawDocumentRepository) Save(ctx context.Context, doc *domain.RawDocument) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	modelDoc, err := mapper.RawDocumentFromDomain(doc)
	if err != nil {
		return err
	}
	if err := r.db.WithContext(ctx).Create(modelDoc).Error; err != nil {
		return fmt.Errorf("save raw document: %w", err)
	}
	return nil
}

func (r *RawDocumentRepository) List(
	ctx context.Context,
	filter repository.RawDocumentFilter,
	limit, offset int,
) ([]domain.RawDocument, int, error) {
	if r == nil || r.db == nil {
		return nil, 0, fmt.Errorf("repository not initialized")
	}

	query := r.db.WithContext(ctx).Model(&model.RawDocument{})
	query = applyRawDocumentFilters(query, filter)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count raw documents: %w", err)
	}

	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}

	var rows []model.RawDocument
	if err := query.Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list raw documents: %w", err)
	}

	documents := make([]domain.RawDocument, 0, len(rows))
	for i := range rows {
		doc, err := mapper.RawDocumentToDomain(&rows[i])
		if err != nil {
			return nil, 0, fmt.Errorf("map raw document: %w", err)
		}
		documents = append(documents, *doc)
	}

	return documents, int(total), nil
}

func applyRawDocumentFilters(query *gorm.DB, filter repository.RawDocumentFilter) *gorm.DB {
	if filter.BatchID != "" {
		query = query.Where("metadata ->> 'BatchID' = ?", filter.BatchID)
	}
	if filter.Category != "" {
		query = query.Where("metadata ->> 'Category' = ?", string(filter.Category))
	}
	if filter.CandidateModule != "" {
		query = query.Where("metadata ->> 'CandidateModule' = ?", filter.CandidateModule)
	}
	if filter.Status != "" {
		query = query.Where("metadata ->> 'Status' = ?", string(filter.Status))
	}
	return query
}

var _ repository.RawDocumentRepository = (*RawDocumentRepository)(nil)
