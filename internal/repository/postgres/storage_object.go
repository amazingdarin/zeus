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

type StorageObjectRepository struct {
	db *gorm.DB
}

func NewStorageObjectRepository(db *gorm.DB) (*StorageObjectRepository, error) {
	if db == nil {
		return nil, fmt.Errorf("db is nil")
	}
	return &StorageObjectRepository{db: db}, nil
}

func (r *StorageObjectRepository) Insert(ctx context.Context, obj *domain.StorageObject) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	modelObj, err := mapper.StorageObjectFromDomain(obj)
	if err != nil {
		return err
	}
	if err := r.db.WithContext(ctx).Create(modelObj).Error; err != nil {
		return fmt.Errorf("insert storage object: %w", err)
	}
	return nil
}

func (r *StorageObjectRepository) FindByID(ctx context.Context, id string) (*domain.StorageObject, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	if id == "" {
		return nil, fmt.Errorf("id is required")
	}
	var modelObj model.StorageObject
	if err := r.db.WithContext(ctx).First(&modelObj, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("find storage object: %w", err)
	}
	obj, err := mapper.StorageObjectToDomain(&modelObj)
	if err != nil {
		return nil, err
	}
	return obj, nil
}

var _ repository.StorageObjectRepository = (*StorageObjectRepository)(nil)
