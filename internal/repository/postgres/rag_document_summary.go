package postgres

import (
	"context"
	"errors"
	"fmt"

	domainrag "zeus/internal/domain/rag"
	"zeus/internal/repository/postgres/mapper"
	"zeus/internal/repository/postgres/model"
	"zeus/internal/repository/ragsummary"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type DocumentSummaryRepository struct {
	db *gorm.DB
}

func NewDocumentSummaryRepository(db *gorm.DB) *DocumentSummaryRepository {
	return &DocumentSummaryRepository{db: db}
}

func (r *DocumentSummaryRepository) Get(
	ctx context.Context,
	projectID, docID string,
) (*domainrag.DocumentSummary, bool, error) {
	var modelObj model.DocumentSummary
	err := r.db.WithContext(ctx).First(
		&modelObj,
		"project_id = ? AND doc_id = ?",
		projectID,
		docID,
	).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("get document summary: %w", err)
	}
	return mapper.DocumentSummaryToDomain(&modelObj), true, nil
}

func (r *DocumentSummaryRepository) Upsert(ctx context.Context, summary *domainrag.DocumentSummary) error {
	if summary == nil {
		return fmt.Errorf("summary is nil")
	}
	modelObj := mapper.DocumentSummaryFromDomain(summary)
	if modelObj == nil {
		return fmt.Errorf("summary is nil")
	}
	err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "project_id"},
			{Name: "doc_id"},
		},
		DoUpdates: clause.AssignmentColumns(
			[]string{"summary_text", "content_hash", "model_runtime", "updated_at"},
		),
	}).Create(modelObj).Error
	if err != nil {
		return fmt.Errorf("upsert document summary: %w", err)
	}
	return nil
}

func (r *DocumentSummaryRepository) DeleteByProject(ctx context.Context, projectID string) error {
	if err := r.db.WithContext(ctx).
		Where("project_id = ?", projectID).
		Delete(&model.DocumentSummary{}).Error; err != nil {
		return fmt.Errorf("delete summaries by project: %w", err)
	}
	return nil
}

func (r *DocumentSummaryRepository) DeleteByDoc(ctx context.Context, projectID, docID string) error {
	if err := r.db.WithContext(ctx).
		Where("project_id = ? AND doc_id = ?", projectID, docID).
		Delete(&model.DocumentSummary{}).Error; err != nil {
		return fmt.Errorf("delete summary by doc: %w", err)
	}
	return nil
}

var _ ragsummary.DocumentSummaryRepository = (*DocumentSummaryRepository)(nil)
