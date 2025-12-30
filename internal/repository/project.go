package repository

import (
	"context"

	"zeus/internal/domain"
)

type ProjectRepository interface {
	Insert(ctx context.Context, obj *domain.StorageObject) error
	FindByID(ctx context.Context, id string) (*domain.StorageObject, error)
}
