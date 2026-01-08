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

type StorageObjectRepository struct {
	db *gorm.DB
}

func NewStorageObjectRepository(db *gorm.DB) *StorageObjectRepository {
	return &StorageObjectRepository{db: db}
}

func (r *StorageObjectRepository) Insert(ctx context.Context, obj *domain.StorageObject) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	modelObj := mapper.StorageObjectFromDomain(obj)
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
	err := r.db.WithContext(ctx).First(&modelObj, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find storage object: %w", err)
	}
	obj := mapper.StorageObjectToDomain(&modelObj)
	return obj, nil
}

var _ repository.StorageObjectRepository = (*StorageObjectRepository)(nil)
