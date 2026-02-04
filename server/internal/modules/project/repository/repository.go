package repository

import (
	"context"

	"zeus/internal/domain"
)

type ProjectFilter struct {
	Status    domain.ProjectStatus
	OwnerType domain.OwnerType
	OwnerID   string
	// UserID is used to find projects owned by user or their teams
	UserID    string
	// TeamIDs is used to find team projects the user can access
	TeamIDs   []string
}

type ProjectOption struct {
	PreloadStorageObject bool // 是否预加载存储
	Limit                int
	Offset               int
}

type ProjectRepository interface {
	Insert(ctx context.Context, obj *domain.Project) error
	Update(ctx context.Context, obj *domain.Project) error
	FindByID(ctx context.Context, id string) (*domain.Project, error)
	FindByKey(ctx context.Context, key string) (*domain.Project, error)
	List(ctx context.Context, filter ProjectFilter, option ProjectOption) ([]*domain.Project, int, error)
}
