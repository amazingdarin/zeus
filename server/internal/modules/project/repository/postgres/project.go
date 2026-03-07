package postgres

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"zeus/internal/domain"
	projectrepo "zeus/internal/modules/project/repository"
	"zeus/internal/modules/project/repository/postgres/mapper"
	"zeus/internal/modules/project/repository/postgres/model"
)

type ProjectRepository struct {
	db *gorm.DB
}

func NewProjectRepository(db *gorm.DB) *ProjectRepository {
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

func (r *ProjectRepository) Update(ctx context.Context, obj *domain.Project) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	modelObj := mapper.ProjectFromDomain(obj)
	if modelObj == nil {
		return fmt.Errorf("project is nil")
	}
	if err := r.db.WithContext(ctx).Save(modelObj).Error; err != nil {
		return fmt.Errorf("update project: %w", err)
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

func (r *ProjectRepository) FindByKey(ctx context.Context, key string) (*domain.Project, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	if key == "" {
		return nil, fmt.Errorf("key is required")
	}

	var models []model.Project
	if err := r.db.WithContext(ctx).
		Where("key = ?", key).
		Order("created_at DESC").
		Limit(2).
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("find project: %w", err)
	}
	if len(models) == 0 {
		return nil, nil
	}
	if len(models) > 1 {
		return nil, fmt.Errorf("multiple projects found for key %q; owner scope is required", key)
	}
	return mapper.ProjectToDomain(&models[0]), nil
}

func (r *ProjectRepository) List(
	ctx context.Context,
	filter projectrepo.ProjectFilter,
	option projectrepo.ProjectOption,
) ([]*domain.Project, int, error) {
	if r == nil || r.db == nil {
		return nil, 0, fmt.Errorf("repository not initialized")
	}

	query := r.db.WithContext(ctx).Model(&model.Project{})

	if filter.Status != "" {
		query = query.Where("status = ?", string(filter.Status))
	}

	// Filter by specific owner
	if filter.OwnerType != "" && filter.OwnerID != "" {
		query = query.Where("owner_type = ? AND owner_id = ?", string(filter.OwnerType), filter.OwnerID)
	}

	// Filter by user access (user's own projects OR team projects)
	if filter.UserID != "" {
		if len(filter.TeamIDs) > 0 {
			// User can access: their own projects OR projects of their teams
			query = query.Where(
				"(owner_type = ? AND owner_id = ?) OR (owner_type = ? AND owner_id IN ?)",
				string(domain.OwnerTypeUser), filter.UserID,
				string(domain.OwnerTypeTeam), filter.TeamIDs,
			)
		} else {
			// User can only access their own projects
			query = query.Where("owner_type = ? AND owner_id = ?", string(domain.OwnerTypeUser), filter.UserID)
		}
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
	if err := query.Order("created_at DESC").Find(&models).Error; err != nil {
		return nil, 0, fmt.Errorf("list projects: %w", err)
	}

	projects := make([]*domain.Project, 0, len(models))
	for i := range models {
		projects = append(projects, mapper.ProjectToDomain(&models[i]))
	}

	return projects, int(total), nil
}

var _ projectrepo.ProjectRepository = (*ProjectRepository)(nil)
