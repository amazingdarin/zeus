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

type DocumentRepository struct {
	db *gorm.DB
}

func NewDocumentRepository(db *gorm.DB) (*DocumentRepository, error) {
	if db == nil {
		return nil, fmt.Errorf("db is nil")
	}
	return &DocumentRepository{db: db}, nil
}

func (r *DocumentRepository) Insert(ctx context.Context, doc *domain.Document) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	docModel, storageModel, err := mapper.DocumentFromDomain(doc)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(storageModel).Error; err != nil {
			return fmt.Errorf("insert storage object: %w", err)
		}
		if err := tx.Create(docModel).Error; err != nil {
			return fmt.Errorf("insert document: %w", err)
		}
		return nil
	})
}

func (r *DocumentRepository) Save(ctx context.Context, doc *domain.Document) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	docModel, storageModel, err := mapper.DocumentFromDomain(doc)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(storageModel).Error; err != nil {
			return fmt.Errorf("save storage object: %w", err)
		}
		if err := tx.Save(docModel).Error; err != nil {
			return fmt.Errorf("save document: %w", err)
		}
		return nil
	})
}

func (r *DocumentRepository) List(
	ctx context.Context,
	filter repository.DocumentFilter,
	limit, offset int,
) ([]domain.Document, int, error) {
	if r == nil || r.db == nil {
		return nil, 0, fmt.Errorf("repository not initialized")
	}

	query := r.db.WithContext(ctx).Model(&model.Document{})
	if filter.PreloadStorageObject {
		query = query.Preload("StorageObject")
	}
	query = applyDocumentFilters(query, filter)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count documents: %w", err)
	}

	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}

	var docModels []model.Document
	if err := query.Find(&docModels).Error; err != nil {
		return nil, 0, fmt.Errorf("list documents: %w", err)
	}
	if len(docModels) == 0 {
		return []domain.Document{}, int(total), nil
	}

	documents := make([]domain.Document, 0, len(docModels))
	for i := range docModels {
		doc, err := mapper.DocumentToDomain(&docModels[i], docModels[i].StorageObject)
		if err != nil {
			return nil, 0, fmt.Errorf("map document: %w", err)
		}
		documents = append(documents, *doc)
	}

	return documents, int(total), nil
}

func applyDocumentFilters(query *gorm.DB, filter repository.DocumentFilter) *gorm.DB {
	if filter.ID != "" {
		query = query.Where("id = ?", filter.ID)
	}
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
