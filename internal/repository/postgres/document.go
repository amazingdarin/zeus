package postgres

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/repository/postgres/mapper"
	"zeus/internal/repository/postgres/model"
)

type DocumentRepository struct {
	db *gorm.DB
}

func NewDocumentRepository(db *gorm.DB) *DocumentRepository {
	return &DocumentRepository{db: db}
}

func (r *DocumentRepository) Insert(ctx context.Context, doc *domain.Document) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	docModel := mapper.DocumentFromDomain(doc)
	if err := r.db.WithContext(ctx).Create(docModel).Error; err != nil {
		return fmt.Errorf("insert document: %w", err)
	}
	return nil
}

func (r *DocumentRepository) Save(ctx context.Context, doc *domain.Document) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	docModel := mapper.DocumentFromDomain(doc)
	if err := r.db.WithContext(ctx).Save(docModel).Error; err != nil {
		return fmt.Errorf("save document: %w", err)
	}
	return nil
}

func (r *DocumentRepository) FindByID(ctx context.Context, id string) (*domain.Document, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	if id == "" {
		return nil, fmt.Errorf("id is required")
	}
	var modelObj model.Document
	err := r.db.WithContext(ctx).Model(&model.Document{}).Preload("StorageObject").First(&modelObj, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find document: %w", err)
	}
	obj := mapper.DocumentToDomain(&modelObj)
	return obj, nil
}

func (r *DocumentRepository) List(
	ctx context.Context,
	filter repository.DocumentFilter,
	option repository.DocumentOption,
) ([]*domain.Document, int, error) {
	if r == nil || r.db == nil {
		return nil, 0, fmt.Errorf("repository not initialized")
	}

	query := r.db.WithContext(ctx).Model(&model.Document{})
	if option.PreloadStorageObject {
		query = query.Preload("StorageObject")
	}
	query = applyDocumentFilters(query, filter)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count documents: %w", err)
	}

	if option.Limit > 0 {
		query = query.Limit(option.Limit)
	}
	if option.Offset > 0 {
		query = query.Offset(option.Offset)
	}

	var docModels []model.Document
	if err := query.Find(&docModels).Error; err != nil {
		return nil, 0, fmt.Errorf("list documents: %w", err)
	}
	if len(docModels) == 0 {
		return []*domain.Document{}, int(total), nil
	}

	documents := make([]*domain.Document, 0, len(docModels))
	for i := range docModels {
		doc := mapper.DocumentToDomain(&docModels[i])
		documents = append(documents, doc)
	}

	return documents, int(total), nil
}

func applyDocumentFilters(query *gorm.DB, filter repository.DocumentFilter) *gorm.DB {
	if filter.ProjectID != "" {
		query = query.Where("project_id = ?", filter.ProjectID)
	}
	if filter.ParentID != "" {
		query = query.Where("parent_id = ?", filter.ParentID)
	}
	if filter.Type != "" {
		query = query.Where("type = ?", string(filter.Type))
	}
	if filter.Status != "" {
		query = query.Where("status = ?", string(filter.Status))
	}
	return query
}

var _ repository.DocumentRepository = (*DocumentRepository)(nil)
