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

type ProjectRepository struct {
	db *gorm.DB
}

func NewProjectRepository(db *gorm.DB) *ProjectRepository{
	return &ProjectRepository{db: db}
}

func (r *ProjectRepository) Insert(ctx context.Context, obj *domain.Project) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	modelObj := mapper.ProjectFromDomain(obj)
	if modelObj == nil {
		return fmt.Errorf("project is nil")
	}
	if err := r.db.WithContext(ctx).Create(modelObj).Error; err != nil {
		return fmt.Errorf("insert project: %w", err)
	}
	return nil
}

func (r *ProjectRepository) FindByID(ctx context.Context, id string) (*domain.Project, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	if id == "" {
		return nil, fmt.Errorf("id is required")
	}
	var modelObj model.Project
	err := r.db.WithContext(ctx).First(&modelObj, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find storage object: %w", err)
	}
	return mapper.ProjectToDomain(&modelObj), nil
}

func (r *ProjectRepository) List(
	ctx context.Context,
	filter repository.ProjectFilter,
	option repository.ProjectOption,
) ([]*domain.Project, int, error) {
	if r == nil || r.db == nil {
		return nil, 0, fmt.Errorf("repository not initialized")
	}

	query := r.db.WithContext(ctx).Model(&model.Project{})
	if filter.Status != "" {
		query = query.Where("status = ?", string(filter.Status))
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count projects: %w", err)
	}

	if option.Limit > 0 {
		query = query.Limit(option.Limit)
	}
	if option.Offset > 0 {
		query = query.Offset(option.Offset)
	}

	var models []model.Project
	if err := query.Find(&models).Error; err != nil {
		return nil, 0, fmt.Errorf("list projects: %w", err)
	}

	projects := make([]*domain.Project, 0, len(models))
	for i := range models {
		projects = append(projects, mapper.ProjectToDomain(&models[i]))
	}

	return projects, int(total), nil
}

var _ repository.ProjectRepository = (*ProjectRepository)(nil)
